import { semanticCacheConfigSchema } from "../create-semantic-memory/schema";
import z from "zod";

export const intentCacheConfigSchema = semanticCacheConfigSchema.extend({
  intentExtractor: z.object({
    model: z.union([
      z.string(),
      z.custom((val) => {
        return val && typeof val === "object";
      }),
    ]),
    windowSize: z.number().default(5),
    prompt: z.string().optional(),
  }),
});

export { validateEnvConfig } from "../create-semantic-memory/schema";

export type IntentCacheConfig = z.input<typeof intentCacheConfigSchema>;
