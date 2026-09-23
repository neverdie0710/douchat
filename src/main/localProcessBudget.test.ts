import { expect, it } from 'vitest'
import { LocalProcessBudget } from './localProcessBudget'

it('grants FIFO leases only after release and drops cancelled waiters', async () => {
  const budget = new LocalProcessBudget(1)
  const first = await budget.acquire()
  const abort = new AbortController()
  const cancelled = budget.acquire(abort.signal)
  const failure = expect(cancelled).rejects.toThrow('cancelled')
  const order: number[] = []
  const second = budget.acquire().then(release => { order.push(2); return release })
  const third = budget.acquire().then(release => { order.push(3); return release })
  abort.abort(new Error('cancelled'))
  await failure
  expect(order).toEqual([])
  first(); first()
  const releaseSecond = await second
  expect(order).toEqual([2])
  releaseSecond()
  const releaseThird = await third
  expect(order).toEqual([2, 3])
  releaseThird()
  expect(budget.hasWaiters).toBe(false)
})
