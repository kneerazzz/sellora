import { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { env } from '../../config/env'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import type { PaginatedResult } from '../../types/pagination.types'
import type {
  CreateDocumentInput,
  IngestDocumentTextInput,
  ListDocumentsQuery,
  UploadDocumentInput,
} from './documents.schema'

const documentSelect = {
  id: true,
  createdAt: true,
  updatedAt: true,
  filename: true,
  displayName: true,
  description: true,
  mimeType: true,
  sizeBytes: true,
  fileType: true,
  storagePath: true,
  status: true,
  errorMessage: true,
  pageCount: true,
  totalChunks: true,
  embeddingModel: true,
  ingestedAt: true,
  tags: true,
  organizationId: true,
  uploadedById: true,
} satisfies Prisma.DocumentSelect

export type DocumentPayload = Prisma.DocumentGetPayload<{ select: typeof documentSelect }>

function chunkText(text: string, maxChars = 1800): string[] {
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

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function sanitizeFilename(filename: string): string {
  return path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_')
}

function inferFileType(filename: string, mimeType?: string) {
  const extension = path.extname(filename).toLowerCase()

  if (mimeType === 'text/markdown' || ['.md', '.markdown'].includes(extension)) return 'MARKDOWN' as const
  if (mimeType === 'text/plain' || extension === '.txt') return 'TXT' as const
  if (mimeType === 'application/pdf' || extension === '.pdf') return 'PDF' as const
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    extension === '.docx'
  ) {
    return 'DOCX' as const
  }

  return null
}

function inferMimeType(fileType: NonNullable<ReturnType<typeof inferFileType>>) {
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

async function storeUploadedFile(input: UploadDocumentInput, organizationId: string) {
  const safeFilename = sanitizeFilename(input.filename)
  const storageKey = `${organizationId}/${randomUUID()}-${safeFilename}`
  const storagePath = path.join(env.DOCUMENT_STORAGE_DIR, storageKey)
  const fileBuffer = Buffer.from(input.content, input.encoding ?? 'utf8')

  await mkdir(path.dirname(storagePath), { recursive: true })
  await writeFile(storagePath, fileBuffer)

  return {
    storagePath,
    sizeBytes: fileBuffer.byteLength,
    text: fileBuffer.toString('utf8'),
  }
}

async function createDocument(
  input: CreateDocumentInput,
  context: { organizationId: string; userId: string }
): Promise<DocumentPayload> {
  return prisma.document.create({
    data: {
      filename: input.filename,
      displayName: input.displayName,
      description: input.description,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      fileType: input.fileType,
      storagePath: input.storagePath,
      tags: input.tags ?? [],
      organizationId: context.organizationId,
      uploadedById: context.userId,
    },
    select: documentSelect,
  })
}

async function uploadDocument(
  input: UploadDocumentInput,
  context: { organizationId: string; userId: string }
): Promise<DocumentPayload> {
  const inferredFileType = input.fileType ?? inferFileType(input.filename, input.mimeType)

  if (!inferredFileType) {
    throw ApiError.badRequest('Unsupported document type')
  }

  if (!['TXT', 'MARKDOWN'].includes(inferredFileType)) {
    throw ApiError.badRequest('Upload ingestion currently supports TXT and Markdown files')
  }

  const stored = await storeUploadedFile(input, context.organizationId)
  const chunks = chunkText(stored.text)

  if (chunks.length === 0) {
    throw ApiError.badRequest('Uploaded document did not contain ingestible text')
  }

  return prisma.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: {
        filename: input.filename,
        displayName: input.displayName ?? input.filename,
        description: input.description,
        mimeType: input.mimeType ?? inferMimeType(inferredFileType),
        sizeBytes: stored.sizeBytes,
        fileType: inferredFileType,
        storagePath: stored.storagePath,
        status: 'PROCESSING',
        tags: input.tags ?? [],
        organizationId: context.organizationId,
        uploadedById: context.userId,
      },
      select: { id: true },
    })

    const pineconeIds = chunks.map((_, index) => `local:${document.id}:${index}`)

    await tx.documentChunk.createMany({
      data: chunks.map((text, index) => ({
        documentId: document.id,
        chunkIndex: index,
        text,
        tokenCount: estimateTokens(text),
        pineconeId: pineconeIds[index],
      })),
    })

    return tx.document.update({
      where: { id: document.id },
      data: {
        status: 'COMPLETED',
        totalChunks: chunks.length,
        embeddingModel: 'local-placeholder',
        ingestedAt: new Date(),
        pineconeIds,
        errorMessage: null,
      },
      select: documentSelect,
    })
  })
}

async function listDocuments(
  query: ListDocumentsQuery,
  organizationId: string
): Promise<PaginatedResult<DocumentPayload>> {
  const page = query.page ?? 1
  const limit = query.limit ?? 20
  const skip = (page - 1) * limit
  const where: Prisma.DocumentWhereInput = {
    organizationId,
    ...(query.status && { status: query.status }),
    ...(query.search && {
      OR: [
        { filename: { contains: query.search, mode: 'insensitive' } },
        { displayName: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ],
    }),
  }

  const [items, total] = await prisma.$transaction([
    prisma.document.findMany({
      where,
      select: documentSelect,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.document.count({ where }),
  ])

  const totalPages = Math.ceil(total / limit)

  return {
    items,
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  }
}

async function getDocumentById(documentId: string, organizationId: string): Promise<DocumentPayload> {
  const document = await prisma.document.findFirst({
    where: { id: documentId, organizationId },
    select: documentSelect,
  })

  if (!document) {
    throw ApiError.notFound('Document not found')
  }

  return document
}

async function ingestDocumentText(
  documentId: string,
  input: IngestDocumentTextInput,
  organizationId: string
) {
  const document = await prisma.document.findFirst({
    where: { id: documentId, organizationId },
    select: { id: true },
  })

  if (!document) {
    throw ApiError.notFound('Document not found')
  }

  const chunks = chunkText(input.text)
  if (chunks.length === 0) {
    throw ApiError.badRequest('Document text did not contain ingestible content')
  }

  return prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: documentId },
      data: {
        status: 'PROCESSING',
        errorMessage: null,
      },
    })

    await tx.documentChunk.deleteMany({
      where: { documentId },
    })

    const pineconeIds = chunks.map((_, index) => `local:${documentId}:${index}`)

    await tx.documentChunk.createMany({
      data: chunks.map((text, index) => ({
        documentId,
        chunkIndex: index,
        text,
        tokenCount: estimateTokens(text),
        pineconeId: pineconeIds[index],
      })),
    })

    return tx.document.update({
      where: { id: documentId },
      data: {
        status: 'COMPLETED',
        pageCount: input.pageCount,
        totalChunks: chunks.length,
        embeddingModel: input.embeddingModel ?? 'local-placeholder',
        ingestedAt: new Date(),
        pineconeIds,
        errorMessage: null,
      },
      select: documentSelect,
    })
  })
}

export const documentsService = {
  createDocument,
  uploadDocument,
  listDocuments,
  getDocumentById,
  ingestDocumentText,
}
