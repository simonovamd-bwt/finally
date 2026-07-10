---
name: cerebras-inference
description: Call an LLM via OpenRouter with the Cerebras inference provider and Zod structured outputs, in TypeScript. Use for the Finally AI co-pilot (plan §10).
---

# Calling an LLM via Cerebras

These instructions let you write **TypeScript** code that calls an LLM through
**OpenRouter**, pinning **Cerebras** as the inference provider for low latency, and
parsing the reply as a **Zod-validated structured output**.

> Our backend is Node/Fastify/TypeScript, so we call the OpenAI-compatible OpenRouter
> endpoint directly and validate with Zod. This implements the AI co-pilot contract in
> plan §10.2: same model, `provider.order` routing to Cerebras, and structured outputs.

## Setup

- `OPENROUTER_API_KEY` must be set in `.env` and read server-side only (never shipped
  to the browser). In our config it is `AI_API_KEY` (see `server/src/config.ts`).
- Dependencies (server workspace): `npm i openai zod`. We already depend on `zod` in
  `shared/`; add `openai` to `server/`.
- Base URL: `https://openrouter.ai/api/v1`. The OpenAI SDK is compatible.

## Constants

```ts
export const MODEL = 'openai/gpt-oss-120b';               // OpenRouter model slug
export const PROVIDER_ROUTING = { provider: { order: ['cerebras'] } }; // force Cerebras
```

> Note on free tiers: forcing `provider.order` reliably needs a paid model. If you
> switch to a free OpenRouter model, drop `PROVIDER_ROUTING` — free-tier requests do
> not reliably honor a forced inference provider.

## Client

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.AI_API_KEY,            // OPENROUTER_API_KEY
  baseURL: 'https://openrouter.ai/api/v1',
});
```

## Text response

```ts
const res = await client.chat.completions.create({
  model: MODEL,
  messages,
  reasoning_effort: 'low',
  // @ts-expect-error extra_body is passed through to OpenRouter
  extra_body: PROVIDER_ROUTING,
});
const text = res.choices[0]?.message?.content ?? '';
```

## Structured Outputs response (Zod)

Define the schema once in `shared/ai-schema.ts` (already present:
`CoPilotResponseSchema`), convert it to JSON Schema, and validate the reply:

```ts
import { zodToJsonSchema } from 'zod-to-json-schema';
import { CoPilotResponseSchema } from '@finally/shared';

const res = await client.chat.completions.create({
  model: MODEL,
  messages,
  reasoning_effort: 'low',
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'copilot_response',
      strict: true,
      schema: zodToJsonSchema(CoPilotResponseSchema, { name: 'CoPilotResponse' }),
    },
  },
  // @ts-expect-error extra_body is passed through to OpenRouter
  extra_body: PROVIDER_ROUTING,
});

const raw = res.choices[0]?.message?.content ?? '{}';
const parsed = CoPilotResponseSchema.safeParse(JSON.parse(raw)); // validate, never trust raw
if (!parsed.success) {
  // retry once with the error, then fall back gracefully (plan §10.2)
}
```

## Rules for our project (plan §10.4)

- The LLM only **proposes**. `server/src/trading/engine.ts` is the sole mutator and
  **re-validates** every proposed order (cash, symbol, `AI_MAX_ORDER_NOTIONAL`).
- Validate with Zod, retry once on parse failure, then return a graceful message.
- Support a mock mode (`AI_MOCK=true`) that returns a deterministic response so tests
  and local dev run without a key.
