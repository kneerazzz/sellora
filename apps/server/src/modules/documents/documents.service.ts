import { Prisma } from '@prisma/client'
import { env } from '../../config/env'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import {
  chunkText,
  estimateTokens,
  extractDocumentText,
  inferDocumentType,
  inferMimeType,
  storeUploadBuffer,
  storeTextUpload,
} from '../../services/document/documentProcessing.service'
import { structureAwareChunk } from '../../services/document/chunking.service'
import { getEmbeddings } from '../../utils/embeddings'
import { upsertChunkEmbeddings, hasEmbeddingsConfigured } from '../../utils/vectorSearch'
import { buildPaginatedResult, getPaginationParams } from '../../utils/pagination'
import type { PaginatedResult } from '../../types/pagination.types'
import type {
  CreateDocumentInput,
  IngestDocumentTextInput,
  ListDocumentsQuery,
  MultipartDocumentFieldsInput,
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

type IngestStoredDocumentParams = {
  filename: string
  displayName: string
  description?: string
  mimeType: string
  sizeBytes: number
  fileType: NonNullable<ReturnType<typeof inferDocumentType>>
  storagePath: string
  text: string
  pageCount?: number
  tags?: string[]
  context: { organizationId: string; userId: string }
}

function normalizeMultipartTags(tags: MultipartDocumentFieldsInput['tags']): string[] {
  if (!tags) return []
  if (Array.isArray(tags)) return tags

  const trimmed = tags.trim()
  if (!trimmed) return []

  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      return parsed
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim())
        .filter(Boolean)
    }
  } catch {
    // Fall back to comma-separated tags.
  }

  return trimmed
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

async function ingestChunks(params: {
  documentId: string
  organizationId: string
  text: string
  pageCount?: number
  isReingest?: boolean
}) {
  const { documentId, text, isReingest } = params

  const chunks = await structureAwareChunk(text, { maxTokens: 400, overlapTokens: 100 })
  if (chunks.length === 0) {
    throw ApiError.badRequest('Document text did not contain ingestible content')
  }

  // Prepend heading path to chunk text to improve retrieval context
  const enrichedChunks = chunks.map((c) => {
    const headingPrefix = c.headingPath.length > 0 ? `${c.headingPath.join(' > ')}: ` : ''
    return {
      ...c,
      text: `${headingPrefix}${c.text}`
    }
  })

  const useEmbeddings = hasEmbeddingsConfigured()
  let embeddings: number[][] = []

  if (useEmbeddings) {
    // Explicitly do not pass { isQuery: true } so the default 'search_document: ' prefix is used
    embeddings = await getEmbeddings(enrichedChunks.map((c) => c.text))
  }

  const document = await prisma.$transaction(async (tx) => {
    if (isReingest) {
      await tx.documentChunk.deleteMany({ where: { documentId } })
    }

    await tx.documentChunk.createMany({
      data: enrichedChunks.map((c) => ({
        documentId,
        chunkIndex: c.chunkIndex,
        text: c.text,
        tokenCount: c.tokenCount,
        overlapTokens: c.overlapTokens,
        headingPath: c.headingPath,
        sectionTitle: c.sectionTitle,
      })),
    })

    return tx.document.update({
      where: { id: documentId },
      data: {
        status: 'COMPLETED',
        totalChunks: chunks.length,
        embeddingModel: useEmbeddings ? (env.EMBEDDING_PROVIDER === 'openai' ? env.OPENAI_EMBEDDING_MODEL : 'all-minilm') : 'local-placeholder',
        ingestedAt: new Date(),
        errorMessage: null,
        ...(params.pageCount !== undefined ? { pageCount: params.pageCount } : {}),
      },
      select: documentSelect,
    })
  })

  if (useEmbeddings && embeddings.length > 0) {
    const createdChunks = await prisma.documentChunk.findMany({
      where: { documentId },
      select: { id: true },
      orderBy: { chunkIndex: 'asc' },
    })

    const chunksWithEmbeddings = createdChunks.map((chunk, index) => ({
      id: chunk.id,
      embedding: embeddings[index]!,
    }))

    await upsertChunkEmbeddings(chunksWithEmbeddings)
  }

  return document
}

async function createIngestedDocument(params: IngestStoredDocumentParams): Promise<DocumentPayload> {
  const document = await prisma.document.create({
    data: {
      filename: params.filename,
      displayName: params.displayName,
      description: params.description,
      mimeType: params.mimeType,
      sizeBytes: params.sizeBytes,
      fileType: params.fileType,
      storagePath: params.storagePath,
      status: 'PROCESSING',
      pageCount: params.pageCount,
      tags: params.tags ?? [],
      organizationId: params.context.organizationId,
      uploadedById: params.context.userId,
    },
    select: { id: true },
  })

  try {
    return await ingestChunks({
      documentId: document.id,
      organizationId: params.context.organizationId,
      text: params.text,
      pageCount: params.pageCount,
    })
  } catch (error: any) {
    await prisma.document.update({
      where: { id: document.id },
      data: {
        status: 'FAILED',
        errorMessage: error.message || String(error),
      },
    })
    throw error
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
  return createIngestedDocument({
    filename: input.filename,
    displayName: input.displayName ?? input.filename,
    description: input.description,
    mimeType: input.mimeType ?? inferMimeType(inferredFileType),
    sizeBytes: stored.sizeBytes,
    fileType: inferredFileType,
    storagePath: stored.storagePath,
    text: stored.text,
    tags: input.tags ?? [],
    context,
  })
}

async function uploadMultipartDocument(
  file: Express.Multer.File | undefined,
  fields: MultipartDocumentFieldsInput,
  context: { organizationId: string; userId: string }
): Promise<DocumentPayload> {
  if (!file) {
    throw ApiError.badRequest('Document file is required')
  }

  const inferredFileType = inferDocumentType(file.originalname, file.mimetype)

  if (!inferredFileType) {
    throw ApiError.badRequest('Unsupported document type')
  }

  const stored = await storeUploadBuffer({
    filename: file.originalname,
    buffer: file.buffer,
    organizationId: context.organizationId,
    storageRoot: env.DOCUMENT_STORAGE_DIR,
  })
  const extracted = await extractDocumentText({
    fileType: inferredFileType,
    buffer: stored.buffer,
  })

  return createIngestedDocument({
    filename: file.originalname,
    displayName: fields.displayName ?? file.originalname,
    description: fields.description,
    mimeType: file.mimetype || inferMimeType(inferredFileType),
    sizeBytes: stored.sizeBytes,
    fileType: inferredFileType,
    storagePath: stored.storagePath,
    text: extracted.text,
    pageCount: extracted.pageCount,
    tags: normalizeMultipartTags(fields.tags),
    context,
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

  await prisma.document.update({
    where: { id: documentId },
    data: {
      status: 'PROCESSING',
      errorMessage: null,
    },
  })

  try {
    return await ingestChunks({
      documentId,
      organizationId,
      text: input.text,
      pageCount: input.pageCount,
      isReingest: true,
    })
  } catch (error: any) {
    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: 'FAILED',
        errorMessage: error.message || String(error),
      },
    })
    throw error
  }
}

export const documentsService = {
  createDocument,
  uploadDocument,
  uploadMultipartDocument,
  listDocuments,
  getDocumentById,
  ingestDocumentText,
}
