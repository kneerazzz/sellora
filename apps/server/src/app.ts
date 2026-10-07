import express, { Application, Request, Response } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import cookieParser from 'cookie-parser'

import { errorHandler } from './middleware/error.middleware'
import { ApiResponse } from './utils/apiResponse'
import { router } from './routes/index'
import { browserOrigin } from './middleware/browserOrigin'
import { env } from './config/env'

export function createApp(): Application {
  const app = express()

  // ── Security ──────────────────────────────────────────────────────────────
  app.use(helmet())
  app.use(
    cors({
      origin(origin, callback) {
        const allowed = new URL(env.CLIENT_URL).origin
        callback(null, !origin || origin === allowed)
      },
      credentials: true,               // allow cookies (refresh token)
    })
  )

  // ── Request parsing ───────────────────────────────────────────────────────
  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ extended: true }))
  app.use(cookieParser())
  app.use(browserOrigin)

  // "/ route"


  // ── Logging ───────────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan(':method :status :response-time ms')) // Never log invite/reset tokens in URLs.
  }

  // ── Health check ──────────────────────────────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.json(ApiResponse.ok('Sellora API is running', { status: 'ok' }))
  })

  // ── API routes ────────────────────────────────────────────────────────────
  app.use('/api/v1', router)

  // ── 404 handler ───────────────────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json(
      new ApiResponse(404, 'Route not found', null)
    )
  })

  // ── Global error handler (must be last) ───────────────────────────────────
  app.use(errorHandler)

  return app
}
