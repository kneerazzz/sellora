import { Request, Response, NextFunction } from 'express'
import { ApiError } from '../utils/apiError'

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Known operational error — safe to expose to client
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      statusCode: err.statusCode,
      message: err.message,
      errors: err.errors,
    })
    return
  }

  // Prisma known errors
  if (err.constructor.name === 'PrismaClientKnownRequestError') {
    const prismaError = err as any
    if (prismaError.code === 'P2002') {
      res.status(409).json({
        success: false,
        statusCode: 409,
        message: `A record with this ${prismaError.meta?.target} already exists`,
        errors: [],
      })
      return
    }
    if (prismaError.code === 'P2025') {
      res.status(404).json({
        success: false,
        statusCode: 404,
        message: 'Record not found',
        errors: [],
      })
      return
    }
  }

  // Unknown / unexpected error — don't leak internals
  console.error('❌ Unhandled error:', err)
  res.status(500).json({
    success: false,
    statusCode: 500,
    message: 'Internal server error',
    errors: [],
  })
}