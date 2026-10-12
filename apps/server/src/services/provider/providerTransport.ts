import { ApiError } from '../../utils/apiError'

export type ProviderErrorCategory =
  | 'authentication'
  | 'cancelled'
  | 'deadline'
  | 'http'
  | 'rate_limit'
  | 'temporary'
  | 'transport'
  | 'validation'

export type ProviderAttemptOutcome = {
  attempt: number
  startedAtMs: number
  endedAtMs: number
  elapsedMs: number
  outcome: 'success' | 'failed' | 'cancelled' | 'deadline_exceeded'
  category?: ProviderErrorCategory
  statusCode?: number
  retryable: boolean
  retryDelayMs?: number
  /** Local SDK/model work may only stop waiting; HTTP fetches support propagated abort. */
  cancellation: 'propagated' | 'wait_only'
}

export type ProviderOperationPolicy = {
  timeoutMs: number
  maxAttempts: number
  baseRetryDelayMs: number
  maxRetryDelayMs: number
  maxRequestBytes?: number
  maxResponseBytes?: number
}

export type ProviderOperationControls = {
  signal?: AbortSignal
  deadlineAtMs?: number
  onAttempt?: (outcome: ProviderAttemptOutcome) => unknown | Promise<unknown>
  attemptObserver?: ProviderAttemptObserver
  usage?: { traceId: string }
}

export type ProviderAttemptObserver = {
  beforeAttempt: (event: { attempt: number; startedAtMs: number; cancellation: 'propagated' | 'wait_only' }) => Promise<void>
  afterAttempt: (outcome: ProviderAttemptOutcome) => Promise<void>
}

export type ProviderTransportDependencies = {
  fetch: typeof fetch
  now: () => number
  sleep: (delayMs: number, signal?: AbortSignal) => Promise<void>
}

export type ProviderTransportOptions = ProviderOperationControls & {
  policy: ProviderOperationPolicy
  dependencies?: Partial<ProviderTransportDependencies>
}

export class ProviderOperationError extends ApiError {
  constructor(
    message: string,
    public readonly category: ProviderErrorCategory,
    public readonly attempts: ProviderAttemptOutcome[],
    public readonly retryable: boolean,
    public readonly statusCodeFromProvider?: number,
    options?: ErrorOptions
  ) {
    super(500, message, [], false)
    if (options?.cause !== undefined) this.cause = options.cause
    Object.setPrototypeOf(this, ProviderOperationError.prototype)
  }
}

class ProviderAttemptError extends Error {
  constructor(
    message: string,
    readonly category: ProviderErrorCategory,
    readonly retryable: boolean,
    readonly statusCode?: number,
    readonly retryAfterMs?: number,
    options?: ErrorOptions
  ) {
    super(message, options)
  }
}

const defaultDependencies: ProviderTransportDependencies = {
  fetch: globalThis.fetch,
  now: Date.now,
  sleep(delayMs, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason ?? new DOMException('Operation aborted', 'AbortError'))
        return
      }

      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, delayMs)
      const onAbort = () => {
        clearTimeout(timer)
        reject(signal?.reason ?? new DOMException('Operation aborted', 'AbortError'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  },
}

class UsageObserverError extends Error {}

async function emitAttempt(
  attempts: ProviderAttemptOutcome[],
  outcome: ProviderAttemptOutcome,
  onAttempt?: (outcome: ProviderAttemptOutcome) => unknown | Promise<unknown>,
  observer?: ProviderAttemptObserver
) {
  attempts.push(outcome)
  await onAttempt?.(outcome)
  try {
    await observer?.afterAttempt(outcome)
  } catch (error) {
    throw new UsageObserverError('Usage attempt could not be finalized', { cause: error })
  }
}

function retryAfterMs(response: Response, nowMs: number): number | undefined {
  const raw = response.headers.get('retry-after')
  if (!raw) return undefined

  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000)

  const date = Date.parse(raw)
  return Number.isFinite(date) ? Math.max(0, date - nowMs) : undefined
}

function classifyStatus(status: number): Pick<ProviderAttemptError, 'category' | 'retryable'> {
  if (status === 401 || status === 403) return { category: 'authentication', retryable: false }
  if (status === 429) return { category: 'rate_limit', retryable: true }
  if (status === 408 || status === 425 || status >= 500) {
    return { category: 'temporary', retryable: true }
  }
  return { category: 'http', retryable: false }
}

function classifyThrown(error: unknown): ProviderAttemptError {
  if (error instanceof ProviderAttemptError) return error
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new ProviderAttemptError('Provider operation was cancelled', 'cancelled', false, undefined, undefined, { cause: error })
  }
  if (error instanceof TypeError || (error instanceof Error && /ECONN|ETIMEDOUT|fetch failed/i.test(error.message))) {
    return new ProviderAttemptError('Provider transport failed', 'transport', true, undefined, undefined, { cause: error })
  }
  return new ProviderAttemptError('Provider transport failed', 'transport', false, undefined, undefined, { cause: error })
}

function operationError(
  error: ProviderAttemptError,
  attempts: ProviderAttemptOutcome[]
): ProviderOperationError {
  return new ProviderOperationError(
    error.message,
    error.category,
    attempts,
    error.retryable,
    error.statusCode,
    { cause: error.cause ?? error }
  )
}

async function readResponseJson(response: Response, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ProviderAttemptError('Provider response exceeded the configured byte limit', 'validation', false, response.status)
  }
  if (!response.body) return null

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new ProviderAttemptError('Provider response exceeded the configured byte limit', 'validation', false, response.status)
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return JSON.parse(text)
  } catch (error) {
    if (error instanceof ProviderAttemptError) throw error
    throw new ProviderAttemptError('Provider response was not valid JSON', 'validation', false, response.status, undefined, { cause: error })
  } finally {
    reader.releaseLock()
  }
}

export async function requestProviderJson<T>(params: {
  url: string
  request: Omit<RequestInit, 'signal'>
  validate: (value: unknown) => T
  options: ProviderTransportOptions
}): Promise<{ value: T; attempts: ProviderAttemptOutcome[]; elapsedMs: number }> {
  const dependencies = { ...defaultDependencies, ...params.options.dependencies }
  const { policy, signal, onAttempt, attemptObserver } = params.options
  const operationStartedAt = dependencies.now()
  const deadlineAtMs = params.options.deadlineAtMs ?? operationStartedAt + policy.timeoutMs
  const attempts: ProviderAttemptOutcome[] = []
  const requestBytes = typeof params.request.body === 'string' ? Buffer.byteLength(params.request.body) : 0
  if (policy.maxRequestBytes !== undefined && requestBytes > policy.maxRequestBytes) {
    throw new ProviderOperationError('Provider request exceeded the configured byte limit', 'validation', attempts, false)
  }

  if (signal?.aborted) {
    throw new ProviderOperationError('Provider operation was cancelled', 'cancelled', attempts, false, undefined, {
      cause: signal.reason,
    })
  }

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const startedAtMs = dependencies.now()
    const remainingMs = deadlineAtMs - startedAtMs
    if (remainingMs <= 0) {
      throw new ProviderOperationError('Provider operation deadline exceeded', 'deadline', attempts, false)
    }

    try {
      await attemptObserver?.beforeAttempt({ attempt, startedAtMs, cancellation: 'propagated' })
    } catch (error) {
      throw new ProviderOperationError('Usage attempt could not be persisted before provider dispatch', 'transport', attempts, false, undefined, { cause: error })
    }

    const requestController = new AbortController()
    const deadlineSleepController = new AbortController()
    const cancelRequest = () => requestController.abort(signal?.reason)
    signal?.addEventListener('abort', cancelRequest, { once: true })

    try {
      const deadline = dependencies.sleep(remainingMs, deadlineSleepController.signal).then(() => {
        const error = new ProviderAttemptError('Provider operation deadline exceeded', 'deadline', false)
        requestController.abort(error)
        throw error
      })

      const dispatch = (async () => {
        let response: Response
        try {
          response = await dependencies.fetch(params.url, {
            ...params.request,
            signal: requestController.signal,
          })
        } catch (error) {
          if (signal?.aborted) {
            throw new ProviderAttemptError('Provider operation was cancelled', 'cancelled', false, undefined, undefined, { cause: signal.reason ?? error })
          }
          if (dependencies.now() >= deadlineAtMs || requestController.signal.reason instanceof ProviderAttemptError) {
            throw new ProviderAttemptError('Provider operation deadline exceeded', 'deadline', false, undefined, undefined, { cause: error })
          }
          throw classifyThrown(error)
        }

        const data = await readResponseJson(response, policy.maxResponseBytes ?? Number.MAX_SAFE_INTEGER)

        if (!response.ok) {
          const classified = classifyStatus(response.status)
          const providerMessage = typeof (data as any)?.error?.message === 'string'
            ? (data as any).error.message
            : `Provider request failed with status ${response.status}`
          throw new ProviderAttemptError(
            providerMessage,
            classified.category,
            classified.retryable,
            response.status,
            retryAfterMs(response, dependencies.now())
          )
        }

        try {
          return params.validate(data)
        } catch (error) {
          throw new ProviderAttemptError('Provider response failed validation', 'validation', false, response.status, undefined, { cause: error })
        }
      })()

      const value = await Promise.race([dispatch, deadline])
      const endedAtMs = dependencies.now()
      await emitAttempt(attempts, {
        attempt,
        startedAtMs,
        endedAtMs,
        elapsedMs: Math.max(0, endedAtMs - startedAtMs),
        outcome: 'success',
        retryable: false,
        cancellation: 'propagated',
      }, onAttempt, attemptObserver)
      return { value, attempts, elapsedMs: Math.max(0, endedAtMs - operationStartedAt) }
    } catch (rawError) {
      if (rawError instanceof UsageObserverError) {
        throw new ProviderOperationError(rawError.message, 'transport', attempts, false, undefined, { cause: rawError.cause ?? rawError })
      }
      const error = signal?.aborted
        ? new ProviderAttemptError('Provider operation was cancelled', 'cancelled', false, undefined, undefined, { cause: signal.reason ?? rawError })
        : classifyThrown(rawError)
      const endedAtMs = dependencies.now()
      const canRetry = error.retryable && attempt < policy.maxAttempts
      const backoffMs = Math.min(policy.maxRetryDelayMs, policy.baseRetryDelayMs * 2 ** (attempt - 1))
      const delayMs = Math.max(backoffMs, error.retryAfterMs ?? 0)
      const remainingAfterAttemptMs = deadlineAtMs - endedAtMs
      const willRetry = canRetry && delayMs < remainingAfterAttemptMs

      await emitAttempt(attempts, {
        attempt,
        startedAtMs,
        endedAtMs,
        elapsedMs: Math.max(0, endedAtMs - startedAtMs),
        outcome: error.category === 'cancelled'
          ? 'cancelled'
          : error.category === 'deadline' ? 'deadline_exceeded' : 'failed',
        category: error.category,
        statusCode: error.statusCode,
        retryable: error.retryable,
        retryDelayMs: willRetry ? delayMs : undefined,
        cancellation: 'propagated',
      }, onAttempt, attemptObserver)

      if (!willRetry) {
        if (canRetry && delayMs >= remainingAfterAttemptMs) {
          throw new ProviderOperationError('Provider retry would exceed operation deadline', 'deadline', attempts, false, error.statusCode, { cause: error })
        }
        throw operationError(error, attempts)
      }

      try {
        await dependencies.sleep(delayMs, signal)
      } catch (sleepError) {
        throw new ProviderOperationError('Provider operation was cancelled', 'cancelled', attempts, false, undefined, { cause: signal?.reason ?? sleepError })
      }
    } finally {
      deadlineSleepController.abort()
      signal?.removeEventListener('abort', cancelRequest)
    }
  }

  throw new ProviderOperationError('Provider attempts exhausted', 'temporary', attempts, false)
}

/**
 * Bounds how long callers wait for SDK/local-model work that exposes no AbortSignal.
 * Cancellation cannot stop the underlying compute/request; outcomes state that limit.
 */
export async function waitForUncancellableProviderWork<T>(params: {
  work: () => Promise<T>
  controls?: ProviderOperationControls
  timeoutMs: number
  dependencies?: Pick<ProviderTransportDependencies, 'now' | 'sleep'>
}): Promise<T> {
  const dependencies = {
    now: params.dependencies?.now ?? defaultDependencies.now,
    sleep: params.dependencies?.sleep ?? defaultDependencies.sleep,
  }
  const startedAtMs = dependencies.now()
  const deadlineAtMs = params.controls?.deadlineAtMs ?? startedAtMs + params.timeoutMs
  const remainingMs = deadlineAtMs - startedAtMs
  const attempts: ProviderAttemptOutcome[] = []

  if (params.controls?.signal?.aborted) {
    throw new ProviderOperationError('Provider operation was cancelled', 'cancelled', attempts, false, undefined, {
      cause: params.controls.signal.reason,
    })
  }
  if (remainingMs <= 0) {
    throw new ProviderOperationError('Provider operation deadline exceeded', 'deadline', attempts, false)
  }
  try {
    await params.controls?.attemptObserver?.beforeAttempt({ attempt: 1, startedAtMs, cancellation: 'wait_only' })
  } catch (error) {
    throw new ProviderOperationError('Usage attempt could not be persisted before local work', 'transport', attempts, false, undefined, { cause: error })
  }

  const waitController = new AbortController()
  const cancellation = new Promise<never>((_, reject) => {
    params.controls?.signal?.addEventListener('abort', () => {
      reject(new ProviderOperationError('Provider operation was cancelled', 'cancelled', attempts, false, undefined, {
        cause: params.controls?.signal?.reason,
      }))
    }, { once: true, signal: waitController.signal })
  })
  const deadline = dependencies.sleep(remainingMs, waitController.signal).then(() => {
    throw new ProviderOperationError('Provider operation deadline exceeded', 'deadline', attempts, false)
  })

  try {
    const value = await Promise.race([params.work(), cancellation, deadline])
    const endedAtMs = dependencies.now()
    await emitAttempt(attempts, {
      attempt: 1,
      startedAtMs,
      endedAtMs,
      elapsedMs: Math.max(0, endedAtMs - startedAtMs),
      outcome: 'success',
      retryable: false,
      cancellation: 'wait_only',
    }, params.controls?.onAttempt, params.controls?.attemptObserver)
    return value
  } catch (error) {
    if (error instanceof UsageObserverError) {
      throw new ProviderOperationError(error.message, 'transport', attempts, false, undefined, { cause: error.cause ?? error })
    }
    const providerError = error instanceof ProviderOperationError
      ? error
      : new ProviderOperationError('Local provider work failed', 'transport', attempts, false, undefined, { cause: error })
    const endedAtMs = dependencies.now()
    await emitAttempt(attempts, {
      attempt: 1,
      startedAtMs,
      endedAtMs,
      elapsedMs: Math.max(0, endedAtMs - startedAtMs),
      outcome: providerError.category === 'cancelled' ? 'cancelled' : providerError.category === 'deadline' ? 'deadline_exceeded' : 'failed',
      category: providerError.category,
      retryable: false,
      cancellation: 'wait_only',
    }, params.controls?.onAttempt, params.controls?.attemptObserver)
    throw new ProviderOperationError(providerError.message, providerError.category, attempts, false, undefined, { cause: providerError.cause ?? providerError })
  } finally {
    waitController.abort()
  }
}
