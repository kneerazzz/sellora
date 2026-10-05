import type { Request, Response, NextFunction } from 'express'
import { ApiError } from '../utils/apiError'

// Organization authority comes only from the authenticated caller. Nested
// business payloads are data and must never be used as caller context.
export function assertNoOrganizationOverride(body: unknown): void {
  if (body && typeof body === 'object' && Object.hasOwn(body, 'organizationId')) {
    throw ApiError.forbidden('Organization cannot be supplied in the request body')
  }
}

export function rejectOrganizationOverride(req: Request, _res: Response, next: NextFunction): void {
  try {
    assertNoOrganizationOverride(req.body)
    next()
  } catch (error) {
    next(error)
  }
}
