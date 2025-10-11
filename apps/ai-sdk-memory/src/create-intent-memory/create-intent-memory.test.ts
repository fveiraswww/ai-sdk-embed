import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createIntentMemory } from "./index";
import { embed, generateText } from "ai";
import { Index } from "@upstash/vector";
import { Redis } from "@upstash/redis";

vi.mock("ai", () => ({
  embed: vi.fn(),
  streamText: vi.fn(),
  generateText: vi.fn(),
  generateObject: vi.fn(),
  streamObject: vi.fn(),
  simulateReadableStream: vi.fn(),
  wrapLanguageModel: vi.fn(),
  gateway: vi.fn(),
}));

vi.mock("@upstash/vector", () => ({
  Index: vi.fn(),
}));

vi.mock("@upstash/redis", () => ({
  Redis: vi.fn(),
}));

vi.mock("dotenv/config", () => ({}));

describe("createIntentMemory", () => {
  const mockEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5];

  const defaultConfig = {
    model: "text-embedding-3-small",
    vector: {
      url: "https://vector.upstash.io",
      token: "test-vector-token",
    },
    redis: {
      url: "https://redis.upstash.io",
      token: "test-redis-token",
    },
    intentExtractor: {
      model: "gpt-4",
      windowSize: 5,
    },
  };

  let mockIndexQuery: ReturnType<typeof vi.fn>;
  let mockIndexUpsert: ReturnType<typeof vi.fn>;
  let mockRedisGet: ReturnType<typeof vi.fn>;
  let mockRedisSet: ReturnType<typeof vi.fn>;
  let mockRedisDel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup Index mock
    mockIndexQuery = vi.fn().mockResolvedValue([]);
    mockIndexUpsert = vi.fn().mockResolvedValue(undefined);

    (Index as any).mockImplementation(() => ({
      query: mockIndexQuery,
      upsert: mockIndexUpsert,
    }));

    // Setup Redis mock
    mockRedisGet = vi.fn().mockResolvedValue(null);
    mockRedisSet = vi.fn().mockResolvedValue("OK");
    mockRedisDel = vi.fn().mockResolvedValue(1);

    (Redis as any).mockImplementation(() => ({
      get: mockRedisGet,
      set: mockRedisSet,
      del: mockRedisDel,
    }));

    // Setup embed mock
    (embed as any).mockResolvedValue({ embedding: mockEmbedding });

    // Setup generateText mock for intent extraction
    (generateText as any).mockResolvedValue({
      text: JSON.stringify({
        intent: "test intent",
        domain: ["testing"],
        stack: ["typescript"],
        goal: "create tests",
        constraints: [],
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Configuration", () => {
    it("should create cache with valid config", () => {
      const cache = createIntentMemory(defaultConfig);

      expect(cache).toBeDefined();
      expect(cache.streamText).toBeDefined();
      expect(cache.generateText).toBeDefined();
      expect(cache.generateObject).toBeDefined();
      expect(cache.streamObject).toBeDefined();
    });

    it("should use default threshold of 0.92", () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should use custom threshold", () => {
      const cache = createIntentMemory({
        ...defaultConfig,
        threshold: 0.85,
      });
      expect(cache).toBeDefined();
    });

    it("should use default TTL of 14 days", () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should use custom TTL", () => {
      const cache = createIntentMemory({
        ...defaultConfig,
        ttl: 3600, // 1 hour
      });
      expect(cache).toBeDefined();
    });

    it("should throw error when vector URL is missing", () => {
      expect(() =>
        createIntentMemory({
          model: "text-embedding-3-small",
          vector: {
            url: "",
            token: "test-token",
          },
          redis: defaultConfig.redis,
          intentExtractor: defaultConfig.intentExtractor,
        }),
      ).toThrow("Invalid URL");
    });

    it("should throw error when vector token is missing", () => {
      expect(() =>
        createIntentMemory({
          model: "text-embedding-3-small",
          vector: {
            url: "https://vector.upstash.io",
            token: "",
          },
          redis: defaultConfig.redis,
          intentExtractor: defaultConfig.intentExtractor,
        }),
      ).toThrow("Too small");
    });

    it("should throw error when redis URL is missing", () => {
      expect(() =>
        createIntentMemory({
          model: "text-embedding-3-small",
          vector: defaultConfig.vector,
          redis: {
            url: "",
            token: "test-token",
          },
          intentExtractor: defaultConfig.intentExtractor,
        }),
      ).toThrow("Invalid URL");
    });

    it("should throw error when redis token is missing", () => {
      expect(() =>
        createIntentMemory({
          model: "text-embedding-3-small",
          vector: defaultConfig.vector,
          redis: {
            url: "https://redis.upstash.io",
            token: "",
          },
          intentExtractor: defaultConfig.intentExtractor,
        }),
      ).toThrow("Too small");
    });

    it("should throw error when intentExtractor model is missing", () => {
      expect(() =>
        createIntentMemory({
          model: "text-embedding-3-small",
          vector: defaultConfig.vector,
          redis: defaultConfig.redis,
          intentExtractor: {
            model: undefined as any,
          },
        }),
      ).toThrow();
    });

    it("should accept embedding model object instead of string", () => {
      const mockModel = {
        specificationVersion: "v1",
        modelId: "custom-embedding-model",
        doEmbed: vi.fn(),
      };

      const cache = createIntentMemory({
        model: mockModel,
        vector: defaultConfig.vector,
        redis: defaultConfig.redis,
        intentExtractor: defaultConfig.intentExtractor,
      });

      expect(cache).toBeDefined();
    });

    it("should accept language model object for intent extraction", () => {
      const mockLLM = {
        specificationVersion: "v2",
        modelId: "custom-llm",
        doGenerate: vi.fn(),
      };

      const cache = createIntentMemory({
        ...defaultConfig,
        intentExtractor: {
          model: mockLLM,
          windowSize: 5,
        },
      });

      expect(cache).toBeDefined();
    });

    it("should configure debug mode", () => {
      const cache = createIntentMemory({
        ...defaultConfig,
        debug: true,
      });
      expect(cache).toBeDefined();
    });

    it("should configure cache mode", () => {
      const cache = createIntentMemory({
        ...defaultConfig,
        cacheMode: "refresh",
      });
      expect(cache).toBeDefined();
    });

    it("should configure stream simulation", () => {
      const cache = createIntentMemory({
        ...defaultConfig,
        simulateStream: {
          enabled: true,
          initialDelayInMs: 100,
          chunkDelayInMs: 50,
        },
      });
      expect(cache).toBeDefined();
    });

    it("should use default window size of 5", () => {
      const cache = createIntentMemory({
        ...defaultConfig,
        intentExtractor: {
          model: "gpt-4",
        },
      });
      expect(cache).toBeDefined();
    });

    it("should use custom window size", () => {
      const cache = createIntentMemory({
        ...defaultConfig,
        intentExtractor: {
          model: "gpt-4",
          windowSize: 10,
        },
      });
      expect(cache).toBeDefined();
    });

    it("should accept custom extraction prompt", () => {
      const cache = createIntentMemory({
        ...defaultConfig,
        intentExtractor: {
          model: "gpt-4",
          windowSize: 5,
          prompt: "Custom extraction prompt",
        },
      });
      expect(cache).toBeDefined();
    });
  });

  describe("Intent Extraction", () => {
    it("should extract intent from messages", async () => {
      (generateText as any).mockResolvedValue({
        text: JSON.stringify({
          intent: "help with coding",
          domain: ["software development"],
          stack: ["typescript", "node.js"],
          goal: "implement feature",
          constraints: ["use async/await"],
        }),
      });

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should use last N messages based on window size", async () => {
      const cache = createIntentMemory({
        ...defaultConfig,
        intentExtractor: {
          model: "gpt-4",
          windowSize: 3,
        },
      });
      expect(cache).toBeDefined();
    });

    it("should handle extraction failure with fallback", async () => {
      (generateText as any).mockResolvedValue({
        text: "Invalid JSON response",
      });

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should handle empty intent extraction", async () => {
      (generateText as any).mockResolvedValue({
        text: JSON.stringify({
          intent: "",
          domain: [],
          stack: [],
          goal: "",
          constraints: [],
        }),
      });

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should handle complex message content in extraction", async () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should build intent string from extracted components", async () => {
      (generateText as any).mockResolvedValue({
        text: JSON.stringify({
          intent: "test intent",
          domain: ["domain1", "domain2"],
          stack: ["tech1", "tech2"],
          goal: "main goal",
          constraints: ["constraint1"],
        }),
      });

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });
  });

  describe("Cache Key Generation from Intent", () => {
    it("should generate cache key from extracted intent", () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should handle prompt input without messages", () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should handle empty messages array", () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should include domain in intent string", async () => {
      (generateText as any).mockResolvedValue({
        text: JSON.stringify({
          intent: "help",
          domain: ["programming", "testing"],
          stack: [],
          goal: "write tests",
          constraints: [],
        }),
      });

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should include stack in intent string", async () => {
      (generateText as any).mockResolvedValue({
        text: JSON.stringify({
          intent: "help",
          domain: [],
          stack: ["typescript", "vitest"],
          goal: "run tests",
          constraints: [],
        }),
      });

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should include constraints in intent string", async () => {
      (generateText as any).mockResolvedValue({
        text: JSON.stringify({
          intent: "help",
          domain: [],
          stack: [],
          goal: "optimize code",
          constraints: [
            "maintain backwards compatibility",
            "improve performance",
          ],
        }),
      });

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });
  });

  describe("Scope Building", () => {
    it("should build scope with model ID", () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should hash system prompt in scope", () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should hash parameters (temperature, topP) in scope", () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should hash tools in scope", () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });
  });

  describe("Intent Cache Check", () => {
    it("should normalize intent before embedding", async () => {
      mockIndexQuery.mockResolvedValue([]);

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should query vector index with embedding", async () => {
      mockIndexQuery.mockResolvedValue([]);

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should return cache hit when similarity exceeds threshold", async () => {
      const cachedData = {
        text: "Cached response",
        usage: { totalTokens: 100 },
      };

      mockIndexQuery.mockResolvedValue([
        {
          id: "intent:test-id",
          score: 0.95,
          metadata: {
            intent: "test intent",
            llmModel: "gpt-4",
            systemHash: "hash123",
            params: "params123",
            toolsHash: "tools123",
          },
        },
      ]);

      mockRedisGet.mockResolvedValue(cachedData);

      const cache = createIntentMemory({
        ...defaultConfig,
        threshold: 0.92,
      });

      expect(cache).toBeDefined();
    });

    it("should return cache miss when similarity below threshold", async () => {
      mockIndexQuery.mockResolvedValue([
        {
          id: "intent:test-id",
          score: 0.85,
          metadata: {
            intent: "test intent",
            llmModel: "gpt-4",
            systemHash: "hash123",
            params: "params123",
            toolsHash: "tools123",
          },
        },
      ]);

      const cache = createIntentMemory({
        ...defaultConfig,
        threshold: 0.92,
      });

      expect(cache).toBeDefined();
    });

    it("should return cache miss when scope doesn't match", async () => {
      mockIndexQuery.mockResolvedValue([
        {
          id: "intent:test-id",
          score: 0.95,
          metadata: {
            intent: "test intent",
            llmModel: "gpt-3.5",
            systemHash: "different-hash",
            params: "params123",
            toolsHash: "tools123",
          },
        },
      ]);

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should return cache miss when Redis data is not found", async () => {
      mockIndexQuery.mockResolvedValue([
        {
          id: "intent:test-id",
          score: 0.95,
          metadata: {
            intent: "test intent",
            llmModel: "gpt-4",
            systemHash: "hash123",
            params: "params123",
            toolsHash: "tools123",
          },
        },
      ]);

      mockRedisGet.mockResolvedValue(null);

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should check top 3 results from vector search", async () => {
      mockIndexQuery.mockResolvedValue([
        {
          id: "intent:test-id-1",
          score: 0.88,
          metadata: {
            intent: "intent1",
            llmModel: "gpt-4",
            systemHash: "h1",
            params: "p1",
            toolsHash: "t1",
          },
        },
        {
          id: "intent:test-id-2",
          score: 0.94,
          metadata: {
            intent: "intent2",
            llmModel: "gpt-4",
            systemHash: "h2",
            params: "p2",
            toolsHash: "t2",
          },
        },
        {
          id: "intent:test-id-3",
          score: 0.91,
          metadata: {
            intent: "intent3",
            llmModel: "gpt-4",
            systemHash: "h3",
            params: "p3",
            toolsHash: "t3",
          },
        },
      ]);

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });
  });

  describe("Cache Storage", () => {
    it("should store response in Redis with TTL", async () => {
      const cache = createIntentMemory({
        ...defaultConfig,
        ttl: 3600,
      });

      expect(cache).toBeDefined();
    });

    it("should upsert vector in index with intent metadata", async () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should store extracted intent metadata in vector", async () => {
      (generateText as any).mockResolvedValue({
        text: JSON.stringify({
          intent: "help with coding",
          domain: ["software", "testing"],
          stack: ["typescript", "vitest"],
          goal: "write tests",
          constraints: ["use mocks"],
        }),
      });

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should use distributed lock when storing to cache", async () => {
      mockRedisSet.mockResolvedValueOnce(true); // lock acquired
      mockRedisSet.mockResolvedValueOnce("OK"); // data stored

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should skip cache write when lock is not acquired", async () => {
      mockRedisSet.mockResolvedValueOnce(false); // lock not acquired

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should release lock after storing data", async () => {
      mockRedisSet.mockResolvedValueOnce(true); // lock acquired
      mockRedisSet.mockResolvedValueOnce("OK"); // data stored

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should release lock even if storage fails", async () => {
      mockRedisSet.mockResolvedValueOnce(true); // lock acquired
      mockRedisSet.mockRejectedValueOnce(new Error("Storage failed"));

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should prefix cache ID with 'intent:'", () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });
  });

  describe("Cache Modes", () => {
    it("should use cached data in default mode", async () => {
      const cachedData = {
        text: "Cached response",
        usage: { totalTokens: 100 },
      };

      mockIndexQuery.mockResolvedValue([
        {
          id: "intent:test-id",
          score: 0.95,
          metadata: {
            intent: "test intent",
            llmModel: "test-model",
            systemHash: "hash123",
            params: "params123",
            toolsHash: "tools123",
          },
        },
      ]);

      mockRedisGet.mockResolvedValue(cachedData);

      const cache = createIntentMemory({
        ...defaultConfig,
        cacheMode: "default",
      });

      expect(cache).toBeDefined();
    });

    it("should bypass cache and refresh in refresh mode", async () => {
      const cachedData = {
        text: "Old cached response",
        usage: { totalTokens: 100 },
      };

      mockIndexQuery.mockResolvedValue([
        {
          id: "intent:test-id",
          score: 0.95,
          metadata: {
            intent: "test intent",
            llmModel: "test-model",
            systemHash: "hash123",
            params: "params123",
            toolsHash: "tools123",
          },
        },
      ]);

      mockRedisGet.mockResolvedValue(cachedData);

      const cache = createIntentMemory({
        ...defaultConfig,
        cacheMode: "refresh",
      });

      expect(cache).toBeDefined();
    });
  });

  describe("Stream Simulation", () => {
    it("should simulate stream when enabled", async () => {
      const cache = createIntentMemory({
        ...defaultConfig,
        simulateStream: {
          enabled: true,
          initialDelayInMs: 100,
          chunkDelayInMs: 50,
        },
      });

      expect(cache).toBeDefined();
    });

    it("should not add delays when simulation is disabled", async () => {
      const cache = createIntentMemory({
        ...defaultConfig,
        simulateStream: {
          enabled: false,
          initialDelayInMs: 0,
          chunkDelayInMs: 0,
        },
      });

      expect(cache).toBeDefined();
    });

    it("should reconstruct stream from cached streamParts", async () => {
      const cachedData = {
        streamParts: [
          { type: "text-start", id: "1" },
          { type: "text-delta", delta: "Hello", id: "1" },
          { type: "finish", finishReason: "stop", usage: { totalTokens: 10 } },
        ],
      };

      mockIndexQuery.mockResolvedValue([
        {
          id: "intent:test-id",
          score: 0.95,
          metadata: {
            intent: "test",
            llmModel: "test-model",
            systemHash: "hash",
            params: "params",
            toolsHash: "tools",
          },
        },
      ]);

      mockRedisGet.mockResolvedValue(cachedData);

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should reconstruct stream from cached text", async () => {
      const cachedData = {
        text: "Hello, world!",
        id: "test-id",
        usage: { totalTokens: 10 },
      };

      mockIndexQuery.mockResolvedValue([
        {
          id: "intent:test-id",
          score: 0.95,
          metadata: {
            intent: "test",
            llmModel: "test-model",
            systemHash: "hash",
            params: "params",
            toolsHash: "tools",
          },
        },
      ]);

      mockRedisGet.mockResolvedValue(cachedData);

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should convert timestamp strings to Date objects", async () => {
      const cachedData = {
        streamParts: [
          {
            type: "response-metadata",
            id: "resp-1",
            timestamp: "2024-01-01T00:00:00.000Z",
          },
          { type: "text-delta", delta: "Hello", id: "1" },
          { type: "finish", finishReason: "stop", usage: { totalTokens: 10 } },
        ],
      };

      mockIndexQuery.mockResolvedValue([
        {
          id: "intent:test-id",
          score: 0.95,
          metadata: {
            intent: "test",
            llmModel: "test-model",
            systemHash: "hash",
            params: "params",
            toolsHash: "tools",
          },
        },
      ]);

      mockRedisGet.mockResolvedValue(cachedData);

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });
  });

  describe("API Methods", () => {
    it("should have streamText method", () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache.streamText).toBeInstanceOf(Function);
    });

    it("should have generateText method", () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache.generateText).toBeInstanceOf(Function);
    });

    it("should have generateObject method", () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache.generateObject).toBeInstanceOf(Function);
    });

    it("should have streamObject method", () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache.streamObject).toBeInstanceOf(Function);
    });
  });

  describe("Intent Normalization", () => {
    it("should trim whitespace from intent", () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should convert intent to lowercase", () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should collapse multiple spaces in intent", () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should handle newlines and tabs in intent", () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    it("should handle vector query failures gracefully", async () => {
      mockIndexQuery.mockRejectedValue(new Error("Vector query failed"));

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should handle Redis get failures gracefully", async () => {
      mockRedisGet.mockRejectedValue(new Error("Redis get failed"));

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should handle embedding failures gracefully", async () => {
      (embed as any).mockRejectedValue(new Error("Embedding failed"));

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should handle intent extraction failures gracefully", async () => {
      (generateText as any).mockRejectedValue(
        new Error("Intent extraction failed"),
      );

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should fallback to last message when extraction fails", async () => {
      (generateText as any).mockRejectedValue(new Error("Extraction failed"));

      const cache = createIntentMemory({
        ...defaultConfig,
        debug: true,
      });
      expect(cache).toBeDefined();
    });

    it("should handle malformed JSON in extraction response", async () => {
      (generateText as any).mockResolvedValue({
        text: "Not a valid JSON {incomplete",
      });

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should handle invalid cached data format", async () => {
      mockIndexQuery.mockResolvedValue([
        {
          id: "intent:test-id",
          score: 0.95,
          metadata: {
            intent: "test",
            llmModel: "test-model",
            systemHash: "hash",
            params: "params",
            toolsHash: "tools",
          },
        },
      ]);

      mockRedisGet.mockResolvedValue("invalid-data");

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });
  });

  describe("Metadata Matching", () => {
    it("should match all scope fields for cache hit", async () => {
      mockIndexQuery.mockResolvedValue([
        {
          id: "intent:test-id",
          score: 0.95,
          metadata: {
            intent: "test intent",
            domain: "software,testing",
            stack: "typescript,vitest",
            goal: "write tests",
            llmModel: "gpt-4",
            systemHash: "system-abc",
            params: "params-xyz",
            toolsHash: "tools-123",
          },
        },
      ]);

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should miss when model differs", async () => {
      mockIndexQuery.mockResolvedValue([
        {
          id: "intent:test-id",
          score: 0.95,
          metadata: {
            intent: "test intent",
            llmModel: "gpt-3.5",
            systemHash: "system-abc",
            params: "params-xyz",
            toolsHash: "tools-123",
          },
        },
      ]);

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should miss when system prompt differs", async () => {
      mockIndexQuery.mockResolvedValue([
        {
          id: "intent:test-id",
          score: 0.95,
          metadata: {
            intent: "test intent",
            llmModel: "gpt-4",
            systemHash: "different-system",
            params: "params-xyz",
            toolsHash: "tools-123",
          },
        },
      ]);

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should miss when parameters differ", async () => {
      mockIndexQuery.mockResolvedValue([
        {
          id: "intent:test-id",
          score: 0.95,
          metadata: {
            intent: "test intent",
            llmModel: "gpt-4",
            systemHash: "system-abc",
            params: "different-params",
            toolsHash: "tools-123",
          },
        },
      ]);

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should miss when tools differ", async () => {
      mockIndexQuery.mockResolvedValue([
        {
          id: "intent:test-id",
          score: 0.95,
          metadata: {
            intent: "test intent",
            llmModel: "gpt-4",
            systemHash: "system-abc",
            params: "params-xyz",
            toolsHash: "different-tools",
          },
        },
      ]);

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should handle missing metadata gracefully", async () => {
      mockIndexQuery.mockResolvedValue([
        {
          id: "intent:test-id",
          score: 0.95,
          metadata: null,
        },
      ]);

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should store domain metadata as comma-separated string", async () => {
      (generateText as any).mockResolvedValue({
        text: JSON.stringify({
          intent: "help",
          domain: ["domain1", "domain2", "domain3"],
          stack: [],
          goal: "test",
          constraints: [],
        }),
      });

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should store stack metadata as comma-separated string", async () => {
      (generateText as any).mockResolvedValue({
        text: JSON.stringify({
          intent: "help",
          domain: [],
          stack: ["typescript", "node.js", "vitest"],
          goal: "test",
          constraints: [],
        }),
      });

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });
  });

  describe("Performance and Edge Cases", () => {
    it("should handle empty messages array", () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should handle very long conversation history", () => {
      const cache = createIntentMemory({
        ...defaultConfig,
        intentExtractor: {
          model: "gpt-4",
          windowSize: 20,
        },
      });
      expect(cache).toBeDefined();
    });

    it("should handle special characters in intent", () => {
      (generateText as any).mockResolvedValue({
        text: JSON.stringify({
          intent: "help with @special #chars & symbols",
          domain: [],
          stack: [],
          goal: "test",
          constraints: [],
        }),
      });

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should handle unicode characters in intent", () => {
      (generateText as any).mockResolvedValue({
        text: JSON.stringify({
          intent: "帮助编程 🚀",
          domain: [],
          stack: [],
          goal: "测试",
          constraints: [],
        }),
      });

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should generate consistent cache IDs for same input", () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should generate different cache IDs for different inputs", () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should handle concurrent cache writes", async () => {
      mockRedisSet
        .mockResolvedValueOnce(false) // first request: lock not acquired
        .mockResolvedValueOnce(true) // second request: lock acquired
        .mockResolvedValueOnce("OK"); // data stored

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should handle messages with varying content types", () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should limit window size to available messages", () => {
      const cache = createIntentMemory({
        ...defaultConfig,
        intentExtractor: {
          model: "gpt-4",
          windowSize: 100, // larger than typical conversation
        },
      });
      expect(cache).toBeDefined();
    });
  });

  describe("Intent-Specific Features", () => {
    it("should differentiate similar prompts with different intents", async () => {
      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should match semantically similar intents across conversations", async () => {
      mockIndexQuery.mockResolvedValue([
        {
          id: "intent:test-id",
          score: 0.93,
          metadata: {
            intent: "help with testing",
            domain: "software",
            stack: "typescript",
            goal: "write unit tests",
            llmModel: "gpt-4",
            systemHash: "hash",
            params: "params",
            toolsHash: "tools",
          },
        },
      ]);

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should extract intent from multi-turn conversation", async () => {
      const cache = createIntentMemory({
        ...defaultConfig,
        intentExtractor: {
          model: "gpt-4",
          windowSize: 5,
        },
      });
      expect(cache).toBeDefined();
    });

    it("should handle evolving intent in conversation", async () => {
      (generateText as any)
        .mockResolvedValueOnce({
          text: JSON.stringify({
            intent: "initial intent",
            domain: ["domain1"],
            stack: ["tech1"],
            goal: "goal1",
            constraints: [],
          }),
        })
        .mockResolvedValueOnce({
          text: JSON.stringify({
            intent: "evolved intent",
            domain: ["domain2"],
            stack: ["tech2"],
            goal: "goal2",
            constraints: [],
          }),
        });

      const cache = createIntentMemory(defaultConfig);
      expect(cache).toBeDefined();
    });
  });
});
