import { z } from 'zod'
import { passwordSchema } from '../auth/auth.schema'

export const listUsersSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
    search: z.string().trim().optional(),
  }),
})

export const changePasswordSchema = z.object({
    body: z.object({
        currentPassword: z.string({ error: 'Current password is required'}).min(1),
        newPassword: passwordSchema,
    }).refine(
        (data) => data.currentPassword !== data.newPassword,
        { message: 'New password must be different from current password', path: ['newPassword'] }
    )
})

export const updateProfileSchema = z.object({
  body: z.object({
    firstName: z.string().min(2).max(50).trim().optional(),
    lastName:  z.string().min(2).max(50).trim().optional(),
    phone:     z.string().max(20).trim().optional(),
    title:     z.string().max(100).trim().optional(),
    timezone:  z.string().max(50).trim().optional(),
    avatarUrl: z.string().url('Invalid URL').optional(),
  })
})


export type ListUsersQuery = z.infer<typeof listUsersSchema>['query']
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>['body']
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>['body']
