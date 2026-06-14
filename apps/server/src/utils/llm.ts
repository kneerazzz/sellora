import { env } from '../config/env'
import { ApiError } from './apiError'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions'

export async function callLlm(params: {
  systemPrompt: string
  userPrompt: string
  temperature?: number
}): Promise<{
  text: string
  model: string
  promptTokens: number
  completionTokens: number
  latencyMs: number
}> {
  const provider = (env.AI_PROVIDER ?? 'groq').toLowerCase()
  const startedAt = Date.now()

  if (provider === 'openai') {
    const apiKey = env.OPENAI_API_KEY
    if (!apiKey) {
      throw ApiError.internal('OPENAI_API_KEY is not configured')
    }
    const model = env.OPENAI_EXTRACTION_MODEL ?? 'gpt-4o-mini'

    const response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userPrompt },
        ],
        temperature: params.temperature ?? 0,
      }),
    })

    const data = (await response.json().catch(() => null)) as any
    const latencyMs = Date.now() - startedAt

    if (!response.ok) {
      const message = data?.error?.message ?? 'OpenAI chat completion request failed'
      throw ApiError.internal(message)
    }

    const text = data?.choices?.[0]?.message?.content
    if (typeof text !== 'string') {
      throw ApiError.internal('OpenAI response did not contain content')
    }

    const usage = data?.usage ?? {}

    return {
      text,
      model,
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      latencyMs,
    }
  } else if (provider === 'groq') {
    const apiKey = env.GROQ_API_KEY
    if (!apiKey) {
      throw ApiError.internal('GROQ_API_KEY is not configured')
    }
    const model = env.GROQ_EXTRACTION_MODEL ?? 'llama-3.1-8b-instant'

    const response = await fetch(GROQ_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userPrompt },
        ],
        temperature: params.temperature ?? 0,
      }),
    })

    const data = (await response.json().catch(() => null)) as any
    const latencyMs = Date.now() - startedAt

    if (!response.ok) {
      const message = data?.error?.message ?? 'Groq chat completion request failed'
      throw ApiError.internal(message)
    }

    const text = data?.choices?.[0]?.message?.content
    if (typeof text !== 'string') {
      throw ApiError.internal('Groq response did not contain content')
    }

    const usage = data?.usage ?? {}

    return {
      text,
      model,
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      latencyMs,
    }
  } else {
    throw ApiError.internal(`Unsupported AI_PROVIDER: ${provider}`)
  }
}
