import { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { env } from '../../config/env'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import {
  extractDocumentText,
  inferDocumentType,
  inferMimeType,
  storeUploadBuffer,
  storeTextUpload,
} from '../../services/document/documentProcessing.service'
import { persistIngestedChunks } from './ingestionPersistence'
import { structureAwareChunk } from '../../services/document/chunking.service'
import type { ChunkedBlock } from '../../services/document/chunking.service'
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
  SourceReferencesInput,
} from './documents.schema'
import { withWorkloadReservation } from '../usage/workloadReservations.service'
import { withRecordedUsageAttempt } from '../usage/usageLedger.service'

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
  status: true,
  errorMessage: true,
  pageCount: true,
  totalChunks: true,
  embeddingModel: true,
  ingestedAt: true,
  activeVersionId: true,
  deletedAt: true,
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
  pages?: Array<{ pageNumber: number; text: string }>
  pageCount?: number
  contentHash: string
  tags?: string[]
  context: { organizationId: string; userId: string; requestId?: string; workflowRunId?: string }
  usageTraceId: string
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

function assertExpandedDocumentLimits(text: string, pageCount?: number) {
  if (text.length > env.DOCUMENT_EXTRACTED_MAX_CHARS) {
    throw ApiError.badRequest('Extracted document text exceeds the configured character limit')
  }
  if (pageCount !== undefined && pageCount > env.DOCUMENT_MAX_PAGES) {
    throw ApiError.badRequest('Document page count exceeds the configured limit')
  }
}

function safeCandidateError(error: unknown) {
  return error instanceof ApiError ? error.message : 'Document processing failed'
}

async function ingestChunks(params: {
  documentId: string
  versionId: string
  expectedActiveVersionId: string | null
  organizationId: string
  text: string
  pages?: Array<{ pageNumber: number; text: string }>
  pageCount?: number
  usageTraceId: string
}) {
  const { documentId, text } = params
  assertExpandedDocumentLimits(text, params.pageCount)

  const chunks = await withRecordedUsageAttempt({
    traceId: params.usageTraceId, component: 'document_chunking', category: 'LOCAL_COMPUTE',
    quantity: text.length, unitType: 'CHARACTERS',
    work: async () => {
      if (!params.pages) return structureAwareChunk(text, { maxTokens: 400, overlapTokens: 100 })
      const all: ChunkedBlock[] = []
      for (const page of params.pages) {
        const pageChunks = await structureAwareChunk(page.text, { maxTokens: 400, overlapTokens: 100 })
        for (const chunk of pageChunks) all.push({ ...chunk, chunkIndex: all.length, pageNumber: page.pageNumber })
      }
      return all
    },
  })
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
    embeddings = await getEmbeddings(enrichedChunks.map((c) => c.text), { usage: { traceId: params.usageTraceId } })
  }

  const document = await prisma.$transaction((tx) => persistIngestedChunks(tx, {
    documentId,
    versionId: params.versionId,
    expectedActiveVersionId: params.expectedActiveVersionId,
    chunks: enrichedChunks,
    embeddings: useEmbeddings ? embeddings : null,
    pageCount: params.pageCount,
  }, upsertChunkEmbeddings))

  return document
}

async function createIngestedDocument(params: IngestStoredDocumentParams): Promise<DocumentPayload> {
  const created = await prisma.$transaction(async tx => {
    const document = await tx.document.create({
      data: {
        filename: params.filename, displayName: params.displayName,
        description: params.description, mimeType: params.mimeType,
        sizeBytes: params.sizeBytes, fileType: params.fileType,
        storagePath: params.storagePath, status: 'PROCESSING',
        pageCount: params.pageCount, tags: params.tags ?? [],
        organizationId: params.context.organizationId, uploadedById: params.context.userId,
        nextVersionNumber: 2,
      }, select: { id: true },
    })
    const version = await tx.documentVersion.create({ data: {
      documentId: document.id, organizationId: params.context.organizationId,
      versionNumber: 1, contentHash: params.contentHash,
      filename: params.filename, mimeType: params.mimeType,
      sizeBytes: params.sizeBytes, fileType: params.fileType,
      storagePath: params.storagePath, pageCount: params.pageCount,
    }, select: { id: true } })
    return { document, version }
  }).catch(async error => {
    // No record owns this newly written original if creation fails.
    await unlink(params.storagePath).catch(() => {
      console.error('Failed to remove an unowned upload after document creation failed')
    })
    throw error
  })

  try {
    const result = await ingestChunks({
      documentId: created.document.id, versionId: created.version.id,
      expectedActiveVersionId: null,
      organizationId: params.context.organizationId,
      text: params.text,
      pages: params.pages,
      pageCount: params.pageCount,
      usageTraceId: params.usageTraceId,
    })
    return prisma.document.findUniqueOrThrow({ where: { id: result.id }, select: documentSelect })
  } catch (error: any) {
    await prisma.$transaction(async tx => {
      await tx.documentVersion.update({ where: { id: created.version.id }, data: {
        status: 'FAILED', errorMessage: safeCandidateError(error),
      } })
      await tx.document.update({ where: { id: created.document.id }, data: {
        status: 'FAILED', errorMessage: safeCandidateError(error),
      } })
    })
    throw error
  }
}

async function createDocument(
  input: CreateDocumentInput,
  context: { organizationId: string; userId: string; requestId?: string; workflowRunId?: string }
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
  context: { organizationId: string; userId: string; requestId?: string; workflowRunId?: string }
): Promise<DocumentPayload> {
  const inferredFileType = input.fileType ?? inferDocumentType(input.filename, input.mimeType)

  if (!inferredFileType) {
    throw ApiError.badRequest('Unsupported document type')
  }

  if (!['TXT', 'MARKDOWN'].includes(inferredFileType)) {
    throw ApiError.badRequest('Upload ingestion currently supports TXT and Markdown files')
  }
  const decoded = Buffer.from(input.content, input.encoding ?? 'utf8')
  if (decoded.byteLength > env.DOCUMENT_UPLOAD_MAX_BYTES) throw ApiError.badRequest('Document upload exceeds the configured byte limit')
  assertExpandedDocumentLimits(decoded.toString('utf8'))

  return withWorkloadReservation({
    organizationId: context.organizationId,
    operation: 'document_ingestion',
    units: Math.max(1, decoded.byteLength),
    requestId: context.requestId,
    workflowRunId: context.workflowRunId,
    work: async ({ markAttempted, usageTraceId }) => {
      markAttempted()
      const stored = await withRecordedUsageAttempt({
        traceId: usageTraceId, component: 'original_storage', category: 'STORAGE',
        quantity: decoded.byteLength, unitType: 'BYTES',
        work: () => storeTextUpload({ input, organizationId: context.organizationId, storageRoot: env.DOCUMENT_STORAGE_DIR }),
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
        contentHash: createHash('sha256').update(decoded).digest('hex'),
        tags: input.tags ?? [],
        context,
        usageTraceId,
      })
    },
  })
}

async function uploadMultipartDocument(
  file: Express.Multer.File | undefined,
  fields: MultipartDocumentFieldsInput,
  context: { organizationId: string; userId: string; requestId?: string; workflowRunId?: string }
): Promise<DocumentPayload> {
  if (!file) {
    throw ApiError.badRequest('Document file is required')
  }
  if (file.size > env.DOCUMENT_UPLOAD_MAX_BYTES || file.buffer.byteLength > env.DOCUMENT_UPLOAD_MAX_BYTES) {
    throw ApiError.badRequest('Document upload exceeds the configured byte limit')
  }

  const inferredFileType = inferDocumentType(file.originalname, file.mimetype)

  if (!inferredFileType) {
    throw ApiError.badRequest('Unsupported document type')
  }

  return withWorkloadReservation({
    organizationId: context.organizationId,
    operation: 'document_ingestion',
    units: Math.max(1, file.buffer.byteLength),
    requestId: context.requestId,
    workflowRunId: context.workflowRunId,
    work: async ({ markAttempted, usageTraceId }) => {
      markAttempted()
      // Parse before writing an original so invalid uploads cannot leave orphan files.
      const extracted = await withRecordedUsageAttempt({
        traceId: usageTraceId, component: 'document_parse', category: 'LOCAL_COMPUTE',
        quantity: file.buffer.byteLength, unitType: 'BYTES',
        work: () => extractDocumentText({ fileType: inferredFileType, buffer: file.buffer }),
      })
      assertExpandedDocumentLimits(extracted.text, extracted.pageCount)
      const stored = await withRecordedUsageAttempt({
        traceId: usageTraceId, component: 'original_storage', category: 'STORAGE',
        quantity: file.buffer.byteLength, unitType: 'BYTES',
        work: () => storeUploadBuffer({
          filename: file.originalname, buffer: file.buffer,
          organizationId: context.organizationId, storageRoot: env.DOCUMENT_STORAGE_DIR,
        }),
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
        pages: extracted.pages,
        pageCount: extracted.pageCount,
        contentHash: createHash('sha256').update(file.buffer).digest('hex'),
        tags: normalizeMultipartTags(fields.tags),
        context,
        usageTraceId,
      })
    },
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

async function allocateCandidate(params: {
  documentId: string
  organizationId: string
  expectedActiveVersionId: string | null
  filename: string
  mimeType: string
  sizeBytes: number
  fileType: NonNullable<ReturnType<typeof inferDocumentType>>
  storagePath: string
  contentHash: string
  pageCount?: number
}) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "documents" WHERE "id" = ${params.documentId} FOR UPDATE`
    const document = await tx.document.findFirst({
      where: { id: params.documentId, organizationId: params.organizationId },
      select: { id: true, activeVersionId: true, nextVersionNumber: true, deletedAt: true },
    })
    if (!document) throw ApiError.notFound('Document not found')
    if (document.deletedAt || document.activeVersionId !== params.expectedActiveVersionId) {
      throw ApiError.conflict('Active document version changed')
    }
    await tx.document.update({ where: { id: document.id }, data: {
      nextVersionNumber: { increment: 1 },
      ...(!document.activeVersionId ? { status: 'PROCESSING' as const, errorMessage: null } : {}),
    } })
    return tx.documentVersion.create({ data: {
      documentId: document.id, organizationId: params.organizationId,
      versionNumber: document.nextVersionNumber,
      basedOnVersionId: document.activeVersionId,
      contentHash: params.contentHash,
      filename: params.filename, mimeType: params.mimeType,
      sizeBytes: params.sizeBytes, fileType: params.fileType,
      storagePath: params.storagePath, pageCount: params.pageCount,
    } })
  })
}

async function processCandidate(params: {
  versionId: string
  documentId: string
  organizationId: string
  expectedActiveVersionId: string | null
  text: string
  pages?: Array<{ pageNumber: number; text: string }>
  pageCount?: number
  usageTraceId: string
}) {
  try {
    await ingestChunks(params)
    return getDocumentById(params.documentId, params.organizationId)
  } catch (error: any) {
    const message = safeCandidateError(error)
    await prisma.$transaction(async tx => {
      await tx.documentVersion.updateMany({
        where: { id: params.versionId, organizationId: params.organizationId, status: 'BUILDING' },
        data: { status: 'FAILED', errorMessage: message },
      })
      await tx.document.updateMany({
        where: { id: params.documentId, organizationId: params.organizationId,
          activeVersionId: null, deletedAt: null },
        data: { status: 'FAILED', errorMessage: message },
      })
    })
    throw error
  }
}

async function replaceDocumentText(
  documentId: string,
  input: IngestDocumentTextInput,
  organizationId: string,
  expectedActiveVersionId: string | null,
  correlation: { requestId?: string; workflowRunId?: string } = {},
) {
  assertExpandedDocumentLimits(input.text, input.pageCount)
  const document = await prisma.document.findFirst({
    where: { id: documentId, organizationId },
    select: { filename: true, deletedAt: true },
  })
  if (!document) throw ApiError.notFound('Document not found')
  if (document.deletedAt) throw ApiError.conflict('Document is deleted')
  const bytes = Buffer.from(input.text, 'utf8')
  return withWorkloadReservation({
    organizationId, operation: 'document_ingestion', units: Math.max(1, bytes.length),
    requestId: correlation.requestId, workflowRunId: correlation.workflowRunId,
    work: async ({ markAttempted, usageTraceId }) => {
      markAttempted()
      const stored = await withRecordedUsageAttempt({ traceId: usageTraceId,
        component: 'original_storage', category: 'STORAGE', quantity: bytes.length,
        unitType: 'BYTES', work: () => storeUploadBuffer({ filename: document.filename, buffer: bytes,
          organizationId, storageRoot: env.DOCUMENT_STORAGE_DIR }) })
      let version
      try {
        version = await allocateCandidate({ documentId, organizationId, expectedActiveVersionId,
          filename: document.filename, mimeType: 'text/plain', fileType: 'TXT',
          sizeBytes: stored.sizeBytes, storagePath: stored.storagePath,
          contentHash: createHash('sha256').update(bytes).digest('hex'), pageCount: input.pageCount })
      } catch (error) { await unlink(stored.storagePath).catch(() => {}); throw error }
      return processCandidate({ versionId: version.id, documentId, organizationId,
        expectedActiveVersionId, text: input.text, pageCount: input.pageCount, usageTraceId })
    },
  })
}

async function ingestDocumentText(
  documentId: string,
  input: IngestDocumentTextInput,
  organizationId: string,
  correlation: { requestId?: string; workflowRunId?: string } = {},
) {
  const document = await prisma.document.findFirst({
    where: { id: documentId, organizationId }, select: { activeVersionId: true },
  })
  if (!document) throw ApiError.notFound('Document not found')
  return replaceDocumentText(documentId, input, organizationId, document.activeVersionId, correlation)
}

async function replaceMultipartDocument(
  documentId: string,
  file: Express.Multer.File | undefined,
  fields: MultipartDocumentFieldsInput & { expectedActiveVersionId: string | null },
  context: { organizationId: string; userId: string; requestId?: string },
) {
  if (!file) throw ApiError.badRequest('Document file is required')
  if (file.size > env.DOCUMENT_UPLOAD_MAX_BYTES || file.buffer.byteLength > env.DOCUMENT_UPLOAD_MAX_BYTES) {
    throw ApiError.badRequest('Document upload exceeds the configured byte limit')
  }
  const fileType = inferDocumentType(file.originalname, file.mimetype)
  if (!fileType) throw ApiError.badRequest('Unsupported document type')
  return withWorkloadReservation({
    organizationId: context.organizationId, operation: 'document_ingestion',
    units: Math.max(1, file.buffer.byteLength), requestId: context.requestId,
    work: async ({ markAttempted, usageTraceId }) => {
      markAttempted()
      const extracted = await withRecordedUsageAttempt({ traceId: usageTraceId,
        component: 'document_parse', category: 'LOCAL_COMPUTE', quantity: file.buffer.byteLength,
        unitType: 'BYTES', work: () => extractDocumentText({ fileType, buffer: file.buffer }) })
      assertExpandedDocumentLimits(extracted.text, extracted.pageCount)
      const stored = await withRecordedUsageAttempt({ traceId: usageTraceId,
        component: 'original_storage', category: 'STORAGE', quantity: file.buffer.byteLength,
        unitType: 'BYTES', work: () => storeUploadBuffer({ filename: file.originalname, buffer: file.buffer,
          organizationId: context.organizationId, storageRoot: env.DOCUMENT_STORAGE_DIR }) })
      let version
      try {
        version = await allocateCandidate({ documentId, organizationId: context.organizationId,
          expectedActiveVersionId: fields.expectedActiveVersionId, filename: file.originalname,
          mimeType: file.mimetype || inferMimeType(fileType), fileType,
          sizeBytes: stored.sizeBytes, storagePath: stored.storagePath,
          contentHash: createHash('sha256').update(file.buffer).digest('hex'),
          pageCount: extracted.pageCount })
      } catch (error) { await unlink(stored.storagePath).catch(() => {}); throw error }
      return processCandidate({ versionId: version.id, documentId,
        organizationId: context.organizationId,
        expectedActiveVersionId: fields.expectedActiveVersionId,
        text: extracted.text, pages: extracted.pages, pageCount: extracted.pageCount, usageTraceId })
    },
  })
}

async function listDocumentVersions(documentId: string, organizationId: string) {
  const document = await prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { id: true } })
  if (!document) throw ApiError.notFound('Document not found')
  return prisma.documentVersion.findMany({ where: { documentId, organizationId },
    select: { id: true, versionNumber: true, basedOnVersionId: true, contentHash: true,
      status: true, errorMessage: true, createdAt: true, publishedAt: true,
      filename: true, mimeType: true, sizeBytes: true, pageCount: true, totalChunks: true },
    orderBy: { versionNumber: 'desc' } })
}

async function resolveSourceReferences(input: SourceReferencesInput, organizationId: string) {
  const documentIds = [...new Set(input.references.map(reference => reference.documentId))]
  const chunkIds = [...new Set(input.references.map(reference => reference.chunkId))]
  const documents = await prisma.document.findMany({ where: { id: { in: documentIds }, organizationId },
    select: { id: true, activeVersionId: true, deletedAt: true, displayName: true } })
  const chunks = await prisma.documentChunk.findMany({ where: { id: { in: chunkIds },
    document: { organizationId } }, select: { id: true, documentId: true, versionId: true,
      chunkIndex: true, pageNumber: true, headingPath: true, sectionTitle: true,
      version: { select: { status: true } } } })
  const byDocument = new Map(documents.map(document => [document.id, document]))
  const byChunk = new Map(chunks.map(chunk => [chunk.id, chunk]))
  return input.references.map(reference => {
    const document = byDocument.get(reference.documentId)
    const chunk = byChunk.get(reference.chunkId)
    const valid = document && chunk && chunk.documentId === reference.documentId &&
      chunk.versionId === reference.versionId
    const availability = !valid || document.deletedAt ? 'UNAVAILABLE'
      : document.activeVersionId === reference.versionId && chunk.version.status === 'ACTIVE' ? 'CURRENT'
      : chunk.version.status === 'RETIRED' ? 'STALE' : 'UNAVAILABLE'
    return { ...reference, availability,
      ...(valid && !document.deletedAt ? { displayName: document.displayName,
        location: { chunkIndex: chunk.chunkIndex, pageNumber: chunk.pageNumber,
          headingPath: chunk.headingPath, sectionTitle: chunk.sectionTitle } } : {}),
    }
  })
}

async function inspectDocumentVersion(documentId: string, versionId: string, organizationId: string) {
  const document = await prisma.document.findFirst({ where: { id: documentId, organizationId },
    select: { activeVersionId: true, deletedAt: true } })
  if (!document) throw ApiError.notFound('Document not found')
  const version = await prisma.documentVersion.findFirst({ where: { id: versionId, documentId, organizationId },
    select: { id: true, status: true, versionNumber: true } })
  if (!version) throw ApiError.notFound('Document version not found')
  const availability = document.deletedAt ? 'UNAVAILABLE'
    : document.activeVersionId === versionId && version.status === 'ACTIVE' ? 'CURRENT'
    : version.status === 'RETIRED' ? 'STALE' : 'UNAVAILABLE'
  const chunks = availability === 'CURRENT' ? await prisma.documentChunk.findMany({
    where: { documentId, versionId }, orderBy: { chunkIndex: 'asc' }, take: 101,
    select: { id: true, chunkIndex: true, text: true, pageNumber: true,
      headingPath: true, sectionTitle: true },
  }) : []
  return { versionId, versionNumber: version.versionNumber, availability, chunks: chunks.slice(0, 100),
    truncated: chunks.length > 100 }
}

async function previewDocumentErasure(documentId: string, organizationId: string) {
  const document = await prisma.document.findFirst({ where: { id: documentId, organizationId },
    select: { id: true, deletedAt: true, activeVersionId: true } })
  if (!document) throw ApiError.notFound('Document not found')
  const versions = await prisma.documentVersion.findMany({ where: { documentId, organizationId },
    select: { id: true, status: true, storagePath: true, sizeBytes: true,
      _count: { select: { chunks: true } } }, orderBy: { versionNumber: 'asc' } })
  const vectorCounts = await prisma.$queryRaw<Array<{ chunks: bigint; embeddings: bigint; legacyEmbeddings: bigint }>>`
    SELECT count(*) AS chunks, count(*) FILTER (WHERE embedding IS NOT NULL) AS embeddings,
      count(*) FILTER (WHERE "legacyEmbedding" IS NOT NULL) AS "legacyEmbeddings"
    FROM document_chunks WHERE "documentId" = ${documentId}`
  const interactionCounts = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) FROM ai_interactions ai WHERE ai."organizationId" = ${organizationId}
      AND (ai."documentId" = ${documentId} OR EXISTS (
        SELECT 1 FROM document_chunks c WHERE c."documentId" = ${documentId}
          AND c.id = ANY(ai."retrievedChunkIds")))`
  const root = path.resolve(env.DOCUMENT_STORAGE_DIR)
  const originals = [...new Map(versions.map(version => [version.storagePath, version.sizeBytes])).entries()]
  return { documentId, deleted: !!document.deletedAt, activeVersionId: document.activeVersionId,
    versions: versions.map(version => ({ id: version.id, status: version.status,
      chunkCount: version._count.chunks })),
    totals: { versions: versions.length, chunks: Number(vectorCounts[0]?.chunks ?? 0n),
      embeddings: Number(vectorCounts[0]?.embeddings ?? 0n),
      legacyEmbeddings: Number(vectorCounts[0]?.legacyEmbeddings ?? 0n),
      originalFiles: originals.length, originalBytes: originals.reduce((sum, [, bytes]) => sum + bytes, 0),
      aiInteractions: Number(interactionCounts[0]?.count ?? 0n),
      unmanagedOriginalPaths: originals.filter(([file]) => !path.resolve(file).startsWith(`${root}${path.sep}`)).length },
    externalSurfaces: ['workflow_json', 'logs', 'caches', 'exports', 'backups', 'external_copies'],
    executionAvailable: false }
}

async function retryDocumentVersion(documentId: string, versionId: string, organizationId: string,
  correlation: { requestId?: string } = {}) {
  const version = await prisma.documentVersion.findFirst({
    where: { id: versionId, documentId, organizationId, status: 'FAILED' },
  })
  if (!version) throw ApiError.notFound('Failed document version not found')
  if (!version.contentHash) throw ApiError.conflict('Historical version has no verified original hash')
  const root = path.resolve(env.DOCUMENT_STORAGE_DIR)
  const original = path.resolve(version.storagePath)
  if (!original.startsWith(`${root}${path.sep}`)) throw ApiError.conflict('Original is outside managed storage')
  const current = await prisma.document.findFirst({ where: { id: documentId, organizationId },
    select: { activeVersionId: true, deletedAt: true } })
  if (!current || current.deletedAt || current.activeVersionId !== version.basedOnVersionId) {
    throw ApiError.conflict('Document version can no longer be retried')
  }
  return withWorkloadReservation({ organizationId, operation: 'document_ingestion',
    units: Math.max(1, version.sizeBytes), requestId: correlation.requestId,
    work: async ({ markAttempted, usageTraceId }) => {
      const claimed = await prisma.documentVersion.updateMany({ where: { id: versionId, status: 'FAILED' },
        data: { status: 'BUILDING', errorMessage: null } })
      if (claimed.count !== 1) throw ApiError.conflict('Document version retry is already in progress')
      markAttempted()
      try {
        const bytes = await readFile(version.storagePath)
        if (createHash('sha256').update(bytes).digest('hex') !== version.contentHash) {
          throw ApiError.conflict('Stored original no longer matches its content hash')
        }
        const extracted = await withRecordedUsageAttempt({ traceId: usageTraceId,
          component: 'document_parse', category: 'LOCAL_COMPUTE', quantity: bytes.byteLength,
          unitType: 'BYTES', work: () => extractDocumentText({ fileType: version.fileType, buffer: bytes }) })
        assertExpandedDocumentLimits(extracted.text, extracted.pageCount)
        return await processCandidate({ versionId, documentId, organizationId,
          expectedActiveVersionId: version.basedOnVersionId,
          text: extracted.text, pages: extracted.pages, pageCount: extracted.pageCount, usageTraceId })
      } catch (error) {
        await prisma.documentVersion.updateMany({ where: { id: versionId, status: 'BUILDING' },
          data: { status: 'FAILED', errorMessage: safeCandidateError(error) } })
        throw error
      }
    },
  })
}

async function deleteDocument(documentId: string, organizationId: string, expectedActiveVersionId: string | null) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "documents" WHERE "id" = ${documentId} FOR UPDATE`
    const document = await tx.document.findFirst({ where: { id: documentId, organizationId },
      select: { activeVersionId: true, deletedAt: true } })
    if (!document) throw ApiError.notFound('Document not found')
    if (document.deletedAt || document.activeVersionId !== expectedActiveVersionId) {
      throw ApiError.conflict('Active document version changed')
    }
    await tx.document.update({ where: { id: documentId }, data: {
      activeVersionId: null, deletedAt: new Date(), status: 'DELETED',
    } })
    if (expectedActiveVersionId) await tx.documentVersion.updateMany({
      where: { id: expectedActiveVersionId, documentId, status: 'ACTIVE' }, data: { status: 'RETIRED' },
    })
    return tx.document.findUniqueOrThrow({ where: { id: documentId }, select: documentSelect })
  })
}

export const documentsService = {
  createDocument,
  uploadDocument,
  uploadMultipartDocument,
  listDocuments,
  getDocumentById,
  ingestDocumentText,
  replaceDocumentText,
  replaceMultipartDocument,
  listDocumentVersions,
  resolveSourceReferences,
  inspectDocumentVersion,
  previewDocumentErasure,
  retryDocumentVersion,
  deleteDocument,
}
