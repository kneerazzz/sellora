export interface CopilotConfig {
  apiUrl?: string
  apiKey: string
  position?: 'bottom-right' | 'bottom-left'
}

export interface Citation {
  documentId: string
  documentName: string
  filename: string
  chunkId: string
  chunkIndex: number
  pageNumber: number | null
  score: number
  snippet: string
}

export interface GroundedAnswer {
  answer: string
  refused: boolean
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  citations: Citation[]
  aiInteractionId: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW'
  citations?: Citation[]
}

interface ApiResponse<T> {
  success: boolean
  data: T
  message: string
}

let config: CopilotConfig | null = null

export function setConfig(c: CopilotConfig) {
  config = c
}

export function getConfig() {
  if (!config?.apiKey) {
    throw new Error('SelloraCopilot.init({ apiKey: "sk_sellora_..." }) is required')
  }
  return {
    apiUrl: config.apiUrl ?? 'http://localhost:4000/api/v1',
    apiKey: config.apiKey,
    position: config.position ?? 'bottom-right',
  }
}

export async function askQuestion(question: string): Promise<GroundedAnswer> {
  const { apiUrl, apiKey } = getConfig()
  const res = await fetch(`${apiUrl}/ai/grounded-answers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ question }),
  })

  const body = (await res.json()) as ApiResponse<GroundedAnswer> | { message: string }
  if (!res.ok) {
    throw new Error('message' in body ? body.message : 'Request failed')
  }
  return (body as ApiResponse<GroundedAnswer>).data
}

const HISTORY_KEY = 'sellora-copilot-messages'

export function loadMessages(): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY)
    return raw ? (JSON.parse(raw) as ChatMessage[]) : []
  } catch {
    return []
  }
}

export function saveMessages(messages: ChatMessage[]) {
  try {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(messages))
  } catch {
    /* ignore quota errors */
  }
}

export function clearStoredMessages() {
  sessionStorage.removeItem(HISTORY_KEY)
}

export function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}
