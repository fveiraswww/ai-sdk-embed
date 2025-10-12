  # ai-sdk-memory

  **Semantic and intent-based memory for Vercel AI SDK**

  Embeddings turn text into numeric vectors that represent meaning.
  Similar prompts have similar vectors.
  `ai-sdk-memory` uses that idea to **avoid paying tokens twice for similar questions**.

  ## Two Memory Types

  - **`createSemanticMemory`** — For one-shot conversations: FAQs, docs, single queries
  - **`createIntentMemory`** — For multi-turn conversations with context and intent understanding

  ![vid_gvkx2xdbbcm1-ezgif com-video-to-gif-converter (1)](https://github.com/user-attachments/assets/e3c75f7b-e461-4dc3-9a37-a9df8dfe217a)

  ## Installation
  ```bash
  npm add ai-sdk-memory
  ```

  ## Usage

  ### createSemanticMemory

  **For one-shot conversations:** FAQs, docs, single queries

  ```ts
  import { createSemanticMemory } from "ai-sdk-memory";

  const semantic = createSemanticMemory({
    model: "text-embedding-3-small",
  });

  const result = await semantic.streamText({
    model: "openai/gpt-5-mini",
    messages: [{ role: "user", content: "What is an agent?" }],
  });
  ```

  ---

  ### createIntentMemory

  **For multi-turn conversations:** Chatbots, contextual assistants, complex interactions

  ```ts
  import { createIntentMemory } from "ai-sdk-memory";

  const intent = createIntentMemory({
    intentExtractor: {
      model: "openai/gpt-5-mini",
      windowSize: 5,
    },
    model: "text-embedding-3-small",
    threshold: 0.95,
    onStepFinish: ({ step, userIntention, cacheScore }) => {
      console.log(step, userIntention, cacheScore);
    },
  });

  const result = await intent.streamText({
    model: "openai/gpt-5-mini",
    messages: [
      { role: "user", content: "I need help with React" },
      { role: "assistant", content: "What issue are you facing?" },
      { role: "user", content: "Components re-rendering too often" },
    ],
  });
  ```

  #### Environment Variables
  ```ts
  VECTOR_REST_URL=
  VECTOR_REST_TOKEN=
  REDIS_REST_URL=
  REDIS_REST_TOKEN=
  ```


  #### Configuration Options

  You can pass options to `createSemanticCache()` to customize caching behavior.

  | Option                              | Type                         | Default                         | Description                                                                     |
  | ----------------------------------- | ---------------------------- | ------------------------------- | ------------------------------------------------------------------------------- |
  | **model**                           | `string` or `EmbeddingModel` | **Required**                    | Embedding model used to compare prompts, e.g. `"openai:text-embedding-3-small"` |
  | **vector.url**                      | `string`                     | `process.env.VECTOR_REST_URL`   | URL of your Upstash Vector database                                             |
  | **vector.token**                    | `string`                     | `process.env.VECTOR_REST_TOKEN` | Access token for Upstash Vector                                                 |
  | **redis.url**                       | `string`                     | `process.env.REDIS_REST_URL`    | URL of your Upstash Redis instance                                              |
  | **redis.token**                     | `string`                     | `process.env.REDIS_REST_TOKEN`  | Access token for Upstash Redis                                                  |
  | **threshold**                       | `number`                     | `0.92`                          | Minimum similarity (0–1) to reuse cached responses                              |
  | **ttl**                             | `number`                     | `60 * 60 * 24 * 14`             | Cache expiration in seconds (default 14 days)                                   |
  | **debug**                           | `boolean`                    | `false`                         | Print logs for cache hits, misses, and writes                                   |
  | **cacheMode**                       | `'default'` or `'refresh'`   | `'default'`                     | `default` uses cache if found, `refresh` forces regeneration                    |
  | **simulateStream.enabled**          | `boolean`                    | `true`                          | Simulate streaming when reading from cache                                      |
  | **simulateStream.initialDelayInMs** | `number`                     | `0`                             | Delay before first chunk (ms)                                                   |
  | **simulateStream.chunkDelayInMs**   | `number`                     | `10`                            | Delay between chunks (ms)                                                       |
  | **useFullMessages**                 | `boolean`                    | `false`                         | If true, embeds entire conversation instead of last message only                |

  ---

  ## How it works

  When you send a prompt:

  1. The text is turned into an **embedding** (a vector of numbers).
  2. The vector database finds similar embeddings.
  3. If a match is found, the previous response is reused.
  4. Otherwise, the model runs and the result is stored for next time.

  Learn more about embeddings → [Cloudflare: What are embeddings?](https://www.cloudflare.com/learning/ai/what-are-embeddings/)

  ## License
  MIT
