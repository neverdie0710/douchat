import { afterEach, expect, it, vi } from 'vitest'
import { firstGroupPlan } from './groupPlanning'
afterEach(() => vi.useRealTimers())

it('cancels a slow planner before trying the next candidate and ignores its late success', async () => {
  vi.useFakeTimers()
  let slowSignal!: AbortSignal
  let finishSlow!: (value: string) => void
  const next = vi.fn(async () => { expect(slowSignal.aborted).toBe(true); return 'valid backup' })
  const result = firstGroupPlan([{ run: signal => { slowSignal = signal; return new Promise<string>(resolve => { finishSlow = resolve }) } }, { run: next }], new AbortController().signal)
  await vi.advanceTimersByTimeAsync(19_999)
  expect(next).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(await result).toBe('valid backup')
  finishSlow('stale plan')
  await vi.advanceTimersByTimeAsync(1)
  expect(next).toHaveBeenCalledOnce()
})

it('does not call another candidate after a fast success', async () => {
  const spare = vi.fn(async () => 'backup')
  expect(await firstGroupPlan([{ run: async () => 'first' }, { run: spare }], new AbortController().signal)).toBe('first')
  expect(spare).not.toHaveBeenCalled()
})

it('continues beyond two failed candidates without overlapping active attempts', async () => {
  vi.useFakeTimers()
  let first!: AbortSignal
  const third = vi.fn(async () => 'third plan')
  const result = firstGroupPlan([
    { run: signal => { first = signal; return new Promise<never>(() => {}) } },
    { run: async () => { expect(first.aborted).toBe(true); throw new Error('invalid JSON') } },
    { run: third }
  ], new AbortController().signal)
  await vi.advanceTimersByTimeAsync(20_000)
  expect(await result).toBe('third plan')
  expect(third).toHaveBeenCalledOnce()
})

it('reports exhaustion only after all candidates have failed', async () => {
  const candidates = Array.from({ length: 4 }, () => ({ run: vi.fn(async () => { throw new Error('invalid plan') }) }))
  await expect(firstGroupPlan(candidates, new AbortController().signal)).rejects.toThrow('All 4 planning candidates failed')
  candidates.forEach(candidate => expect(candidate.run).toHaveBeenCalledOnce())
})

it('bounds total planning time even when every transport ignores cancellation', async () => {
  vi.useFakeTimers()
  const signals: AbortSignal[] = []
  const candidates = Array.from({ length: 10 }, () => ({ run: (signal: AbortSignal) => { signals.push(signal); return new Promise<never>(() => {}) } }))
  const result = firstGroupPlan(candidates, new AbortController().signal)
  const assertion = expect(result).rejects.toThrow('120 seconds')
  await vi.advanceTimersByTimeAsync(120_000); await assertion
  expect(signals).toHaveLength(6)
  expect(signals.every(signal => signal.aborted)).toBe(true)
})

it('stops immediately on human cancellation instead of moving to another planner', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  let attempt!: AbortSignal
  const spare = vi.fn(async () => 'unused')
  const result = firstGroupPlan([{ run: signal => { attempt = signal; return new Promise<never>(() => {}) } }, { run: spare }], controller.signal)
  const assertion = expect(result).rejects.toThrow('cancelled by human')
  await vi.advanceTimersByTimeAsync(1)
  controller.abort(new Error('cancelled by human'))
  await assertion
  expect(attempt.aborted).toBe(true)
  expect(spare).not.toHaveBeenCalled()
})
