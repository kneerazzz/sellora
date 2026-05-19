import { ApiKeyScope, UserRole } from '@prisma/client'

/**
 * Extends Express's Request interface with Sellora-specific properties.
 * Populated by auth.middleware.ts after JWT verification.
 *
 * Available on every protected route as:
 *   req.user.id
 *   req.user.role
 *   req.user.organizationId
 *
 * n8n/external workflow routes authenticate with API keys instead:
 *   req.apiKey.id
 *   req.apiKey.scope
 *   req.apiKey.organizationId
 */
declare global {
  namespace Express {
    interface Request {
      user: {
        id: string
        email: string
        role: UserRole
        organizationId: string
        firstName: string
        lastName: string
      }
      apiKey: {
        id: string
        scope: ApiKeyScope
        organizationId: string
      }
    }
  }
}

export {}
