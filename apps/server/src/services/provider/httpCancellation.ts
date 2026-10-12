import type { Response } from 'express'

export async function withClientDisconnectSignal<T>(
  response: Response,
  work: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort(new Error('HTTP client disconnected'))
  response.once('close', abort)

  try {
    return await work(controller.signal)
  } finally {
    response.off('close', abort)
  }
}
