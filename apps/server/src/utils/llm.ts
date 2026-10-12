import { env } from '../config/env'
import { buildProviderTransportOptions, type ProviderCallControls } from '../services/provider/providerPolicy'
import { requestProviderJson, type ProviderAttemptOutcome } from '../services/provider/providerTransport'
import { ApiError } from './apiError'
import { createUsageAttemptObserver, recordUsageQuantities } from '../modules/usage/usageLedger.service'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions'

type ChatCompletionPayload = {
  text: string
  promptTokens: number
  completionTokens: number
  measurementStatus: 'MEASURED' | 'UNKNOWN'
}

function validateChatCompletion(value: unknown): ChatCompletionPayload {
  const data = value as any
  const text = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string') throw new Error('Response did not contain message content')

  const promptTokens = data?.usage?.prompt_tokens
  const completionTokens = data?.usage?.completion_tokens
  if (promptTokens !== undefined && (!Number.isInteger(promptTokens) || promptTokens < 0)) {
    throw new Error('Invalid prompt token count')
  }
  if (completionTokens !== undefined && (!Number.isInteger(completionTokens) || completionTokens < 0)) {
    throw new Error('Invalid completion token count')
  }

  return {
    text,
    promptTokens: promptTokens ?? 0,
    completionTokens: completionTokens ?? 0,
    measurementStatus: promptTokens !== undefined && completionTokens !== undefined ? 'MEASURED' : 'UNKNOWN',
  }
}

export async function callLlm(params: {
  systemPrompt: string
  userPrompt: string
  temperature?: number
  operation?: ProviderCallControls
}): Promise<{
  text: string
  model: string
  promptTokens: number
  completionTokens: number
  latencyMs: number
  attempts?: ProviderAttemptOutcome[]
}> {
  const provider = (env.AI_PROVIDER ?? 'groq').toLowerCase()
  const providerConfig = provider === 'openai'
    ? { apiKey: env.OPENAI_API_KEY, model: env.OPENAI_EXTRACTION_MODEL ?? 'gpt-4o-mini', url: OPENAI_CHAT_URL }
    : provider === 'groq'
      ? { apiKey: env.GROQ_API_KEY, model: env.GROQ_EXTRACTION_MODEL ?? 'llama-3.1-8b-instant', url: GROQ_CHAT_URL }
      : null

  if (!providerConfig) throw ApiError.internal(`Unsupported AI_PROVIDER: ${provider}`)
  if (!providerConfig.apiKey) {
    throw ApiError.internal(`${provider === 'openai' ? 'OPENAI' : 'GROQ'}_API_KEY is not configured`)
  }

  const result = await requestProviderJson({
    url: providerConfig.url,
    request: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${providerConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: providerConfig.model,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userPrompt },
        ],
        temperature: params.temperature ?? 0,
      }),
    },
    validate: validateChatCompletion,
    options: buildProviderTransportOptions(params.operation?.usage ? {
      ...params.operation,
      attemptObserver: createUsageAttemptObserver({
        traceId: params.operation.usage.traceId,
        component: 'generation',
        category: 'PROVIDER',
        provider,
        model: providerConfig.model,
      }),
    } : params.operation),
  })

  const successful = [...result.attempts].reverse().find(attempt => attempt.outcome === 'success')
  if (params.operation?.usage && successful) {
    const measured = result.value.measurementStatus === 'MEASURED'
    await recordUsageQuantities({
      traceId: params.operation.usage.traceId,
      component: 'generation',
      attemptNumber: successful.attempt,
      inputQuantity: measured ? result.value.promptTokens : null,
      outputQuantity: measured ? result.value.completionTokens : null,
      totalQuantity: measured ? result.value.promptTokens + result.value.completionTokens : null,
      unitType: 'TOKENS',
      measurementStatus: result.value.measurementStatus,
    })
  }

  return {
    text: result.value.text,
    promptTokens: result.value.promptTokens,
    completionTokens: result.value.completionTokens,
    model: providerConfig.model,
    latencyMs: result.elapsedMs,
    attempts: result.attempts,
  }
}
