import { Prisma } from '@prisma/client'
import { ApiError } from './apiError'
import { buildProviderTransportOptions, type ProviderCallControls } from '../services/provider/providerPolicy'
import { requestProviderJson, type ProviderAttemptOutcome } from '../services/provider/providerTransport'
import { createUsageAttemptObserver, recordUsageQuantities } from '../modules/usage/usageLedger.service'
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
  'CRITICAL INSTRUCTION FOR `buyerQuestions`: Rewrite any extracted buyer questions so they are completely self-contained and optimized for a vector database search. Resolve all pronouns and include context (e.g. change "How much is it?" to "How much does the enterprise platform cost?").',
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

type NormalizedTokenUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  measurementStatus: 'MEASURED' | 'UNKNOWN'
}

function validateTokenUsage(
  value: unknown,
  keys: { prompt: string; completion: string; total: string }
): NormalizedTokenUsage {
  const usage = (value ?? {}) as Record<string, unknown>
  const read = (key: string) => {
    const count = usage[key]
    if (count === undefined) return 0
    if (!Number.isInteger(count) || (count as number) < 0) throw new Error(`Invalid ${key} token count`)
    return count as number
  }
  return {
    promptTokens: read(keys.prompt),
    completionTokens: read(keys.completion),
    totalTokens: read(keys.total),
    measurementStatus: [keys.prompt, keys.completion, keys.total].every(key => usage[key] !== undefined) ? 'MEASURED' : 'UNKNOWN',
  }
}

function providerControls(operation: ProviderCallControls | undefined, params: {
  component: string
  provider: string
  model: string
}): ProviderCallControls | undefined {
  if (!operation?.usage) return operation
  return {
    ...operation,
    attemptObserver: createUsageAttemptObserver({
      traceId: operation.usage.traceId,
      component: params.component,
      category: 'PROVIDER',
      provider: params.provider,
      model: params.model,
    }),
  }
}

async function persistTokenUsage(operation: ProviderCallControls | undefined, component: string,
  attempts: ProviderAttemptOutcome[], usage: NormalizedTokenUsage) {
  const successful = [...attempts].reverse().find(attempt => attempt.outcome === 'success')
  if (!operation?.usage || !successful) return
  const measured = usage.measurementStatus === 'MEASURED'
  await recordUsageQuantities({
    traceId: operation.usage.traceId,
    component,
    attemptNumber: successful.attempt,
    inputQuantity: measured ? usage.promptTokens : null,
    outputQuantity: measured ? usage.completionTokens : null,
    totalQuantity: measured ? usage.totalTokens : null,
    unitType: 'TOKENS',
    measurementStatus: usage.measurementStatus,
  })
}

async function callOpenAiForSalesExtraction(
  input: SalesExtractionInput,
  operation?: ProviderCallControls
): Promise<{
  output: SalesExtractionOutput
  model: string
  systemPrompt: string
  userPrompt: string
  rawResponse: string
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  latencyMs: number
  attempts: ProviderAttemptOutcome[]
}> {
  const { apiKey, model } = getOpenAiConfig()
  const userPrompt = buildSalesExtractionPrompt(input)
  const result = await requestProviderJson({
    url: OPENAI_RESPONSES_URL,
    request: {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: [
          { role: 'system', content: salesExtractionSystemPrompt },
          { role: 'user', content: userPrompt },
        ],
        text: { format: { type: 'json_schema', name: 'sales_event_extraction', strict: true, schema: salesExtractionJsonSchema } },
      }),
    },
    validate(data) {
      const rawResponse = extractOutputText(data)
      if (!rawResponse) throw new Error('OpenAI response did not include output text')
      const usage = validateTokenUsage((data as any)?.usage, {
        prompt: 'input_tokens', completion: 'output_tokens', total: 'total_tokens',
      })
      return { rawResponse, output: parseJsonOutput(rawResponse), usage }
    },
    options: buildProviderTransportOptions(providerControls(operation, { component: 'sales_extraction', provider: 'openai', model })),
  })
  await persistTokenUsage(operation, 'sales_extraction', result.attempts, result.value.usage)

  return {
    output: result.value.output,
    model,
    systemPrompt: salesExtractionSystemPrompt,
    userPrompt,
    rawResponse: result.value.rawResponse,
    usage: {
      ...result.value.usage,
    },
    latencyMs: result.elapsedMs,
    attempts: result.attempts,
  }
}

async function callGroqForSalesExtraction(
  input: SalesExtractionInput,
  operation?: ProviderCallControls
): Promise<{
  output: SalesExtractionOutput
  model: string
  systemPrompt: string
  userPrompt: string
  rawResponse: string
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  latencyMs: number
  attempts: ProviderAttemptOutcome[]
}> {
  const { apiKey, model } = getGroqConfig()
  const userPrompt = buildSalesExtractionPrompt(input)
  const result = await requestProviderJson({
    url: GROQ_CHAT_COMPLETIONS_URL,
    request: { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({
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
    }) },
    validate(data) {
      const rawResponse = extractChatCompletionContent(data)
      if (!rawResponse) throw new Error('Groq response did not include message content')
      const usage = validateTokenUsage((data as any)?.usage, {
        prompt: 'prompt_tokens', completion: 'completion_tokens', total: 'total_tokens',
      })
      return { rawResponse, output: parseJsonOutput(rawResponse), usage }
    },
    options: buildProviderTransportOptions(providerControls(operation, { component: 'sales_extraction', provider: 'groq', model })),
  })
  await persistTokenUsage(operation, 'sales_extraction', result.attempts, result.value.usage)

  return {
    output: result.value.output,
    model,
    systemPrompt: salesExtractionSystemPrompt,
    userPrompt,
    rawResponse: result.value.rawResponse,
    usage: {
      ...result.value.usage,
    },
    latencyMs: result.elapsedMs,
    attempts: result.attempts,
  }
}

export async function callLlmForSalesExtraction(
  input: SalesExtractionInput,
  operation?: ProviderCallControls
): ReturnType<typeof callOpenAiForSalesExtraction> {
  const provider = getAiProvider()
  return provider === 'openai'
    ? callOpenAiForSalesExtraction(input, operation)
    : callGroqForSalesExtraction(input, operation)
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

import {
  rfpExtractionOutputSchema,
  type RfpExtractionInput,
  type RfpExtractionOutput,
} from '../modules/aiExtractions/rfpExtraction.schema'

export const rfpExtractionSystemPrompt = [
  'You are an AI assistant for B2B technical sales teams.',
  'Your task is to extract every single question or requirement from the provided RFP or security questionnaire text.',
  'CRITICAL INSTRUCTIONS FOR VECTOR SEARCH OPTIMIZATION:',
  '1. Every extracted question MUST be completely self-contained.',
  '2. Resolve all pronouns (e.g. change "Does it support X?" to "Does the product support X?").',
  '3. Include relevant context from the surrounding text in the question itself.',
  '4. If a requirement is a statement (e.g. "Describe your SOC2 compliance"), rewrite it as a clear question (e.g. "What is the SOC2 compliance status of the platform?").',
  'The response must be a valid JSON object matching the provided schema exactly. Do not return a raw array.',
].join('\n')

const rfpExtractionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    questions: { type: 'array', items: { type: 'string' } },
  },
  required: ['questions'],
}

function parseRfpJsonOutput(rawResponse: string): RfpExtractionOutput {
  const trimmed = rawResponse.trim()
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let parsed = JSON.parse(withoutFence)
  
  if (Array.isArray(parsed)) {
    const objWithQuestions = parsed.find((item: any) => item && typeof item === 'object' && item.questions && Array.isArray(item.questions))
    if (objWithQuestions) {
      parsed = objWithQuestions
    } else {
      parsed = { questions: parsed }
    }
  }

  if (parsed.questions && Array.isArray(parsed.questions)) {
    parsed.questions = parsed.questions.flat(Infinity).map((q: any) => {
      if (typeof q === 'string') return q
      if (typeof q === 'object' && q !== null) {
        return q.question || q.text || Object.values(q)[0] || String(q)
      }
      return String(q)
    })
  }

  return rfpExtractionOutputSchema.parse(parsed)
}

async function callOpenAiForRfpExtraction(
  input: RfpExtractionInput,
  operation?: ProviderCallControls
): Promise<{
  output: RfpExtractionOutput
  model: string
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  latencyMs: number
  attempts: ProviderAttemptOutcome[]
}> {
  const { apiKey, model } = getOpenAiConfig()
  const userPrompt = input.content
  const result = await requestProviderJson({
    url: OPENAI_RESPONSES_URL,
    request: { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: rfpExtractionSystemPrompt },
        { role: 'user', content: userPrompt },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'rfp_extraction',
          strict: true,
          schema: rfpExtractionJsonSchema,
        },
      },
    }) },
    validate(data) {
      const rawResponse = extractOutputText(data)
      if (!rawResponse) throw new Error('OpenAI response did not include output text')
      const usage = validateTokenUsage((data as any)?.usage, {
        prompt: 'input_tokens', completion: 'output_tokens', total: 'total_tokens',
      })
      return { output: parseRfpJsonOutput(rawResponse), usage }
    },
    options: buildProviderTransportOptions(providerControls(operation, { component: 'rfp_extraction', provider: 'openai', model })),
  })
  await persistTokenUsage(operation, 'rfp_extraction', result.attempts, result.value.usage)

  return {
    output: result.value.output,
    model,
    usage: {
      ...result.value.usage,
    },
    latencyMs: result.elapsedMs,
    attempts: result.attempts,
  }
}

async function callGroqForRfpExtraction(
  input: RfpExtractionInput,
  operation?: ProviderCallControls
): Promise<{
  output: RfpExtractionOutput
  model: string
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  latencyMs: number
  attempts: ProviderAttemptOutcome[]
}> {
  const { apiKey, model } = getGroqConfig()
  const userPrompt = input.content
  const result = await requestProviderJson({
    url: GROQ_CHAT_COMPLETIONS_URL,
    request: { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: [
            rfpExtractionSystemPrompt,
            'Return only a JSON object. Do not wrap the JSON in Markdown.',
            `The JSON object must match this schema: ${JSON.stringify(rfpExtractionJsonSchema)}`,
          ].join('\n'),
        },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    }) },
    validate(data) {
      const rawResponse = extractChatCompletionContent(data)
      if (!rawResponse) throw new Error('Groq response did not include message content')
      const usage = validateTokenUsage((data as any)?.usage, {
        prompt: 'prompt_tokens', completion: 'completion_tokens', total: 'total_tokens',
      })
      return { output: parseRfpJsonOutput(rawResponse), usage }
    },
    options: buildProviderTransportOptions(providerControls(operation, { component: 'rfp_extraction', provider: 'groq', model })),
  })
  await persistTokenUsage(operation, 'rfp_extraction', result.attempts, result.value.usage)

  return {
    output: result.value.output,
    model,
    usage: {
      ...result.value.usage,
    },
    latencyMs: result.elapsedMs,
    attempts: result.attempts,
  }
}

export async function callLlmForRfpExtraction(
  input: RfpExtractionInput,
  operation?: ProviderCallControls
): ReturnType<typeof callOpenAiForRfpExtraction> {
  const provider = getAiProvider()
  return provider === 'openai'
    ? callOpenAiForRfpExtraction(input, operation)
    : callGroqForRfpExtraction(input, operation)
}
