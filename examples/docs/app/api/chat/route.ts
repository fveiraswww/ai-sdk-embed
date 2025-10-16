import { ProvideLinksToolSchema } from "@/lib/inkeep-qa-schema";
import { source } from "@/lib/source";
import { getLLMText } from "@/lib/source";
import { convertToModelMessages } from "ai";
import { createIntentMemory } from "ai-sdk-memory";

let docsContext: string | null = null;

async function getDocsContext() {
  if (docsContext) return docsContext;

  const allPages = source.getPages();
  const docsTexts = await Promise.all(
    allPages.map(async (page) => {
      const text = await getLLMText(page);
      return text;
    }),
  );

  docsContext = docsTexts.join("\n\n---\n\n");
  return docsContext;
}

export async function POST(req: Request) {
  const reqJson = await req.json();

  const docs = await getDocsContext();
  const allPages = source.getPages();
  const availableUrls = allPages
    .map((page) => `- ${page.data.title}: ${page.url}`)
    .join("\n");

  const systemPrompt = `You are a helpful AI assistant for the AI SDK Memory documentation.

You have access to the complete documentation below. Use it to answer questions accurately and provide relevant links.

Available documentation pages:
${availableUrls}

Complete Documentation:
${docs}

When answering questions:
1. Reference the exact documentation sections relevant to the user's question
2. Use the provideLinks tool to provide URLs to relevant documentation pages
3. Be concise and accurate
4. If something is not in the documentation, say so clearly`;

  const intent = createIntentMemory({
    intentExtractor: {
      model: "openai/gpt-5-nano",
      windowSize: 5,
    },
    model: "text-embedding-3-small",
    debug: true,
    threshold: 0.9,
    onStepFinish: ({ userIntention, cacheScore, step }) => {
      console.log("score", cacheScore);
      console.log("step", step);
      console.log("user intention");
    },
  });

  const result = await intent.streamText({
    model: "openai/gpt-5",
    system: systemPrompt,
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
}
