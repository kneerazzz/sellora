import { Request, Response, NextFunction } from 'express'
import { z, ZodObject, ZodError } from 'zod'
import { ApiError } from '../utils/apiError'

/**
 * Validates req.body, req.params, and req.query against a Zod schema.
 *
 * Usage:
 *   router.post('/register', validate(registerSchema), controller)
 *
 * The schema should wrap body/params/query as top-level keys:
 *   z.object({ body: z.object({...}), params: z.object({...}) })
 */
export function validate(schema: ZodObject) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const parsed = await schema.parseAsync({
        body: req.body,
        params: req.params,
        query: req.query,
      })

      // Replace with parsed (coerced + transformed) values
      req.body = parsed.body ?? req.body
      req.params = (parsed.params ?? req.params) as any
      
      Object.defineProperty(req, 'query', {
        value: parsed.query ?? req.query,
        writable: true,
        enumerable: true,
        configurable: true
      })
      
      next()
    } catch (err) {
      if (err instanceof ZodError) {
        const errors = err.issues.map(
          (e) => `${e.path.slice(1).join('.')}: ${e.message}` // strip 'body.' prefix
        )
        return next(ApiError.unprocessable('Validation failed', errors))
      }
      next(err)
    }
  }
}
