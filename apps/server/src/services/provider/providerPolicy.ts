import { env } from '../../config/env'
import type {
  ProviderOperationControls,
  ProviderOperationPolicy,
  ProviderTransportDependencies,
  ProviderTransportOptions,
} from './providerTransport'

export type ProviderCallControls = ProviderOperationControls & {
  policy?: Partial<ProviderOperationPolicy>
  dependencies?: Partial<ProviderTransportDependencies>
}

export function getProviderOperationTimeoutMs(): number {
  return env.PROVIDER_OPERATION_TIMEOUT_MS
}

export function buildProviderTransportOptions(
  controls: ProviderCallControls = {}
): ProviderTransportOptions {
  return {
    signal: controls.signal,
    deadlineAtMs: controls.deadlineAtMs,
    onAttempt: controls.onAttempt,
    attemptObserver: controls.attemptObserver,
    dependencies: controls.dependencies,
    policy: {
      timeoutMs: controls.policy?.timeoutMs ?? env.PROVIDER_OPERATION_TIMEOUT_MS,
      maxAttempts: controls.policy?.maxAttempts ?? env.PROVIDER_MAX_ATTEMPTS,
      baseRetryDelayMs: controls.policy?.baseRetryDelayMs ?? env.PROVIDER_RETRY_BASE_DELAY_MS,
      maxRetryDelayMs: controls.policy?.maxRetryDelayMs ?? env.PROVIDER_RETRY_MAX_DELAY_MS,
      maxRequestBytes: controls.policy?.maxRequestBytes ?? env.PROVIDER_REQUEST_MAX_BYTES,
      maxResponseBytes: controls.policy?.maxResponseBytes ?? env.PROVIDER_RESPONSE_MAX_BYTES,
    },
  }
}
