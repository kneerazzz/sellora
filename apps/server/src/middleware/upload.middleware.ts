import multer from 'multer'
import { env } from '../config/env'
import { ApiError } from '../utils/apiError'

const allowedMimeTypes = new Set([
  'text/plain',
  'text/markdown',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

export const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.DOCUMENT_UPLOAD_MAX_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      return cb(ApiError.badRequest('Unsupported document upload MIME type'))
    }

    cb(null, true)
  },
})
