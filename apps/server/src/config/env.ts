// src/config/env.ts
import { z } from 'zod'

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
  AI_PROVIDER: z.enum(['openai', 'groq']).default('groq'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_EXTRACTION_MODEL: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GROQ_EXTRACTION_MODEL: z.string().optional(),
  PINECONE_API_KEY: z.string().optional(),
  PINECONE_INDEX_NAME: z.string().optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
