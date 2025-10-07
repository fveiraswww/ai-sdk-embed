import { z } from "zod";
import "dotenv/config";

export const semanticCacheConfigSchema = z.object({
  model: z.union([
    z.string(),
    z.custom((val) => {
      return val && typeof val === "object";
    }),
  ]),
  vector: z
    .object({
      url: z.url(),
      token: z.string().min(1),
    })
    .optional()
    .default({
      url: process.env.VECTOR_REST_URL ?? "",
      token: process.env.VECTOR_REST_TOKEN ?? "",
    }),
  redis: z
    .object({
      url: z.url(),
      token: z.string().min(1),
    })
    .optional()
    .default({
      url: process.env.REDIS_REST_URL ?? "",
      token: process.env.REDIS_REST_TOKEN ?? "",
    }),
  threshold: z.number().min(0).max(1).optional().default(0.92),
  ttl: z
    .number()
    .positive()
    .optional()
    .default(60 * 60 * 24 * 14), // 14 days
  debug: z.boolean().optional().default(false),
  cacheMode: z.enum(["default", "refresh"]).optional().default("default"),
  simulateStream: z
    .object({
      enabled: z.boolean().optional().default(true),
      initialDelayInMs: z.number().min(0).optional().default(0),
      chunkDelayInMs: z.number().min(0).optional().default(10),
    })
    .optional()
    .default({
      enabled: true,
      initialDelayInMs: 0,
      chunkDelayInMs: 10,
    }),
  useFullMessages: z.boolean().optional().default(false),
});

export type SemanticCacheConfig = z.input<typeof semanticCacheConfigSchema>;
export type SemanticCacheConfigParsed = z.output<
  typeof semanticCacheConfigSchema
>;

export function validateEnvConfig(config: SemanticCacheConfigParsed) {
  const errors: string[] = [];

  if (!config.vector.url) {
    errors.push(
      "Vector URL is required. Provide 'vector.url' or set VECTOR_REST_URL environment variable.",
    );
  }

  if (!config.vector.token) {
    errors.push(
      "Vector token is required. Provide 'vector.token' or set VECTOR_REST_TOKEN environment variable.",
    );
  }

  if (!config.redis.url) {
    errors.push(
      "Redis URL is required. Provide 'redis.url' or set REDIS_REST_URL environment variable.",
    );
  }

  if (!config.redis.token) {
    errors.push(
      "Redis token is required. Provide 'redis.token' or set REDIS_REST_TOKEN environment variable.",
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Semantic Cache Configuration Error:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }
}
