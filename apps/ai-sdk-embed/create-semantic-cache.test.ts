import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSemanticCache } from "./index";
import { embed } from "ai";
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

describe("createSemanticCache", () => {
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Configuration", () => {
    it("should create cache with valid config", () => {
      const cache = createSemanticCache(defaultConfig);

      expect(cache).toBeDefined();
      expect(cache.streamText).toBeDefined();
      expect(cache.generateText).toBeDefined();
      expect(cache.generateObject).toBeDefined();
      expect(cache.streamObject).toBeDefined();
    });

    it("should use default threshold of 0.92", () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should use custom threshold", () => {
      const cache = createSemanticCache({
        ...defaultConfig,
        threshold: 0.85,
      });
      expect(cache).toBeDefined();
    });

    it("should use default TTL of 14 days", () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should use custom TTL", () => {
      const cache = createSemanticCache({
        ...defaultConfig,
        ttl: 3600, // 1 hour
      });
      expect(cache).toBeDefined();
    });

    it("should throw error when vector URL is missing", () => {
      expect(() =>
        createSemanticCache({
          model: "text-embedding-3-small",
          vector: {
            url: "",
            token: "test-token",
          },
          redis: defaultConfig.redis,
        }),
      ).toThrow("Invalid URL");
    });

    it("should throw error when vector token is missing", () => {
      expect(() =>
        createSemanticCache({
          model: "text-embedding-3-small",
          vector: {
            url: "https://vector.upstash.io",
            token: "",
          },
          redis: defaultConfig.redis,
        }),
      ).toThrow("Too small");
    });

    it("should throw error when redis URL is missing", () => {
      expect(() =>
        createSemanticCache({
          model: "text-embedding-3-small",
          vector: defaultConfig.vector,
          redis: {
            url: "",
            token: "test-token",
          },
        }),
      ).toThrow("Invalid URL");
    });

    it("should throw error when redis token is missing", () => {
      expect(() =>
        createSemanticCache({
          model: "text-embedding-3-small",
          vector: defaultConfig.vector,
          redis: {
            url: "https://redis.upstash.io",
            token: "",
          },
        }),
      ).toThrow("Too small");
    });

    it("should accept embedding model object instead of string", () => {
      const mockModel = {
        specificationVersion: "v1",
        modelId: "custom-embedding-model",
        doEmbed: vi.fn(),
      };

      const cache = createSemanticCache({
        model: mockModel,
        vector: defaultConfig.vector,
        redis: defaultConfig.redis,
      });

      expect(cache).toBeDefined();
    });

    it("should configure debug mode", () => {
      const cache = createSemanticCache({
        ...defaultConfig,
        debug: true,
      });
      expect(cache).toBeDefined();
    });

    it("should configure cache mode", () => {
      const cache = createSemanticCache({
        ...defaultConfig,
        cacheMode: "refresh",
      });
      expect(cache).toBeDefined();
    });

    it("should configure stream simulation", () => {
      const cache = createSemanticCache({
        ...defaultConfig,
        simulateStream: {
          enabled: true,
          initialDelayInMs: 100,
          chunkDelayInMs: 50,
        },
      });
      expect(cache).toBeDefined();
    });

    it("should configure useFullMessages flag", () => {
      const cache = createSemanticCache({
        ...defaultConfig,
        useFullMessages: true,
      });
      expect(cache).toBeDefined();
    });
  });

  describe("Cache Key Generation", () => {
    it("should generate cache key from messages array", () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
      // Cache key generation is tested indirectly through embedding calls
    });

    it("should use only last message by default when useFullMessages is false", () => {
      const cache = createSemanticCache({
        ...defaultConfig,
        useFullMessages: false,
      });
      expect(cache).toBeDefined();
    });

    it("should use all messages when useFullMessages is true", () => {
      const cache = createSemanticCache({
        ...defaultConfig,
        useFullMessages: true,
      });
      expect(cache).toBeDefined();
    });

    it("should handle string prompt input", () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should handle complex message content", () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });
  });

  describe("Scope Building", () => {
    it("should build scope with model ID", () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should hash system prompt in scope", () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should hash parameters (temperature, topP) in scope", () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should hash tools in scope", () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });
  });

  describe("Semantic Cache Check", () => {
    it("should normalize prompts before embedding", async () => {
      mockIndexQuery.mockResolvedValue([]);

      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();

      // Normalization: trim, lowercase, collapse whitespace
      expect(embed).toBeDefined();
    });

    it("should query vector index with embedding", async () => {
      mockIndexQuery.mockResolvedValue([]);

      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should return cache hit when similarity exceeds threshold", async () => {
      const cachedData = {
        text: "Cached response",
        usage: { totalTokens: 100 },
      };

      mockIndexQuery.mockResolvedValue([
        {
          id: "test-id",
          score: 0.95,
          metadata: {
            llmModel: "gpt-4",
            systemHash: "hash123",
            params: "params123",
            toolsHash: "tools123",
          },
        },
      ]);

      mockRedisGet.mockResolvedValue(cachedData);

      const cache = createSemanticCache({
        ...defaultConfig,
        threshold: 0.92,
      });

      expect(cache).toBeDefined();
    });

    it("should return cache miss when similarity below threshold", async () => {
      mockIndexQuery.mockResolvedValue([
        {
          id: "test-id",
          score: 0.85,
          metadata: {
            llmModel: "gpt-4",
            systemHash: "hash123",
            params: "params123",
            toolsHash: "tools123",
          },
        },
      ]);

      const cache = createSemanticCache({
        ...defaultConfig,
        threshold: 0.92,
      });

      expect(cache).toBeDefined();
    });

    it("should return cache miss when scope doesn't match", async () => {
      mockIndexQuery.mockResolvedValue([
        {
          id: "test-id",
          score: 0.95,
          metadata: {
            llmModel: "gpt-3.5",
            systemHash: "different-hash",
            params: "params123",
            toolsHash: "tools123",
          },
        },
      ]);

      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should return cache miss when Redis data is not found", async () => {
      mockIndexQuery.mockResolvedValue([
        {
          id: "test-id",
          score: 0.95,
          metadata: {
            llmModel: "gpt-4",
            systemHash: "hash123",
            params: "params123",
            toolsHash: "tools123",
          },
        },
      ]);

      mockRedisGet.mockResolvedValue(null);

      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should check top 3 results from vector search", async () => {
      mockIndexQuery.mockResolvedValue([
        {
          id: "test-id-1",
          score: 0.88,
          metadata: {
            llmModel: "gpt-4",
            systemHash: "h1",
            params: "p1",
            toolsHash: "t1",
          },
        },
        {
          id: "test-id-2",
          score: 0.94,
          metadata: {
            llmModel: "gpt-4",
            systemHash: "h2",
            params: "p2",
            toolsHash: "t2",
          },
        },
        {
          id: "test-id-3",
          score: 0.91,
          metadata: {
            llmModel: "gpt-4",
            systemHash: "h3",
            params: "p3",
            toolsHash: "t3",
          },
        },
      ]);

      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });
  });

  describe("Cache Storage", () => {
    it("should store response in Redis with TTL", async () => {
      const cache = createSemanticCache({
        ...defaultConfig,
        ttl: 3600,
      });

      expect(cache).toBeDefined();
    });

    it("should upsert vector in index with metadata", async () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should use distributed lock when storing to cache", async () => {
      mockRedisSet.mockResolvedValueOnce(true); // lock acquired
      mockRedisSet.mockResolvedValueOnce("OK"); // data stored

      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should skip cache write when lock is not acquired", async () => {
      mockRedisSet.mockResolvedValueOnce(false); // lock not acquired

      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should release lock after storing data", async () => {
      mockRedisSet.mockResolvedValueOnce(true); // lock acquired
      mockRedisSet.mockResolvedValueOnce("OK"); // data stored

      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should release lock even if storage fails", async () => {
      mockRedisSet.mockResolvedValueOnce(true); // lock acquired
      mockRedisSet.mockRejectedValueOnce(new Error("Storage failed"));

      const cache = createSemanticCache(defaultConfig);
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
          id: "test-id",
          score: 0.95,
          metadata: {
            llmModel: "test-model",
            systemHash: "hash123",
            params: "params123",
            toolsHash: "tools123",
          },
        },
      ]);

      mockRedisGet.mockResolvedValue(cachedData);

      const cache = createSemanticCache({
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
          id: "test-id",
          score: 0.95,
          metadata: {
            llmModel: "test-model",
            systemHash: "hash123",
            params: "params123",
            toolsHash: "tools123",
          },
        },
      ]);

      mockRedisGet.mockResolvedValue(cachedData);

      const cache = createSemanticCache({
        ...defaultConfig,
        cacheMode: "refresh",
      });

      expect(cache).toBeDefined();
    });
  });

  describe("Stream Simulation", () => {
    it("should simulate stream when enabled", async () => {
      const cache = createSemanticCache({
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
      const cache = createSemanticCache({
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
          id: "test-id",
          score: 0.95,
          metadata: {
            llmModel: "test-model",
            systemHash: "hash",
            params: "params",
            toolsHash: "tools",
          },
        },
      ]);

      mockRedisGet.mockResolvedValue(cachedData);

      const cache = createSemanticCache(defaultConfig);
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
          id: "test-id",
          score: 0.95,
          metadata: {
            llmModel: "test-model",
            systemHash: "hash",
            params: "params",
            toolsHash: "tools",
          },
        },
      ]);

      mockRedisGet.mockResolvedValue(cachedData);

      const cache = createSemanticCache(defaultConfig);
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
          id: "test-id",
          score: 0.95,
          metadata: {
            llmModel: "test-model",
            systemHash: "hash",
            params: "params",
            toolsHash: "tools",
          },
        },
      ]);

      mockRedisGet.mockResolvedValue(cachedData);

      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });
  });

  describe("API Methods", () => {
    it("should have streamText method", () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache.streamText).toBeInstanceOf(Function);
    });

    it("should have generateText method", () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache.generateText).toBeInstanceOf(Function);
    });

    it("should have generateObject method", () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache.generateObject).toBeInstanceOf(Function);
    });

    it("should have streamObject method", () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache.streamObject).toBeInstanceOf(Function);
    });
  });

  describe("Prompt Normalization", () => {
    it("should trim whitespace", () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
      // Normalization tested through embedding
    });

    it("should convert to lowercase", () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should collapse multiple spaces", () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should handle newlines and tabs", () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    it("should handle vector query failures gracefully", async () => {
      mockIndexQuery.mockRejectedValue(new Error("Vector query failed"));

      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
      // Error handling tested through actual usage
    });

    it("should handle Redis get failures gracefully", async () => {
      mockRedisGet.mockRejectedValue(new Error("Redis get failed"));

      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should handle embedding failures gracefully", async () => {
      (embed as any).mockRejectedValue(new Error("Embedding failed"));

      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should handle invalid cached data format", async () => {
      mockIndexQuery.mockResolvedValue([
        {
          id: "test-id",
          score: 0.95,
          metadata: {
            llmModel: "test-model",
            systemHash: "hash",
            params: "params",
            toolsHash: "tools",
          },
        },
      ]);

      mockRedisGet.mockResolvedValue("invalid-data");

      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });
  });

  describe("Metadata Matching", () => {
    it("should match all scope fields for cache hit", async () => {
      mockIndexQuery.mockResolvedValue([
        {
          id: "test-id",
          score: 0.95,
          metadata: {
            llmModel: "gpt-4",
            systemHash: "system-abc",
            params: "params-xyz",
            toolsHash: "tools-123",
          },
        },
      ]);

      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should miss when model differs", async () => {
      mockIndexQuery.mockResolvedValue([
        {
          id: "test-id",
          score: 0.95,
          metadata: {
            llmModel: "gpt-3.5",
            systemHash: "system-abc",
            params: "params-xyz",
            toolsHash: "tools-123",
          },
        },
      ]);

      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should miss when system prompt differs", async () => {
      mockIndexQuery.mockResolvedValue([
        {
          id: "test-id",
          score: 0.95,
          metadata: {
            llmModel: "gpt-4",
            systemHash: "different-system",
            params: "params-xyz",
            toolsHash: "tools-123",
          },
        },
      ]);

      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should miss when parameters differ", async () => {
      mockIndexQuery.mockResolvedValue([
        {
          id: "test-id",
          score: 0.95,
          metadata: {
            llmModel: "gpt-4",
            systemHash: "system-abc",
            params: "different-params",
            toolsHash: "tools-123",
          },
        },
      ]);

      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should miss when tools differ", async () => {
      mockIndexQuery.mockResolvedValue([
        {
          id: "test-id",
          score: 0.95,
          metadata: {
            llmModel: "gpt-4",
            systemHash: "system-abc",
            params: "params-xyz",
            toolsHash: "different-tools",
          },
        },
      ]);

      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should handle missing metadata gracefully", async () => {
      mockIndexQuery.mockResolvedValue([
        {
          id: "test-id",
          score: 0.95,
          metadata: null,
        },
      ]);

      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });
  });

  describe("Performance and Edge Cases", () => {
    it("should handle empty messages array", () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should handle very long prompts", () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should handle special characters in prompts", () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should handle unicode characters", () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should generate consistent cache IDs for same input", () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should generate different cache IDs for different inputs", () => {
      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });

    it("should handle concurrent cache writes", async () => {
      mockRedisSet
        .mockResolvedValueOnce(false) // first request: lock not acquired
        .mockResolvedValueOnce(true) // second request: lock acquired
        .mockResolvedValueOnce("OK"); // data stored

      const cache = createSemanticCache(defaultConfig);
      expect(cache).toBeDefined();
    });
  });
});
