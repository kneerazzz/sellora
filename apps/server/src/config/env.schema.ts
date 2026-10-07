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
  EMBEDDING_PROVIDER: z.literal('local', {
    error: 'Only local Nomic/768 embeddings are supported; OpenAI embeddings are not implemented.',
  }).default('local'),
  LOCAL_EMBEDDING_SERVICE_URL: z.url().default('http://127.0.0.1:11435'),
})
