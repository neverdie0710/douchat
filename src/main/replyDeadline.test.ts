import { expect, it, vi } from 'vitest'
import { withReplyDeadline } from './replyDeadline'
it('stops waiting for a provider that ignores cancellation', async () => {
  const abort = new AbortController()
  const result = withReplyDeadline(() => new Promise<void>(() => {}), abort, 900000)
  const rejection = expect(result).rejects.toThrow()
  abort.abort()
  await rejection
})
it('aborts a stalled provider at its deadline and releases timers', async () => {
  vi.useFakeTimers()
  try {
    const abort = new AbortController()
    const result = withReplyDeadline(() => new Promise<void>(() => {}), abort, 900000)
    const rejection = expect(result).rejects.toThrow('timed out after 15 minutes')
    await vi.advanceTimersByTimeAsync(900000)
    await rejection
    expect(abort.signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})
