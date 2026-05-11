import { z } from 'zod'

export const registerSchema = z.object({
  body: z.object({
    firstName: z
      .string({ error: 'First name is required' })
      .min(2, 'First name must be at least 2 characters')
      .max(50, 'First name must be at most 50 characters')
      .trim(),

    lastName: z
      .string({ error: 'Last name is required' })
      .min(2, 'Last name must be at least 2 characters')
      .max(50, 'Last name must be at most 50 characters')
      .trim(),

    email: z
      .string({ error: 'Email is required' })
      .email('Invalid email address')
      .toLowerCase()
      .trim(),

    password: z
      .string({ error: 'Password is required' })
      .min(8, 'Password must be at least 8 characters')
      .max(72, 'Password must be at most 72 characters')
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
        'Password must contain at least one uppercase letter, one lowercase letter, and one number'
      ),

    organizationName: z
      .string({ error: 'Organization name is required' })
      .min(2, 'Organization name must be at least 2 characters')
      .max(100, 'Organization name must be at most 100 characters')
      .trim(),

    organizationSlug: z
      .string({ error: 'Organization slug is required' })
      .min(2, 'Slug must be at least 2 characters')
      .max(50, 'Slug must be at most 50 characters')
      .regex(
        /^[a-z0-9-]+$/,
        'Slug can only contain lowercase letters, numbers, and hyphens'
      )
      .trim(),
  }),
})

export const loginSchema = z.object({
  body: z.object({
    email: z
      .string({ error: 'Email is required' })
      .email('Invalid email address')
      .toLowerCase()
      .trim(),

    password: z
      .string({ error: 'Password is required' })
      .min(1, 'Password is required'),
  }),
})

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z
      .string({ error: 'Refresh token is required' })
      .min(1, 'Refresh token is required'),
  }),
})

export type RegisterInput = z.infer<typeof registerSchema>['body']
export type LoginInput = z.infer<typeof loginSchema>['body']
export type RefreshInput = z.infer<typeof refreshSchema>['body']