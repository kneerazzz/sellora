import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { it } from 'node:test'
import { withClientDisconnectSignal } from './httpCancellation'

it('aborts provider work when the HTTP response closes and removes its listener', async () => {
  const response = new EventEmitter()
  let observedSignal: AbortSignal | undefined
  const pending = withClientDisconnectSignal(response as any, async (signal) => {
    observedSignal = signal
    return await new Promise<string>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  })

  response.emit('close')
  await assert.rejects(pending, /HTTP client disconnected/)
  assert.equal(observedSignal?.aborted, true)
  assert.equal(response.listenerCount('close'), 0)
})

it('removes its close listener after successful work', async () => {
  const response = new EventEmitter()
  const result = await withClientDisconnectSignal(response as any, async () => 'ok')
  assert.equal(result, 'ok')
  assert.equal(response.listenerCount('close'), 0)
})
