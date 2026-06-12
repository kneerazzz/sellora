import { z } from 'zod'
import { DocumentStatus, DocumentType } from '@prisma/client'

export const createDocumentSchema = z.object({
  body: z.object({
    filename: z.string().min(1).max(255).trim(),
    displayName: z.string().min(1).max(255).trim(),
    description: z.string().max(2000).trim().optional(),
    mimeType: z.string().min(1).max(150).trim(),
    sizeBytes: z.coerce.number().int().min(0),
    fileType: z.nativeEnum(DocumentType),
    storagePath: z.string().min(1).max(1000).trim(),
    tags: z.array(z.string().trim().min(1).max(50)).default([]).optional(),
  }),
})

export const listDocumentsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
    status: z.nativeEnum(DocumentStatus).optional(),
    search: z.string().trim().optional(),
  }),
})

export const documentIdParamSchema = z.object({
  params: z.object({
    id: z.string().cuid('Invalid document ID'),
  }),
})

export const ingestDocumentTextSchema = z.object({
  params: z.object({
    id: z.string().cuid('Invalid document ID'),
  }),
  body: z.object({
    text: z.string().min(1),
    pageCount: z.coerce.number().int().min(1).optional(),
    embeddingModel: z.string().min(1).max(100).default('local-placeholder').optional(),
  }),
})

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>['body']
export type ListDocumentsQuery = z.infer<typeof listDocumentsSchema>['query']
export type IngestDocumentTextInput = z.infer<typeof ingestDocumentTextSchema>['body']
