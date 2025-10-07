import {
  embed,
  streamText,
  generateText,
  generateObject,
  streamObject,
  simulateReadableStream,
  type EmbeddingModel,
  type StreamTextResult,
  type GenerateTextResult,
  type GenerateObjectResult,
  type StreamObjectResult,
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

  async function checkCache(cacheInput: string, scope: any) {
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
        streamParts?: any[];
        text?: string;
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

  return {
    streamText: async <TOOLS extends Record<string, any> = {}>(
      options: Parameters<typeof streamText<TOOLS>>[0],
    ): Promise<StreamTextResult<TOOLS, any>> => {
      const cacheInput = getCacheKey(options);
      const scope = buildScope(options);
      const promptScope = Object.values(scope).join("|");
      const { cached, embedding, promptNorm } = await checkCache(
        cacheInput,
        scope,
      );

      if (cached && cacheMode !== "refresh") {
        if (debug) console.log("✅ Cache hit - returning from cache");

        let sourceStream: ReadableStream;

        if (cached.streamParts && simulateStream.enabled) {
          const formattedChunks = cached.streamParts.map((p: any) => {
            if (p.type === "response-metadata" && p.timestamp) {
              return { ...p, timestamp: new Date(p.timestamp) };
            }
            return p;
          });

          sourceStream = simulateReadableStream({
            initialDelayInMs: simulateStream.initialDelayInMs,
            chunkDelayInMs: simulateStream.chunkDelayInMs,
            chunks: formattedChunks,
          });
        } else if (cached.streamParts) {
          sourceStream = simulateReadableStream({
            initialDelayInMs: 0,
            chunkDelayInMs: 0,
            chunks: cached.streamParts,
          });
        } else if (cached.text) {
          sourceStream = new ReadableStream({
            async start(controller) {
              controller.enqueue({
                type: "text-delta",
                textDelta: cached.text,
              });
              controller.close();
            },
          });
        } else {
          return streamText(options);
        }

        const transformStream = new TransformStream({
          start(controller) {
            // Pipe source stream through
            const reader = sourceStream.getReader();
            (async () => {
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  controller.enqueue(value);
                }
                controller.terminate();
              } catch (err) {
                controller.error(err);
              }
            })();
          },
        });

        // Return streamText with the transform
        return streamText({
          ...options,
          experimental_transform: () => transformStream,
        } as any);
      }

      if (debug) console.log("❌ Cache miss - generating new response");

      const capturedParts: any[] = [];

      const streamResult = streamText({
        ...options,
        experimental_transform: () =>
          new TransformStream({
            transform(chunk, controller) {
              capturedParts.push(chunk);
              controller.enqueue(chunk);
            },
          }),
      });

      (async () => {
        const finalText = await streamResult.text;
        const id = "llm:" + sha(promptScope + "|" + promptNorm);
        await storeInCache(
          id,
          { streamParts: capturedParts, text: finalText },
          embedding,
          promptNorm,
          scope,
        );
      })();

      return streamResult;
    },

    generateText: async <
      TOOLS extends Record<string, any> = {},
      OUTPUT = undefined,
    >(
      options: Parameters<typeof generateText<TOOLS, OUTPUT>>[0],
    ): Promise<GenerateTextResult<TOOLS, OUTPUT>> => {
      const cacheInput = getCacheKey(options);
      const scope = buildScope(options);
      const promptScope = Object.values(scope).join("|");
      const { cached, embedding, promptNorm } = await checkCache(
        cacheInput,
        scope,
      );

      if (cached && cacheMode !== "refresh") {
        return cached as GenerateTextResult<TOOLS, OUTPUT>;
      }

      const result = await generateText(options);
      const id = "llm:" + sha(promptScope + "|" + promptNorm);
      await storeInCache(id, result, embedding, promptNorm, scope);

      return result;
    },

    generateObject: async <T = any>(
      options: Parameters<typeof generateObject>[0],
    ): Promise<GenerateObjectResult<T>> => {
      const cacheInput = getCacheKey(options);
      const scope = buildScope(options);
      const promptScope = Object.values(scope).join("|");
      const { cached, embedding, promptNorm } = await checkCache(
        cacheInput,
        scope,
      );

      if (cached && cacheMode !== "refresh") {
        return cached as GenerateObjectResult<T>;
      }

      const result = await generateObject(options);
      const id = "llm:" + sha(promptScope + "|" + promptNorm);
      await storeInCache(id, result, embedding, promptNorm, scope);

      return result as GenerateObjectResult<T>;
    },

    streamObject: async <T = any>(
      options: Parameters<typeof streamObject>[0],
    ): Promise<StreamObjectResult<T, T, any>> => {
      const cacheInput = getCacheKey(options);
      const scope = buildScope(options);
      const promptScope = Object.values(scope).join("|");
      const { cached, embedding, promptNorm } = await checkCache(
        cacheInput,
        scope,
      );

      // Check cache only if not in refresh mode
      if (cached && cacheMode !== "refresh") {
        if (debug) console.log("✅ Cache hit - returning from cache");

        // Create transform stream from cached data
        let sourceStream: ReadableStream;

        if (cached.streamParts && simulateStream.enabled) {
          const formattedChunks = cached.streamParts.map((p: any) => {
            if (p.type === "response-metadata" && p.timestamp) {
              return { ...p, timestamp: new Date(p.timestamp) };
            }
            return p;
          });

          sourceStream = simulateReadableStream({
            initialDelayInMs: simulateStream.initialDelayInMs,
            chunkDelayInMs: simulateStream.chunkDelayInMs,
            chunks: formattedChunks,
          });
        } else if (cached.streamParts) {
          sourceStream = simulateReadableStream({
            initialDelayInMs: 0,
            chunkDelayInMs: 0,
            chunks: cached.streamParts,
          });
        } else {
          // No cached data, proceed normally
          return streamObject(options) as unknown as StreamObjectResult<
            T,
            T,
            any
          >;
        }

        const transformStream = new TransformStream({
          start(controller) {
            // Pipe source stream through
            const reader = sourceStream.getReader();
            (async () => {
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  controller.enqueue(value);
                }
                controller.terminate();
              } catch (err) {
                controller.error(err);
              }
            })();
          },
        });

        // Return streamObject with the transform
        return streamObject({
          ...options,
          experimental_transform: () => transformStream,
        } as any) as unknown as StreamObjectResult<T, T, any>;
      }

      if (debug) console.log("❌ Cache miss - generating new object stream");

      const capturedParts: any[] = [];

      const streamResult = streamObject({
        ...options,
        experimental_transform: () =>
          new TransformStream({
            transform(chunk, controller) {
              capturedParts.push(chunk);
              controller.enqueue(chunk);
            },
          }),
      } as any);

      (async () => {
        const id = "llm:" + sha(promptScope + "|" + promptNorm);
        await storeInCache(
          id,
          { streamParts: capturedParts },
          embedding,
          promptNorm,
          scope,
        );
      })();

      return streamResult as unknown as StreamObjectResult<T, T, any>;
    },
  };
}
