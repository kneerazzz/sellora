import type { AuthUser } from '../types/auth.types'

export function buildAuthUser(user: {
  id: string
  email: string
  firstName: string
  lastName: string
  role: AuthUser['role']
  organizationId: string
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    organizationId: user.organizationId,
  }
}
