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
  onStepFinish: z
    .function({
      input: [
        z.object({
          step: z.enum([
            "intent-extraction-start",
            "intent-extraction-complete",
            "intent-extraction-error",
            "cache-check-start",
            "cache-score-evaluated",
            "cache-hit",
            "cache-miss",
            "generation-start",
            "generation-complete",
            "cache-store-start",
            "cache-store-complete",
            "cache-store-error",
          ]),
          userIntention: z.string().optional(),
          extractedIntent: z
            .object({
              intent: z.string(),
              domain: z.array(z.string()),
              stack: z.array(z.string()),
              goal: z.string(),
              constraints: z.array(z.string()),
            })
            .optional(),
          cacheScore: z.number().optional(),
          error: z.any().optional(),
        }),
      ],
      output: z.void(),
    })
    .optional(),
});

const StepEnum = z.enum([
  "intent-extraction-start",
  "intent-extraction-complete",
  "intent-extraction-error",
  "cache-check-start",
  "cache-score-evaluated",
  "cache-hit",
  "cache-miss",
  "generation-start",
  "generation-complete",
  "cache-store-start",
  "cache-store-complete",
  "cache-store-error",
]);

const OnStepFinishArg = z.object({
  step: StepEnum,
  userIntention: z.string().optional(),
  extractedIntent: z
    .object({
      intent: z.string(),
      domain: z.array(z.string()),
      stack: z.array(z.string()),
      goal: z.string(),
      constraints: z.array(z.string()),
    })
    .optional(),
  cacheScore: z.number().optional(),
  error: z.unknown().optional(), // prefer unknown over any in Zod
});

export { validateEnvConfig } from "../create-semantic-memory/schema";

export type IntentCacheConfig = z.input<typeof intentCacheConfigSchema>;
