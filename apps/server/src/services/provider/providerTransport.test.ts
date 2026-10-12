import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ProviderOperationError,
  requestProviderJson,
  waitForUncancellableProviderWork,
  type ProviderAttemptOutcome,
} from './providerTransport'

class ManualTime {
  nowMs = 0
  private timers: Array<{ at: number; resolve: () => void; reject: (error: unknown) => void; signal?: AbortSignal }> = []

  now = () => this.nowMs

  sleep = (delayMs: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const timer = { at: this.nowMs + delayMs, resolve, reject, signal }
    this.timers.push(timer)
    signal?.addEventListener('abort', () => {
      this.timers = this.timers.filter(candidate => candidate !== timer)
      reject(signal.reason)
    }, { once: true })
  })

  advance(ms: number) {
    this.nowMs += ms
    const due = this.timers.filter(timer => timer.at <= this.nowMs)
    this.timers = this.timers.filter(timer => timer.at > this.nowMs)
    for (const timer of due) timer.resolve()
  }

  get pendingTimers() {
    return this.timers.length
  }
}

const policy = {
  timeoutMs: 5_000,
  maxAttempts: 3,
  baseRetryDelayMs: 100,
  maxRetryDelayMs: 1_000,
}

const validateValue = (value: unknown) => {
  const result = (value as any)?.value
  if (typeof result !== 'string') throw new Error('missing value')
  return result
}

const settle = () => new Promise<void>(resolve => setImmediate(resolve))

describe('provider transport policy', () => {
  it('awaits attempt persistence before each dispatch and finalizes every retry', async () => {
    const events: string[] = []
    let dispatches = 0
    const result = await requestProviderJson({
      url: 'https://provider.invalid', request: {}, validate: validateValue,
      options: {
        policy: { ...policy, baseRetryDelayMs: 0, maxRetryDelayMs: 0 },
        attemptObserver: {
          beforeAttempt: async ({ attempt }) => { events.push(`start-${attempt}`) },
          afterAttempt: async ({ attempt, outcome }) => { events.push(`finish-${attempt}-${outcome}`) },
        },
        dependencies: { fetch: async () => {
          dispatches += 1
          events.push(`dispatch-${dispatches}`)
          return dispatches === 1 ? Response.json({ error: {} }, { status: 503 }) : Response.json({ value: 'ok' })
        } },
      },
    })
    assert.equal(result.value, 'ok')
    assert.deepEqual(events, [
      'start-1', 'dispatch-1', 'finish-1-failed',
      'start-2', 'dispatch-2', 'finish-2-success',
    ])
  })

  it('retries a 429 after Retry-After and exposes both attempt outcomes', async () => {
    const time = new ManualTime()
    const outcomes: ProviderAttemptOutcome[] = []
    let dispatches = 0
    const pending = requestProviderJson({
      url: 'https://provider.invalid',
      request: { method: 'POST' },
      validate: validateValue,
      options: {
        policy,
        onAttempt: outcome => outcomes.push(outcome),
        dependencies: {
          now: time.now,
          sleep: time.sleep,
          fetch: async () => {
            dispatches += 1
            return dispatches === 1
              ? Response.json({ error: { message: 'slow down' } }, { status: 429, headers: { 'Retry-After': '1' } })
              : Response.json({ value: 'ok' })
          },
        },
      },
    })

    await settle()
    assert.equal(dispatches, 1)
    time.advance(1_000)
    await settle()
    const result = await pending

    assert.equal(dispatches, 2)
    assert.equal(result.value, 'ok')
    assert.equal(outcomes.length, 2)
    assert.equal(outcomes[0]?.category, 'rate_limit')
    assert.equal(outcomes[0]?.retryDelayMs, 1_000)
    assert.equal(outcomes[1]?.outcome, 'success')
    assert.equal(time.pendingTimers, 0)
  })

  it('aborts a hanging request at the operation deadline', async () => {
    const time = new ManualTime()
    let observedAbort = false
    const pending = requestProviderJson({
      url: 'https://provider.invalid',
      request: {},
      validate: validateValue,
      options: {
        policy: { ...policy, timeoutMs: 250 },
        dependencies: {
          now: time.now,
          sleep: time.sleep,
          fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              observedAbort = true
              reject(new DOMException('aborted', 'AbortError'))
            }, { once: true })
          }),
        },
      },
    })

    await settle()
    time.advance(250)
    await assert.rejects(pending, (error: any) => {
      assert.equal(error.category, 'deadline')
      assert.equal(error.attempts.length, 1)
      assert.equal(error.attempts[0].outcome, 'deadline_exceeded')
      return true
    })
    assert.equal(observedAbort, true)
  })

  it('propagates caller cancellation and never retries it', async () => {
    const time = new ManualTime()
    const controller = new AbortController()
    let dispatches = 0
    const pending = requestProviderJson({
      url: 'https://provider.invalid',
      request: {},
      validate: validateValue,
      options: {
        ...{ policy },
        signal: controller.signal,
        dependencies: {
          now: time.now,
          sleep: time.sleep,
          fetch: async (_url, init) => {
            dispatches += 1
            return new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
            })
          },
        },
      },
    })

    await settle()
    controller.abort(new Error('caller stopped'))
    await assert.rejects(pending, (error: any) => error.category === 'cancelled' && error.attempts.length === 1)
    assert.equal(dispatches, 1)
  })

  it('does not retry authentication or response validation failures', async () => {
    for (const response of [
      Response.json({ error: { message: 'bad key' } }, { status: 401 }),
      Response.json({ unexpected: true }),
    ]) {
      let dispatches = 0
      await assert.rejects(requestProviderJson({
        url: 'https://provider.invalid',
        request: {},
        validate: validateValue,
        options: {
          policy,
          dependencies: { fetch: async () => { dispatches += 1; return response } },
        },
      }), (error: any) => {
        assert.ok(error instanceof ProviderOperationError)
        assert.ok(error.category === 'authentication' || error.category === 'validation')
        assert.equal(error.attempts.length, 1)
        return true
      })
      assert.equal(dispatches, 1)
    }
  })

  it('classifies malformed JSON as validation failure without retrying', async () => {
    let dispatches = 0
    await assert.rejects(requestProviderJson({
      url: 'https://provider.invalid',
      request: {},
      validate: validateValue,
      options: {
        policy,
        dependencies: {
          fetch: async () => {
            dispatches += 1
            return new Response('{', { status: 200, headers: { 'content-type': 'application/json' } })
          },
        },
      },
    }), (error: any) => error.category === 'validation' && error.attempts.length === 1)
    assert.equal(dispatches, 1)
  })

  it('rejects an oversized request before dispatch', async () => {
    let dispatches = 0
    await assert.rejects(requestProviderJson({
      url: 'https://provider.invalid',
      request: { method: 'POST', body: '12345' },
      validate: validateValue,
      options: {
        policy: { ...policy, maxRequestBytes: 4 },
        dependencies: { fetch: async () => { dispatches += 1; return Response.json({ value: 'unused' }) } },
      },
    }), (error: any) => error.category === 'validation' && error.attempts.length === 0)
    assert.equal(dispatches, 0)
  })

  it('stops reading an oversized streamed response without retrying', async () => {
    let dispatches = 0
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"'))
        controller.enqueue(new TextEncoder().encode('too large"}'))
      },
      cancel() { cancelled = true },
    })
    await assert.rejects(requestProviderJson({
      url: 'https://provider.invalid',
      request: {},
      validate: validateValue,
      options: {
        policy: { ...policy, maxResponseBytes: 10 },
        dependencies: { fetch: async () => { dispatches += 1; return new Response(stream) } },
      },
    }), (error: any) => error.category === 'validation' && error.attempts.length === 1)
    assert.equal(dispatches, 1)
    assert.equal(cancelled, true)
  })

  it('stops temporary failures at the configured total-attempt cap', async () => {
    let dispatches = 0
    await assert.rejects(requestProviderJson({
      url: 'https://provider.invalid',
      request: {},
      validate: validateValue,
      options: {
        policy: { ...policy, baseRetryDelayMs: 0, maxRetryDelayMs: 0 },
        dependencies: {
          fetch: async () => {
            dispatches += 1
            return Response.json({ error: { message: 'temporarily unavailable' } }, { status: 503 })
          },
        },
      },
    }), (error: any) => {
      assert.equal(error.category, 'temporary')
      assert.equal(error.attempts.length, 3)
      assert.deepEqual(error.attempts.map((attempt: ProviderAttemptOutcome) => attempt.attempt), [1, 2, 3])
      return true
    })
    assert.equal(dispatches, 3)
  })

  it('does not dispatch a retry whose delay cannot fit the remaining deadline', async () => {
    const time = new ManualTime()
    let dispatches = 0
    await assert.rejects(requestProviderJson({
      url: 'https://provider.invalid',
      request: {},
      validate: validateValue,
      options: {
        policy: { ...policy, timeoutMs: 500 },
        dependencies: {
          now: time.now,
          sleep: time.sleep,
          fetch: async () => {
            dispatches += 1
            return Response.json({ error: {} }, { status: 429, headers: { 'Retry-After': '2' } })
          },
        },
      },
    }), (error: any) => error.category === 'deadline' && error.attempts.length === 1)
    assert.equal(dispatches, 1)
  })

  it('ignores a late response after aborting the deadline-bound request', async () => {
    const time = new ManualTime()
    const outcomes: ProviderAttemptOutcome[] = []
    let resolveFetch!: (response: Response) => void
    const pending = requestProviderJson({
      url: 'https://provider.invalid',
      request: {},
      validate: validateValue,
      options: {
        policy: { ...policy, timeoutMs: 100 },
        onAttempt: outcome => outcomes.push(outcome),
        dependencies: {
          now: time.now,
          sleep: time.sleep,
          fetch: async () => new Promise<Response>(resolve => { resolveFetch = resolve }),
        },
      },
    })

    await settle()
    time.advance(100)
    await assert.rejects(pending, (error: any) => error.category === 'deadline')
    resolveFetch(Response.json({ value: 'too late' }))
    await settle()

    assert.equal(outcomes.length, 1)
    assert.equal(outcomes[0]?.outcome, 'deadline_exceeded')
    assert.equal(time.pendingTimers, 0)
  })
})

describe('local provider wait boundary', () => {
  it('returns at deadline and records that underlying work cannot be cancelled', async () => {
    const time = new ManualTime()
    const outcomes: ProviderAttemptOutcome[] = []
    const pending = waitForUncancellableProviderWork({
      timeoutMs: 100,
      controls: { onAttempt: outcome => outcomes.push(outcome) },
      dependencies: { now: time.now, sleep: time.sleep },
      work: () => new Promise<string>(() => undefined),
    })

    await settle()
    time.advance(100)
    await assert.rejects(pending, (error: any) => error.category === 'deadline')
    assert.equal(outcomes.length, 1)
    assert.equal(outcomes[0]?.cancellation, 'wait_only')
    assert.equal(outcomes[0]?.outcome, 'deadline_exceeded')
  })
})
