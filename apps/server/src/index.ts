import 'dotenv/config'
import { createApp } from './app'
import { prisma } from './config/prisma'
import { env } from './config/env'

const PORT = env.PORT

async function bootstrap() {
  // ── Verify DB connection before accepting traffic ──────────────────────
  try {
    await prisma.$connect()
    console.log('PostgreSQL connected')
  } catch {
    console.error('Failed to connect to PostgreSQL')
    process.exit(1)
  }

  const app = createApp()

  const server = app.listen(PORT, () => {
    console.log(`Sellora API running on http://localhost:${PORT}`)
    console.log(`Health check: http://localhost:${PORT}/health`)
    console.log(`Environment: ${process.env.NODE_ENV ?? 'development'}`)
  })

  // ── Graceful shutdown ──────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`\n ${signal} received. Shutting down gracefully...`)
    server.close(async () => {
      await prisma.$disconnect()
      console.log('Database disconnected. Process exiting.')
      process.exit(0)
    })
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  // ── Unhandled errors ───────────────────────────────────────────────────
  process.on('unhandledRejection', () => {
    console.error('Unhandled Promise Rejection')
    process.exit(1)
  })

  process.on('uncaughtException', () => {
    console.error('Uncaught Exception')
    process.exit(1)
  })
}

bootstrap()
