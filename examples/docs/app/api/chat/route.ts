import { ProvideLinksToolSchema } from "@/lib/inkeep-qa-schema";
import { convertToModelMessages } from "ai";
import { createIntentMemory } from "ai-sdk-memory";

export const runtime = "edge";

export async function POST(req: Request) {
  try {
    const reqJson = await req.json();

    const intent = createIntentMemory({
      intentExtractor: {
        model: "openai/gpt-5-nano",
        windowSize: 5,
      },
      model: "text-embedding-3-small",
      debug: true,
      threshold: 0.95,
      onStepFinish: ({ userIntention, cacheScore, step }) => {
        console.log("score", cacheScore);
        console.log("step", step);
        console.log("user intention");
      },
    });

    const result = await intent.streamText({
      model: "openai/gpt-5",
      tools: {
        provideLinks: {
          inputSchema: ProvideLinksToolSchema,
        },
      },
      messages: convertToModelMessages(reqJson.messages, {
        ignoreIncompleteToolCalls: true,
      }),
      toolChoice: "auto",
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    console.log("err", err);
  }
}
