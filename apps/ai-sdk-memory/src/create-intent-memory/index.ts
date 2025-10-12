import {
  type LanguageModelV2Middleware,
  type LanguageModelV2StreamPart,
  type LanguageModelV2Content,
  type LanguageModelV2CallOptions,
} from "@ai-sdk/provider";
import {
  embed,
  streamText,
  generateText,
  generateObject,
  streamObject,
  simulateReadableStream,
  wrapLanguageModel,
  type EmbeddingModel,
  type StreamTextResult,
  type GenerateTextResult,
  type GenerateObjectResult,
  type StreamObjectResult,
  gateway,
} from "ai";

import { Index } from "@upstash/vector";
import { Redis } from "@upstash/redis";
import * as crypto from "node:crypto";
import {
  intentCacheConfigSchema,
  type IntentCacheConfig,
  validateEnvConfig,
} from "./schema";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

interface ExtractedIntent {
  intent: string;
  domain: string[];
  stack: string[];
  goal: string;
  constraints: string[];
}

function buildScope(options: any) {
  return {
    llmModel: options.model?.modelId ?? String(options.model ?? ""),
    systemHash: sha(options.system ?? ""),
    params: sha(
      JSON.stringify({
        temperature: options.temperature,
        topP: options.topP,
      }),
    ),
    toolsHash: sha(JSON.stringify(options.tools ?? {})),
  };
}

export function createIntentMemory(config: IntentCacheConfig) {
  const parsed = intentCacheConfigSchema.parse(config);

  validateEnvConfig(parsed);

  const {
    vector,
    redis: redisConfig,
    threshold,
    ttl,
    simulateStream,
    debug,
    cacheMode,
    intentExtractor,
    onStepFinish,
  } = parsed;
  const embeddingModel = parsed.model as EmbeddingModel<string>;

  const index = new Index({
    url: vector.url as string,
    token: vector.token as string,
  });

  const redis = new Redis({
    url: redisConfig.url as string,
    token: redisConfig.token as string,
  });

  async function extractIntent(
    messages: any[],
    extractorModel: any,
  ): Promise<ExtractedIntent> {
    onStepFinish?.({
      step: "intent-extraction-start",
    });

    // Take last N messages based on windowSize
    const windowSize = intentExtractor?.windowSize ?? 5;
    const recentMessages = messages.slice(-windowSize);

    // Build conversation context
    const conversationContext = recentMessages
      .map(
        (m) =>
          `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`,
      )
      .join("\n");

    const extractionPrompt =
      intentExtractor?.prompt ??
      `Analyze this conversation and extract the user's current intent.

Conversation:
${conversationContext}

Extract and return ONLY a JSON object with this exact structure (no markdown, no explanation):
{
  "intent": "one sentence describing what the user wants to accomplish right now",
  "domain": ["primary domain", "secondary domain"],
  "stack": ["technology1", "technology2"],
  "goal": "specific current goal",
  "constraints": ["constraint1", "constraint2"]
}`;

    try {
      const result = await generateText({
        model: extractorModel,
        prompt: extractionPrompt,
        temperature: 0.1,
      });

      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in extraction response");
      }

      const extracted = JSON.parse(jsonMatch[0]) as ExtractedIntent;

      if (debug) {
        console.log("🎯 Extracted intent:", extracted);
      }

      onStepFinish?.({
        step: "intent-extraction-complete",
        extractedIntent: extracted,
        userIntention: buildIntentString(extracted),
      });

      return extracted;
    } catch (error) {
      if (debug) {
        console.warn(
          "⚠️ Intent extraction failed, falling back to last message",
          error,
        );
      }

      onStepFinish?.({
        step: "intent-extraction-error",
        error,
      });

      // Fallback: use last message
      const lastMessage = messages[messages.length - 1];
      const content =
        typeof lastMessage.content === "string"
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);

      return {
        intent: content,
        domain: [],
        stack: [],
        goal: content,
        constraints: [],
      };
    }
  }

  function buildIntentString(extracted: ExtractedIntent): string {
    const parts = [
      extracted.goal,
      ...extracted.domain,
      ...extracted.stack,
      ...extracted.constraints,
    ].filter(Boolean);

    return parts.join(" ");
  }

  async function getCacheKeyFromIntent(
    options: LanguageModelV2CallOptions,
  ): Promise<{
    intentString: string;
    extractedIntent: ExtractedIntent | null;
  }> {
    if (
      !options.prompt ||
      !Array.isArray(options.prompt) ||
      options.prompt.length === 0
    ) {
      if (options.prompt) {
        return {
          intentString: String(options.prompt),
          extractedIntent: null,
        };
      }
      return {
        intentString: "",
        extractedIntent: null,
      };
    }

    // Extract intent using LLM
    const extractorModel = intentExtractor?.model;
    if (!extractorModel) {
      throw new Error(
        "intentExtractor.model is required for createIntentMemory",
      );
    }

    const extracted = await extractIntent(options.prompt, extractorModel);

    const intentString = buildIntentString(extracted);

    return { intentString, extractedIntent: extracted };
  }

  async function checkIntentCache(intentString: string, scope: any) {
    onStepFinish?.({
      step: "cache-check-start",
      userIntention: intentString,
    });

    const intentNorm = norm(intentString);

    const { embedding } = await embed({
      model: embeddingModel,
      value: intentNorm,
    });

    const result = await index.query({
      vector: embedding,
      topK: 3,
      includeMetadata: true,
    });

    const hit = result.find((m) => {
      if (debug) console.log("intent score", m.score.toFixed(3));

      onStepFinish?.({
        step: "cache-check-start",
        cacheScore: m.score,
      });

      if (m.score < threshold) return false;

      const metadata = m.metadata as any;
      if (!metadata) return false;

      return (
        metadata.llmModel === scope.llmModel &&
        metadata.systemHash === scope.systemHash &&
        metadata.params === scope.params &&
        metadata.toolsHash === scope.toolsHash
      );
    });

    if (hit) {
      const cached = await redis.get<{
        streamParts?: LanguageModelV2StreamPart[];
        text?: string;
        content?: LanguageModelV2Content;
        [key: string]: any;
      }>(hit.id.toString());

      if (cached) {
        if (debug) console.log("✅ intent cache hit", hit.score.toFixed(3));

        onStepFinish?.({
          step: "cache-hit",
          userIntention: intentString,
          cacheScore: hit.score,
        });

        return { cached, embedding, intentNorm };
      }
    }

    if (debug) console.log("❌ miss -> generating…");

    onStepFinish?.({
      step: "cache-miss",
      userIntention: intentString,
    });

    return { cached: null, embedding, intentNorm };
  }

  async function storeInCache(
    id: string,
    data: any,
    embedding: number[],
    intentNorm: string,
    scope: any,
    extractedIntent: ExtractedIntent | null,
  ) {
    onStepFinish?.({
      step: "cache-store-start",
      userIntention: intentNorm,
    });

    const lockKey = "lock:" + id;
    const ok = await redis.set(lockKey, "1", { nx: true, ex: 15 });

    if (!ok) {
      if (debug)
        console.log("⚠️ Another process is writing to cache, skipping");
      return;
    }

    try {
      await redis.set(id, data, { ex: ttl });
      await index.upsert([
        {
          id,
          vector: embedding,
          metadata: {
            intent: intentNorm,
            ...(extractedIntent && {
              domain: extractedIntent.domain.join(","),
              stack: extractedIntent.stack.join(","),
              goal: extractedIntent.goal,
            }),
            ...scope,
          },
        },
      ]);

      onStepFinish?.({
        step: "cache-store-complete",
        userIntention: intentNorm,
      });
    } catch (error) {
      onStepFinish?.({
        step: "cache-store-error",
        userIntention: intentNorm,
        error,
      });
      throw error;
    } finally {
      await redis.del(lockKey);
    }
  }

  const intentCacheMiddleware: LanguageModelV2Middleware = {
    wrapStream: async ({ doStream, params }) => {
      const { intentString, extractedIntent } =
        await getCacheKeyFromIntent(params);
      const scope = buildScope(params);
      const promptScope = Object.values(scope).join("|");

      if (debug) console.log("User intention:", JSON.stringify(intentString));

      const { cached, embedding, intentNorm } = await checkIntentCache(
        intentString,
        scope,
      );

      if (cached && cacheMode !== "refresh") {
        if (debug) console.log("✅ Returning cached stream from intent");

        let chunks: LanguageModelV2StreamPart[] = [];

        if (cached.streamParts) {
          chunks = cached.streamParts.map((p: any) => {
            if (p.type === "response-metadata" && p.timestamp) {
              return { ...p, timestamp: new Date(p.timestamp) };
            }
            return p;
          });
        } else if (cached.text) {
          chunks = [
            { type: "text-start", id: cached.id },
            { type: "text-delta", delta: cached.text, id: cached.id },
            { type: "finish", finishReason: "stop", usage: cached.usage },
          ];
        }

        return {
          stream: simulateReadableStream({
            initialDelayInMs: simulateStream.enabled
              ? simulateStream.initialDelayInMs
              : 0,
            chunkDelayInMs: simulateStream.enabled
              ? simulateStream.chunkDelayInMs
              : 0,
            chunks,
          }),
        };
      }

      onStepFinish?.({
        step: "generation-start",
        userIntention: intentString,
      });

      const { stream, ...rest } = await doStream();

      const fullResponse: LanguageModelV2StreamPart[] = [];

      const transformStream = new TransformStream<
        LanguageModelV2StreamPart,
        LanguageModelV2StreamPart
      >({
        transform(chunk, controller) {
          fullResponse.push(chunk);
          controller.enqueue(chunk);
        },
        async flush() {
          onStepFinish?.({
            step: "generation-complete",
            userIntention: intentString,
          });

          const id = "intent:" + sha(promptScope + "|" + intentNorm);
          await storeInCache(
            id,
            { streamParts: fullResponse },
            embedding,
            intentNorm,
            scope,
            extractedIntent,
          );
        },
      });

      return {
        stream: stream.pipeThrough(transformStream),
        ...rest,
      };
    },

    wrapGenerate: async ({ doGenerate, params }) => {
      const { intentString, extractedIntent } =
        await getCacheKeyFromIntent(params);
      const scope = buildScope(params);
      const promptScope = Object.values(scope).join("|");

      const { cached, embedding, intentNorm } = await checkIntentCache(
        intentString,
        scope,
      );

      if (cached && cacheMode !== "refresh") {
        if (debug) console.log("✅ Returning cached generation from intent");

        if (cached?.response?.timestamp) {
          cached.response.timestamp = new Date(cached.response.timestamp);
        }

        type GenReturn<T> = T extends () => PromiseLike<infer R> ? R : never;
        return cached as unknown as GenReturn<typeof doGenerate>;
      }

      onStepFinish?.({
        step: "generation-start",
        userIntention: intentString,
      });

      const result = await doGenerate();

      onStepFinish?.({
        step: "generation-complete",
        userIntention: intentString,
      });

      const id = "intent:" + sha(promptScope + "|" + intentNorm);
      await storeInCache(
        id,
        result,
        embedding,
        intentNorm,
        scope,
        extractedIntent,
      );

      return result;
    },
  };

  return {
    streamText: async <TOOLS extends Record<string, any> = {}>(
      options: Parameters<typeof streamText<TOOLS>>[0],
    ): Promise<StreamTextResult<TOOLS, any>> => {
      const wrappedModel = wrapLanguageModel({
        model:
          typeof options.model === "string"
            ? gateway(options.model)
            : options.model,
        middleware: intentCacheMiddleware,
      });

      return streamText({
        ...options,
        model: wrappedModel,
      });
    },

    generateText: async <
      TOOLS extends Record<string, any> = {},
      OUTPUT = undefined,
    >(
      options: Parameters<typeof generateText<TOOLS, OUTPUT>>[0],
    ): Promise<GenerateTextResult<TOOLS, OUTPUT>> => {
      const wrappedModel = wrapLanguageModel({
        model:
          typeof options.model === "string"
            ? gateway(options.model)
            : options.model,
        middleware: intentCacheMiddleware,
      });

      return generateText({
        ...options,
        model: wrappedModel,
      });
    },

    generateObject: async <T = any>(
      options: Parameters<typeof generateObject>[0],
    ): Promise<GenerateObjectResult<T>> => {
      const wrappedModel = wrapLanguageModel({
        model:
          typeof options.model === "string"
            ? gateway(options.model)
            : options.model,
        middleware: intentCacheMiddleware,
      });

      return (await generateObject({
        ...options,
        model: wrappedModel,
      })) as GenerateObjectResult<T>;
    },

    streamObject: async <T = any>(
      options: Parameters<typeof streamObject>[0],
    ): Promise<StreamObjectResult<T, T, any>> => {
      const wrappedModel = wrapLanguageModel({
        model:
          typeof options.model === "string"
            ? gateway(options.model)
            : options.model,
        middleware: intentCacheMiddleware,
      });

      return streamObject({
        ...options,
        model: wrappedModel,
      }) as unknown as StreamObjectResult<T, T, any>;
    },
  };
}
