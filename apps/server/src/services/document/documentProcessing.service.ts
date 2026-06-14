import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DocumentType } from '@prisma/client'
import { PDFParse } from 'pdf-parse'
import mammoth from 'mammoth'

type StoreTextUploadInput = {
  filename: string
  content: string
  encoding?: BufferEncoding
}

type StoredUpload = {
  storagePath: string
  sizeBytes: number
  buffer: Buffer
}

export type ExtractedDocumentText = {
  text: string
  pageCount?: number
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


function buildStoragePath(params: {
  filename: string
  organizationId: string
  storageRoot: string
}) {
  const safeFilename = sanitizeFilename(params.filename)
  const storageKey = `${params.organizationId}/${randomUUID()}-${safeFilename}`

  return path.join(params.storageRoot, storageKey)
}

export async function storeUploadBuffer(params: {
  filename: string
  buffer: Buffer
  organizationId: string
  storageRoot: string
}): Promise<StoredUpload> {
  const storagePath = buildStoragePath(params)

  await mkdir(path.dirname(storagePath), { recursive: true })
  await writeFile(storagePath, params.buffer)

  return {
    storagePath,
    sizeBytes: params.buffer.byteLength,
    buffer: params.buffer,
  }
}

export async function storeTextUpload(params: {
  input: StoreTextUploadInput
  organizationId: string
  storageRoot: string
}) {
  const fileBuffer = Buffer.from(params.input.content, params.input.encoding ?? 'utf8')
  const stored = await storeUploadBuffer({
    filename: params.input.filename,
    buffer: fileBuffer,
    organizationId: params.organizationId,
    storageRoot: params.storageRoot,
  })

  return {
    storagePath: stored.storagePath,
    sizeBytes: stored.sizeBytes,
    text: fileBuffer.toString('utf8'),
  }
}

async function extractPdfText(buffer: Buffer): Promise<ExtractedDocumentText> {
  const parser = new PDFParse({ data: buffer })

  try {
    const result = await parser.getText()

    return {
      text: result.text,
      pageCount: result.total,
    }
  } finally {
    await parser.destroy()
  }
}

async function extractDocxText(buffer: Buffer): Promise<ExtractedDocumentText> {
  const result = await mammoth.extractRawText({ buffer })

  return {
    text: result.value,
  }
}

export async function extractDocumentText(params: {
  fileType: DocumentType
  buffer: Buffer
}): Promise<ExtractedDocumentText> {
  switch (params.fileType) {
    case 'TXT':
    case 'MARKDOWN':
      return { text: params.buffer.toString('utf8') }
    case 'PDF':
      return extractPdfText(params.buffer)
    case 'DOCX':
      return extractDocxText(params.buffer)
  }
}
