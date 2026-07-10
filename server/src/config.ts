// Environment parsing and validation. The process fails fast (exits non-zero)
// on malformed configuration so bad deploys surface immediately.

import { z } from 'zod';

/** Coerce common truthy/falsy string forms to a boolean. */
const boolish = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return def;
      return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
    });

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  DATABASE_PATH: z.string().min(1).default('/data/finally.db'),

  TICK_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  MARKET_SEED: z.string().optional(),
  MARKET_ALWAYS_OPEN: boolish(true),
  STARTING_CASH: z.coerce.number().positive().default(100_000),
  ALLOW_SHORTING: boolish(false),
  // Empty → GBM simulator (default). Set → real quotes via Massive/Polygon (§20.2).
  MASSIVE_API_KEY: z.string().optional(),

  AI_PROVIDER: z.enum(['openrouter', 'cerebras']).default('openrouter'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('meta-llama/llama-3.3-70b-instruct'),
  AI_BASE_URL: z.string().url().optional().or(z.literal('')),
  AI_TRADE_MODE: z.enum(['confirm', 'auto']).default('confirm'),
  AI_MAX_ORDER_NOTIONAL: z.coerce.number().positive().default(25_000),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  APP_SHARED_SECRET: z.string().optional(),
});

export type Config = z.infer<typeof EnvSchema>;

function load(): Config {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('✖ Invalid environment configuration:');
    for (const issue of parsed.error.issues) {
      // eslint-disable-next-line no-console
      console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export const config: Config = load();

/** True when the AI co-pilot is usable (key present). */
export const aiEnabled = Boolean(config.AI_API_KEY);
