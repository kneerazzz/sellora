import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DocumentType } from '@prisma/client'

type StoreTextUploadInput = {
  filename: string
  content: string
  encoding?: BufferEncoding
}

export function chunkText(text: string, maxChars = 1800): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  const chunks: string[] = []
  let index = 0

  while (index < normalized.length) {
    const next = normalized.slice(index, index + maxChars)
    const lastBreak = next.lastIndexOf('\n\n')
    const boundary = lastBreak > 500 ? lastBreak + 2 : next.length
    const chunk = normalized.slice(index, index + boundary).trim()

    if (chunk) chunks.push(chunk)
    index += boundary
  }

  return chunks
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

export function sanitizeFilename(filename: string): string {
  return path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_')
}

export function inferDocumentType(filename: string, mimeType?: string): DocumentType | null {
  const extension = path.extname(filename).toLowerCase()

  if (mimeType === 'text/markdown' || ['.md', '.markdown'].includes(extension)) return 'MARKDOWN'
  if (mimeType === 'text/plain' || extension === '.txt') return 'TXT'
  if (mimeType === 'application/pdf' || extension === '.pdf') return 'PDF'
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    extension === '.docx'
  ) {
    return 'DOCX'
  }

  return null
}

export function inferMimeType(fileType: DocumentType): string {
  switch (fileType) {
    case 'MARKDOWN':
      return 'text/markdown'
    case 'TXT':
      return 'text/plain'
    case 'PDF':
      return 'application/pdf'
    case 'DOCX':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }
}

export function buildLocalVectorIds(documentId: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `local:${documentId}:${index}`)
}

export async function storeTextUpload(params: {
  input: StoreTextUploadInput
  organizationId: string
  storageRoot: string
}) {
  const safeFilename = sanitizeFilename(params.input.filename)
  const storageKey = `${params.organizationId}/${randomUUID()}-${safeFilename}`
  const storagePath = path.join(params.storageRoot, storageKey)
  const fileBuffer = Buffer.from(params.input.content, params.input.encoding ?? 'utf8')

  await mkdir(path.dirname(storagePath), { recursive: true })
  await writeFile(storagePath, fileBuffer)

  return {
    storagePath,
    sizeBytes: fileBuffer.byteLength,
    text: fileBuffer.toString('utf8'),
  }
}
