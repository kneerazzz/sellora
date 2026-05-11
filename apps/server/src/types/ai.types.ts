export interface RagContext {
  chunkId: string
  documentId: string
  documentName: string
  text: string
  score: number
  pageNumber?: number
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatInput {
  message: string
  history?: ChatMessage[]
  leadId?: string
}

export interface EmailDraftInput {
  leadId: string
  objective: string      // e.g. "follow up after demo", "handle pricing objection"
  additionalContext?: string
}