export type IMTypingHandle = (() => Promise<void>) & { refresh(): void }

/** Best-effort status updates, serialized so a late start is always cleaned up. */
export function startIMTyping(signal: AbortSignal, update: () => Promise<void>, clear?: () => Promise<void>, refreshMs = 4000): IMTypingHandle {
  let stopped = false
  let updating = false
  let refreshRequested = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: Promise<void> = Promise.resolve()
  let cleanup: Promise<void> | undefined
  const stop = () => {
    if (cleanup) return cleanup
    stopped = true
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    cleanup = pending.then(() => clear?.()).then(() => {}, () => {})
    return cleanup
  }
  const onAbort = () => { void stop() }
  const tick = () => {
    if (stopped || signal.aborted) return
    clearTimeout(timer)
    if (updating) { refreshRequested = true; return }
    updating = true
    refreshRequested = false
    pending = Promise.resolve().then(() => { if (!stopped && !signal.aborted) return update() }).catch(() => {}).then(() => {
      updating = false
      if (!stopped && !signal.aborted && (refreshRequested || refreshMs > 0)) timer = setTimeout(tick, refreshRequested ? 0 : refreshMs)
    })
  }
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) void stop()
  else tick()
  return Object.assign(stop, { refresh: tick })
}
