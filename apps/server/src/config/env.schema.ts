import { z } from 'zod'

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().regex(/^[1-9]\d*[dhms]$/).refine(value => {
    const units: Record<string, number> = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000 }
    return Number.isSafeInteger(Number(value.slice(0, -1)) * units[value.slice(-1)]!)
  }, 'Refresh lifetime is too large').default('7d'),
  AUTH_ATTEMPT_MAX: z.coerce.number().int().min(1).max(10000).default(60),
  AUTH_ATTEMPT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86400).default(900),
  CLIENT_URL: z.url().default('http://localhost:3000'),
  DOCUMENT_STORAGE_DIR: z.string().min(1).default('uploads/documents'),
  DOCUMENT_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  AI_PROVIDER: z.enum(['openai', 'groq']).default('groq'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_EXTRACTION_MODEL: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GROQ_EXTRACTION_MODEL: z.string().optional(),
  PROVIDER_OPERATION_TIMEOUT_MS: z.coerce.number().int().min(100).max(300_000).default(30_000),
  PROVIDER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  PROVIDER_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(0).max(30_000).default(250),
  PROVIDER_RETRY_MAX_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(2_000),
  PROVIDER_CONCURRENCY_MAX: z.coerce.number().int().min(1).max(100).default(4),
  PROVIDER_PERIOD_UNITS_MAX: z.coerce.number().int().min(1).max(2_000_000_000).default(1_000_000),
  PROVIDER_PERIOD_SECONDS: z.coerce.number().int().min(1).max(2_592_000).default(3_600),
  PROVIDER_RESERVATION_TTL_SECONDS: z.coerce.number().int().min(1).max(86_400).default(120),
  PROVIDER_REQUEST_MAX_BYTES: z.coerce.number().int().min(1_024).max(100 * 1024 * 1024).default(1_048_576),
  PROVIDER_RESPONSE_MAX_BYTES: z.coerce.number().int().min(1_024).max(100 * 1024 * 1024).default(1_048_576),
  PROVIDER_INPUT_MAX_CHARS: z.coerce.number().int().min(1_000).max(10_000_000).default(200_000),
  PROVIDER_QUESTION_MAX: z.coerce.number().int().min(1).max(1_000).default(50),
  DOCUMENT_EXTRACTED_MAX_CHARS: z.coerce.number().int().min(1_000).max(100_000_000).default(1_000_000),
  DOCUMENT_MAX_PAGES: z.coerce.number().int().min(1).max(100_000).default(500),
  EMBEDDING_PROVIDER: z.literal('local', {
    error: 'Only local Nomic/768 embeddings are supported; OpenAI embeddings are not implemented.',
  }).default('local'),
  LOCAL_EMBEDDING_SERVICE_URL: z.url().default('http://127.0.0.1:11435'),
  SLACK_ALERT_WEBHOOK_URL: z.url().startsWith('https://').optional(),
})
