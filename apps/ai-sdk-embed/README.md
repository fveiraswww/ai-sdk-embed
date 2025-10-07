# ai-sdk-embed

**Semantic caching for AI SDK**

Embeddings turn text into numeric vectors that represent meaning.
Similar prompts have similar vectors.
`ai-sdk-embed` uses that idea to **avoid paying tokens twice for similar questions**.

---

## 🚀 Quick Start

```bash
pnpm add ai-sdk-embed
```

```ts
import { createSemanticCache } from "ai-sdk-embed";

const semantic = createSemanticCache({
  model: "openai:text-embedding-3-small",
});

const result = await semantic.streamText({
  model: "openai/gpt-5-mini",
  messages: [{ role: "user", content: "How do I push code to main?" }],
});
```

✅ What happens automatically:

* Creates an embedding for the input
* Searches for similar prompts in Upstash Vector
* Returns the cached answer if found
* Otherwise, runs the model and stores the result in Redis and Vector

---

## ⚙️ Environment Variables

You only need these four to get started:

```bash
VECTOR_REST_URL=
VECTOR_REST_TOKEN=
REDIS_REST_URL=
REDIS_REST_TOKEN=
```

They connect your cache to **Upstash Vector** (semantic search) and **Upstash Redis** (response storage).

---

## 🧩 Configuration Options

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

## 🧪 Example

```ts
const semantic = createSemanticCache({
  model: "openai:text-embedding-3-small",
  threshold: 0.9,
  ttl: 60 * 60 * 24 * 7, // 7 days
  debug: true,
  cacheMode: "refresh",
  useFullMessages: true,
  simulateStream: { enabled: true, chunkDelayInMs: 20 },
});

await semantic.streamText({
  model: "openai/gpt-5-mini",
  messages: [{ role: "user", content: "Explain embeddings simply" }],
});
```

---

## 💡 How it works

When you send a prompt:

1. The text is turned into an **embedding** (a vector of numbers).
2. The vector database finds similar embeddings.
3. If a match is found, the previous response is reused.
4. Otherwise, the model runs and the result is stored for next time.

Learn more about embeddings → [Cloudflare: What are embeddings?](https://www.cloudflare.com/learning/ai/what-are-embeddings/)
