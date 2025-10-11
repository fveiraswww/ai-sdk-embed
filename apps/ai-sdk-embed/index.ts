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
  semanticCacheConfigSchema,
  type SemanticCacheConfig,
  validateEnvConfig,
} from "./schema";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function canonicalizeMessages(msgs: any[]) {
  return msgs.map((m) => ({
    role: m.role,
    content:
      typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  }));
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

export function createSemanticCache(config: SemanticCacheConfig) {
  const parsed = semanticCacheConfigSchema.parse(config);

  validateEnvConfig(parsed);

  const {
    vector,
    redis: redisConfig,
    threshold,
    ttl,
    simulateStream,
    debug,
    cacheMode,
    useFullMessages,
  } = parsed;
  const model = parsed.model as EmbeddingModel<string>;

  const index = new Index({
    url: vector.url as string,
    token: vector.token as string,
  });

  const redis = new Redis({
    url: redisConfig.url as string,
    token: redisConfig.token as string,
  });

  function getCacheKey(options: any): string {
    if (options.messages) {
      const messages = Array.isArray(options.messages) ? options.messages : [];

      // By default, use only the last message to avoid token limit issues
      if (!useFullMessages && messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        return JSON.stringify({
          role: lastMessage.role,
          content:
            typeof lastMessage.content === "string"
              ? lastMessage.content
              : JSON.stringify(lastMessage.content),
        });
      }

      return JSON.stringify(canonicalizeMessages(options.messages));
    }
    if (options.prompt) {
      return String(options.prompt);
    }
    return "";
  }

  async function checkSemanticCache(cacheInput: string, scope: any) {
    const promptNorm = norm(cacheInput);

    const { embedding } = await embed({
      model,
      value: promptNorm,
    });

    const result = await index.query({
      vector: embedding,
      topK: 3,
      includeMetadata: true,
    });

    const hit = result.find((m) => {
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
        if (debug) console.log("✅ cache hit", hit.score.toFixed(3));
        return { cached, embedding, promptNorm };
      }
    }

    if (debug) console.log("❌ miss -> generating…");
    return { cached: null, embedding, promptNorm };
  }

  async function storeInCache(
    id: string,
    data: any,
    embedding: number[],
    promptNorm: string,
    scope: any,
  ) {
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
            prompt: promptNorm,
            ...scope,
          },
        },
      ]);
    } finally {
      await redis.del(lockKey);
    }
  }

  const semanticCacheMiddleware: LanguageModelV2Middleware = {
    wrapStream: async ({ doStream, params }) => {
      const cacheInput = getCacheKey(params);
      const scope = buildScope(params);
      const promptScope = Object.values(scope).join("|");

      const { cached, embedding, promptNorm } = await checkSemanticCache(
        cacheInput,
        scope,
      );

      if (cached && cacheMode !== "refresh") {
        if (debug) console.log("✅ Returning cached stream");

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
          const id = "llm:" + sha(promptScope + "|" + promptNorm);
          await storeInCache(
            id,
            { streamParts: fullResponse },
            embedding,
            promptNorm,
            scope,
          );
        },
      });

      return {
        stream: stream.pipeThrough(transformStream),
        ...rest,
      };
    },

    wrapGenerate: async ({ doGenerate, params }) => {
      const cacheInput = getCacheKey(params);
      const scope = buildScope(params);
      const promptScope = Object.values(scope).join("|");

      const { cached, embedding, promptNorm } = await checkSemanticCache(
        cacheInput,
        scope,
      );

      if (cached && cacheMode !== "refresh") {
        if (debug) console.log("✅ Returning cached generation");

        if (cached?.response?.timestamp) {
          cached.response.timestamp = new Date(cached.response.timestamp);
        }

        type GenReturn<T> = T extends () => PromiseLike<infer R> ? R : never;
        return cached as unknown as GenReturn<typeof doGenerate>;
      }

      const result = await doGenerate();

      const id = "llm:" + sha(promptScope + "|" + promptNorm);
      await storeInCache(id, result, embedding, promptNorm, scope);

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
        middleware: semanticCacheMiddleware,
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
        middleware: semanticCacheMiddleware,
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
        middleware: semanticCacheMiddleware,
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
        middleware: semanticCacheMiddleware,
      });

      return streamObject({
        ...options,
        model: wrappedModel,
      }) as unknown as StreamObjectResult<T, T, any>;
    },
  };
}
