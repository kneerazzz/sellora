import express, { Application, Request, Response } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import cookieParser from 'cookie-parser'
import { randomUUID } from 'node:crypto'

import { errorHandler } from './middleware/error.middleware'
import { ApiResponse } from './utils/apiResponse'
import { router } from './routes/index'
import { browserOrigin } from './middleware/browserOrigin'
import { env } from './config/env'
import { prisma } from './config/prisma'
import { getWorkerHealth } from './modules/usage/operationalHealth.service'

export async function checkReadiness(_req: Request, res: Response) {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok' })
  } catch {
    res.status(503).json({ status: 'unavailable' })
  }
}

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
  app.use((req, res, next) => {
    req.requestId = randomUUID()
    res.setHeader('X-Request-ID', req.requestId)
    next()
  })
  app.use(browserOrigin)

  // "/ route"


  // ── Logging ───────────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan((tokens, req, res) => JSON.stringify({ // Never log invite/reset tokens in URLs.
      event: 'http_request', requestId: req.requestId,
      organizationId: req.user?.organizationId ?? req.apiKey?.organizationId ?? null,
      method: tokens.method(req, res), status: Number(tokens.status(req, res)),
      durationMs: Number(tokens['response-time'](req, res)),
    })))
  }

  // ── Health check ──────────────────────────────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.json(ApiResponse.ok('Sellora API is running', { status: 'ok' }))
  })
  app.get('/ready', checkReadiness)
  app.get('/health/worker', async (_req: Request, res: Response) => {
    try {
      const worker = await getWorkerHealth()
      res.status(worker.status === 'ok' ? 200 : 503).json(worker)
    } catch {
      res.status(503).json({ status: 'unavailable' })
    }
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
