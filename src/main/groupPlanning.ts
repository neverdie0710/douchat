import { groupText } from '../shared/groupText'
import type { InterfaceLanguage } from '../shared/language'

/** Ask candidates in order. An attempt is cancelled before the next starts;
 * late responses never become a second plan or dispatch duplicate work. */
export async function firstGroupPlan<T>(
  candidates: { run: (signal: AbortSignal) => Promise<T> }[],
  signal: AbortSignal,
  budgetMs = 120_000,
  attemptMs = 20_000,
  language: InterfaceLanguage = 'en'
): Promise<T> {
  signal.throwIfAborted()
  if (!candidates.length) throw new Error(groupText(language, 'No group coordinator is available.'))
  const deadline = Date.now() + budgetMs
  const budgetError = () => new Error(groupText(language, 'Group planning exceeded {seconds} seconds and was paused. Retry later or change the decision model.', { seconds: Math.round(budgetMs / 1000) }))
  let lastError: unknown
  for (const candidate of candidates) {
    signal.throwIfAborted()
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw budgetError()
    const abort = new AbortController()
    const combined = AbortSignal.any([signal, abort.signal])
    const timeout = Math.min(attemptMs, remaining)
    const timer = setTimeout(() => abort.abort(new Error(groupText(language, 'This coordinator did not return a plan within {seconds} seconds.', { seconds: Math.round(timeout / 1000) }))), timeout)
    try {
      const plan = await cancellableGroupPlan(() => candidate.run(combined), combined)
      combined.throwIfAborted()
      return plan
    } catch (error) {
      signal.throwIfAborted()
      lastError = error
    } finally {
      clearTimeout(timer)
      abort.abort(new Error('Planning attempt finished'))
    }
  }
  if (Date.now() >= deadline) throw budgetError()
  throw new Error(groupText(language, 'All {count} planning candidates failed. Last error: {error}', {
    count: candidates.length, error: lastError instanceof Error ? lastError.message : 'No usable plan'
  }))
}

/** Release the agent's queue even if a tool-free transport ignores abort. Its
 * late result is discarded; this must never wrap a tool-bearing worker. */
export async function cancellableGroupPlan<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  let cancel: (() => void) | undefined
  try {
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => reject(signal.reason ?? new Error('Planning stopped'))
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) cancel()
    })
    return await Promise.race([cancelled, Promise.resolve().then(() => { signal.throwIfAborted(); return operation() })])
  } finally {
    if (cancel) signal.removeEventListener('abort', cancel)
  }
}
