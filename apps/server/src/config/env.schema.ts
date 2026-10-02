import { z } from 'zod'

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
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
