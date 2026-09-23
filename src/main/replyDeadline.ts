/** Bound the wait even if a provider fails to settle after cancellation. */
export async function withReplyDeadline<T>(operation: () => Promise<T>, abort: AbortController, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancel: (() => void) | undefined
  try {
    const cancelled = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(abort.signal.reason instanceof Error ? abort.signal.reason : new Error('Reply stopped'))
      abort.signal.addEventListener('abort', cancel, { once: true })
      if (abort.signal.aborted) cancel()
    })
    const duration = timeoutMs < 60_000 ? `${Math.round(timeoutMs / 1000)} seconds` : `${Math.round(timeoutMs / 60000)} minutes`
    timer = setTimeout(() => abort.abort(new Error(`Reply timed out after ${duration}`)), timeoutMs)
    return await Promise.race([cancelled, abort.signal.aborted ? cancelled : operation()])
  } finally {
    if (timer) clearTimeout(timer)
    if (cancel) abort.signal.removeEventListener('abort', cancel)
  }
}
