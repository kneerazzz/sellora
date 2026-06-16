// src/config/env.ts
import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config({
  path: './.env'
})

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  CLIENT_URL: z.string().default('http://localhost:3000'),
  DOCUMENT_STORAGE_DIR: z.string().default('uploads/documents'),
  DOCUMENT_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  AI_PROVIDER: z.enum(['openai', 'groq']).default('groq'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_EXTRACTION_MODEL: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GROQ_EXTRACTION_MODEL: z.string().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_PROVIDER: z.enum(['local', 'openai']).default('local'),
  LOCAL_EMBEDDING_SERVICE_URL: z.string().default('http://127.0.0.1:11435'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data

export const {
  NODE_ENV,
  PORT,
  DATABASE_URL,
  REDIS_URL,
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRES_IN,
  JWT_REFRESH_EXPIRES_IN,
  CLIENT_URL,
  AI_PROVIDER,
  OPENAI_API_KEY,
  OPENAI_EXTRACTION_MODEL,
  GROQ_API_KEY,
  GROQ_EXTRACTION_MODEL,
  OPENAI_EMBEDDING_MODEL,
  EMBEDDING_PROVIDER,
  LOCAL_EMBEDDING_SERVICE_URL,
  DOCUMENT_STORAGE_DIR,
  DOCUMENT_UPLOAD_MAX_BYTES,
  WORKFLOW_WORKER_POLL_INTERVAL_MS,
  WORKFLOW_WORKER_BATCH_SIZE
} = process.env
