import { Prisma } from '@prisma/client'
import { env } from '../../config/env'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import {
  buildLocalVectorIds,
  chunkText,
  estimateTokens,
  inferDocumentType,
  inferMimeType,
  storeTextUpload,
} from '../../utils/documentProcessing'
import { buildPaginatedResult, getPaginationParams } from '../../utils/pagination'
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
  const inferredFileType = input.fileType ?? inferDocumentType(input.filename, input.mimeType)

  if (!inferredFileType) {
    throw ApiError.badRequest('Unsupported document type')
  }

  if (!['TXT', 'MARKDOWN'].includes(inferredFileType)) {
    throw ApiError.badRequest('Upload ingestion currently supports TXT and Markdown files')
  }

  const stored = await storeTextUpload({
    input,
    organizationId: context.organizationId,
    storageRoot: env.DOCUMENT_STORAGE_DIR,
  })
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

    const pineconeIds = buildLocalVectorIds(document.id, chunks.length)

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
  const { page, limit, skip } = getPaginationParams(query)
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

  return buildPaginatedResult({ items, total, page, limit })
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

    const pineconeIds = buildLocalVectorIds(documentId, chunks.length)

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
