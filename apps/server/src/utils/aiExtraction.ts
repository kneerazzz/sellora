import { Prisma } from '@prisma/client'
import { ApiError } from './apiError'
import {
  salesExtractionOutputSchema,
  type SalesExtractionInput,
  type SalesExtractionOutput,
} from '../modules/aiExtractions/aiExtractions.schema'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions'
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'
const DEFAULT_GROQ_MODEL = 'llama-3.1-8b-instant'

export const salesExtractionSystemPrompt = [
  'You are Sellora, an AI assistant for high-ticket B2B technical sales teams.',
  'Extract only sales-relevant facts from the provided email, call transcript, CRM note, or manual text.',
  'Do not invent details. If something is not present, return an empty array or null.',
  'Return concise CRM-ready data. Dates must be ISO 8601 strings when present.',
  'The response must be valid JSON matching the provided schema.',
].join('\n')

const salesExtractionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    nextSteps: { type: 'array', items: { type: 'string' } },
    buyerQuestions: { type: 'array', items: { type: 'string' } },
    objections: { type: 'array', items: { type: 'string' } },
    riskFlags: { type: 'array', items: { type: 'string' } },
    crmUpdate: {
      type: 'object',
      additionalProperties: false,
      properties: {
        stage: { type: ['string', 'null'] },
        lastActivitySummary: { type: ['string', 'null'] },
        nextFollowUpAt: { type: ['string', 'null'] },
        priority: {
          type: ['string', 'null'],
          enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT', null],
        },
      },
      required: ['stage', 'lastActivitySummary', 'nextFollowUpAt', 'priority'],
    },
    confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
    confidenceReason: { type: 'string' },
  },
  required: [
    'summary',
    'nextSteps',
    'buyerQuestions',
    'objections',
    'riskFlags',
    'crmUpdate',
    'confidence',
    'confidenceReason',
  ],
}

type AiProvider = 'openai' | 'groq'

function getAiProvider(): AiProvider {
  const provider = (process.env.AI_PROVIDER ?? 'groq').toLowerCase()
  if (provider !== 'openai' && provider !== 'groq') {
    throw ApiError.internal('AI_PROVIDER must be either "openai" or "groq"')
  }

  return provider
}

function getOpenAiConfig() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw ApiError.internal('OPENAI_API_KEY is not configured')
  }

  return {
    apiKey,
    model: process.env.OPENAI_EXTRACTION_MODEL ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
  }
}

function getGroqConfig() {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    throw ApiError.internal('GROQ_API_KEY is not configured')
  }

  return {
    apiKey,
    model: process.env.GROQ_EXTRACTION_MODEL ?? process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
  }
}

export function buildSalesExtractionPrompt(input: SalesExtractionInput): string {
  return JSON.stringify(
    {
      sourceType: input.sourceType,
      subject: input.subject ?? null,
      participants: input.participants ?? [],
      crmContext: input.crmContext ?? null,
      content: input.content,
    },
    null,
    2
  )
}

function extractOutputText(response: any): string | null {
  if (typeof response.output_text === 'string') {
    return response.output_text
  }

  const output = Array.isArray(response.output) ? response.output : []
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : []
    for (const part of content) {
      if (typeof part?.text === 'string') {
        return part.text
      }
    }
  }

  return null
}

function extractChatCompletionContent(response: any): string | null {
  const content = response?.choices?.[0]?.message?.content
  return typeof content === 'string' ? content : null
}

function parseJsonOutput(rawResponse: string): SalesExtractionOutput {
  const trimmed = rawResponse.trim()
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  return salesExtractionOutputSchema.parse(JSON.parse(withoutFence))
}

async function callOpenAiForSalesExtraction(
  input: SalesExtractionInput
): Promise<{
  output: SalesExtractionOutput
  model: string
  systemPrompt: string
  userPrompt: string
  rawResponse: string
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  latencyMs: number
}> {
  const { apiKey, model } = getOpenAiConfig()
  const userPrompt = buildSalesExtractionPrompt(input)
  const startedAt = Date.now()

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: salesExtractionSystemPrompt },
        { role: 'user', content: userPrompt },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'sales_event_extraction',
          strict: true,
          schema: salesExtractionJsonSchema,
        },
      },
    }),
  })

  const data = await response.json().catch(() => null)
  const latencyMs = Date.now() - startedAt

  if (!response.ok) {
    const message = data?.error?.message ?? 'OpenAI extraction request failed'
    throw ApiError.internal(message)
  }

  const rawResponse = extractOutputText(data)
  if (!rawResponse) {
    throw ApiError.internal('OpenAI response did not include output text')
  }

  const output = parseJsonOutput(rawResponse)
  const usage = data?.usage ?? {}

  return {
    output,
    model,
    systemPrompt: salesExtractionSystemPrompt,
    userPrompt,
    rawResponse,
    usage: {
      promptTokens: usage.input_tokens ?? 0,
      completionTokens: usage.output_tokens ?? 0,
      totalTokens: usage.total_tokens ?? 0,
    },
    latencyMs,
  }
}

async function callGroqForSalesExtraction(
  input: SalesExtractionInput
): Promise<{
  output: SalesExtractionOutput
  model: string
  systemPrompt: string
  userPrompt: string
  rawResponse: string
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  latencyMs: number
}> {
  const { apiKey, model } = getGroqConfig()
  const userPrompt = buildSalesExtractionPrompt(input)
  const startedAt = Date.now()

  const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: [
            salesExtractionSystemPrompt,
            'Return only a JSON object. Do not wrap the JSON in Markdown.',
            `The JSON object must match this schema: ${JSON.stringify(salesExtractionJsonSchema)}`,
          ].join('\n'),
        },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
  })

  const data = await response.json().catch(() => null)
  const latencyMs = Date.now() - startedAt

  if (!response.ok) {
    const message = data?.error?.message ?? 'Groq extraction request failed'
    throw ApiError.internal(message)
  }

  const rawResponse = extractChatCompletionContent(data)
  if (!rawResponse) {
    throw ApiError.internal('Groq response did not include message content')
  }

  const output = parseJsonOutput(rawResponse)
  const usage = data?.usage ?? {}

  return {
    output,
    model,
    systemPrompt: salesExtractionSystemPrompt,
    userPrompt,
    rawResponse,
    usage: {
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      totalTokens: usage.total_tokens ?? 0,
    },
    latencyMs,
  }
}

export async function callLlmForSalesExtraction(
  input: SalesExtractionInput
): ReturnType<typeof callOpenAiForSalesExtraction> {
  const provider = getAiProvider()
  return provider === 'openai'
    ? callOpenAiForSalesExtraction(input)
    : callGroqForSalesExtraction(input)
}

export function normalizeWebhookPayloadForExtraction(params: {
  eventType: string
  payload: Prisma.JsonValue
}): SalesExtractionInput {
  const payload =
    params.payload && typeof params.payload === 'object' && !Array.isArray(params.payload)
      ? (params.payload as Record<string, unknown>)
      : {}

  const content =
    payload.content ??
    payload.body ??
    payload.emailBody ??
    payload.text ??
    payload.transcript ??
    payload.message ??
    JSON.stringify(payload)

  const sourceType =
    params.eventType === 'CALL_TRANSCRIPT_RECEIVED'
      ? 'CALL_TRANSCRIPT'
      : params.eventType === 'EMAIL_RECEIVED' || params.eventType === 'EMAIL_SENT'
        ? 'EMAIL'
        : params.eventType === 'MANUAL_QUESTION'
          ? 'MANUAL'
          : 'CRM_NOTE'

  return {
    sourceType,
    content: String(content),
    subject: typeof payload.subject === 'string' ? payload.subject : undefined,
    participants: Array.isArray(payload.participants) ? payload.participants.map(String) : [],
    crmContext:
      payload.crmContext && typeof payload.crmContext === 'object' && !Array.isArray(payload.crmContext)
        ? (payload.crmContext as Record<string, unknown>)
        : undefined,
    leadId: typeof payload.leadId === 'string' ? payload.leadId : undefined,
    dealId: typeof payload.dealId === 'string' ? payload.dealId : undefined,
  }
}
