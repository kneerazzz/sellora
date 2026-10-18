import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { Request, Response, NextFunction } from 'express'

Object.assign(process.env, {
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
  JWT_ACCESS_SECRET: 'offline-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'offline-refresh-secret-at-least-32-characters',
  NODE_ENV: 'test',
})

const { prisma } = await import('./config/prisma')
const { checkReadiness } = await import('./app')
const { errorHandler } = await import('./middleware/error.middleware')

it('returns unavailable without exposing a database failure', async () => {
  const original = prisma.$queryRaw
  prisma.$queryRaw = (async () => { throw new Error('secret database detail') }) as typeof prisma.$queryRaw
  let status = 200
  let body: unknown
  const response = { status(code: number) { status = code; return this }, json(value: unknown) { body = value; return this } } as unknown as Response
  try {
    await checkReadiness({} as Request, response)
    assert.equal(status, 503)
    assert.deepEqual(body, { status: 'unavailable' })
  } finally {
    prisma.$queryRaw = original
  }
})

it('redacts unexpected error content from response and log', () => {
  const original = console.error
  const logged: string[] = []
  console.error = (...parts) => { logged.push(parts.join(' ')) }
  let status = 0
  let body: unknown
  const response = { status(code: number) { status = code; return this }, json(value: unknown) { body = value; return this } } as unknown as Response
  const request = { requestId: 'request-1', user: { organizationId: 'organization-1' } } as Request
  try {
    errorHandler(new Error('secret document content'), request, response, (() => {}) as NextFunction)
    assert.equal(status, 500)
    assert.doesNotMatch(JSON.stringify(body), /secret document content/)
    assert.doesNotMatch(logged.join(' '), /secret document content/)
    assert.match(logged.join(' '), /request-1/)
    assert.match(logged.join(' '), /organization-1/)
  } finally {
    console.error = original
  }
})
