import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import type { PaginatedResult } from '../../types/pagination.types'
import type {
  CreateDocumentInput,
  IngestDocumentTextInput,
  ListDocumentsQuery,
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
  listDocuments,
  getDocumentById,
  ingestDocumentText,
}
