import { afterEach, expect, it, vi } from 'vitest'
import { rankGroupMembers, refreshGroupHealth, type GroupHealth } from './groupHealth'

const signal = () => new AbortController().signal
afterEach(() => vi.useRealTimers())

it('reuses healthy entries and probes only changed, added or expired members', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000)
  const members = [{ id: 'a', fingerprint: 'v1' }, { id: 'b', fingerprint: 'v1' }]
  const probe = vi.fn(async () => true)
  const first = await refreshGroupHealth({}, members, probe, signal())
  expect(probe).toHaveBeenCalledTimes(2)
  await refreshGroupHealth(first, members, probe, signal())
  expect(probe).toHaveBeenCalledTimes(2)
  const second = await refreshGroupHealth(first, [{ id: 'a', fingerprint: 'v2' }], probe, signal())
  expect(Object.keys(second)).toEqual(['a'])
  expect(probe).toHaveBeenCalledTimes(3)
  vi.setSystemTime(302_000)
  await refreshGroupHealth(second, [{ id: 'a', fingerprint: 'v2' }], probe, signal())
  expect(probe).toHaveBeenCalledTimes(4)
})

it('keeps failed members quarantined for the configured interval and restores them after a successful probe', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000)
  const members = [{ id: 'a', fingerprint: 'v1' }]
  const probe = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
  let health = await refreshGroupHealth({}, members, probe, signal())
  expect(health.a.status).toBe('unavailable')
  vi.setSystemTime(20_000)
  await refreshGroupHealth(health, members, probe, signal())
  expect(probe).toHaveBeenCalledTimes(1)
  vi.setSystemTime(32_000)
  await refreshGroupHealth(health, members, probe, signal())
  expect(probe).toHaveBeenCalledTimes(1)
  vi.setSystemTime(301_000)
  health = await refreshGroupHealth(health, members, probe, signal())
  expect(health.a).toMatchObject({ status: 'healthy', failures: 0 })
})

it('bounds the entire batch including hung probes, aborts adapters, and discards late success', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000)
  let release!: (ok: boolean) => void
  const received: AbortSignal[] = []
  const members = Array.from({ length: 20 }, (_, i) => ({ id: String(i), fingerprint: 'v1' }))
  const work = refreshGroupHealth({}, members, async (id, s) => {
    received.push(s)
    if (id === '0') return new Promise<boolean>(resolve => { release = resolve })
    return new Promise<boolean>(() => {})
  }, signal(), 300_000, 6000)
  await vi.advanceTimersByTimeAsync(6000)
  const result = await work
  expect(received).toHaveLength(8)
  expect(received.every(s => s.aborted)).toBe(true)
  expect(result['0'].status).toBe('unknown')
  expect(result['19'].status).toBe('unknown')
  release(true); await Promise.resolve()
  expect(result['0'].status).toBe('unknown')
})

it('cancels promptly and does not mark a cancelled probe as a member failure', async () => {
  const abort = new AbortController()
  const work = refreshGroupHealth({}, [{ id: 'a', fingerprint: 'v1' }], async () => new Promise(() => {}), abort.signal)
  abort.abort()
  expect((await work).a.status).toBe('unknown')
})

it('does not revive a known failed member merely because its next probe times out', async () => {
  vi.useFakeTimers(); vi.setSystemTime(400_000)
  const previous: GroupHealth = { a: { fingerprint: 'v1', status: 'unavailable', checkedAt: 1, failures: 1 } }
  const work = refreshGroupHealth(previous, [{ id: 'a', fingerprint: 'v1' }], async () => new Promise(() => {}), signal())
  await vi.advanceTimersByTimeAsync(6000)
  expect((await work).a.status).toBe('unavailable')
})

it('ranks capability, speed and health, while preserving caller roster order', () => {
  const members = [{ id: 'pm', name: '项目经理' }, { id: 'eng', name: '工程师', description: '开发 API 代码' }, { id: 'dead', name: '资深工程师' }]
  const health: GroupHealth = Object.fromEntries(members.map(member => [member.id, { status: 'healthy', checkedAt: 1, fingerprint: '', latencyMs: member.id === 'eng' ? 1000 : 50, failures: 0 }]))
  health.dead.status = 'unavailable'
  expect(rankGroupMembers(members, health, '开发 API 代码')[0].id).toBe('eng')
  expect(rankGroupMembers(members, health, '报数')[0].id).toBe('pm')
  expect(members.map(m => m.id)).toEqual(['pm', 'eng', 'dead'])
})


it('does not restore a failed member when a probe has no positive availability result', async () => {
  const previous: GroupHealth = { a: { fingerprint: 'v1', status: 'unavailable', checkedAt: 1, failures: 1 } }
  const result = await refreshGroupHealth(previous, [{ id: 'a', fingerprint: 'v1' }], async () => undefined, signal())
  expect(result.a.status).toBe('unavailable')
})

it('requires a positive probe to restore a failed member even after its configuration changes', async () => {
  const previous: GroupHealth = { a: { fingerprint: 'v1', status: 'unavailable', checkedAt: Date.now(), failures: 1 } }
  const probe = vi.fn(async () => undefined)
  const result = await refreshGroupHealth(previous, [{ id: 'a', fingerprint: 'v2' }], probe, signal())
  expect(probe).toHaveBeenCalledTimes(1)
  expect(result.a).toMatchObject({ fingerprint: 'v2', status: 'unavailable' })
})

it.each(['diseñar autenticación', '認証 設計', 'تصميم المصادقة'])('uses Unicode capability hints for %s without a fixed profession vocabulary', task => {
  const members = [{ id: 'other', name: 'Other', description: 'unrelated' }, { id: 'fit', name: 'Specialist', description: task }]
  const health: GroupHealth = Object.fromEntries(members.map(member => [member.id, { fingerprint: '', checkedAt: 1, status: 'healthy', latencyMs: 100, failures: 0 }]))
  expect(rankGroupMembers(members, health, task)[0].id).toBe('fit')
})
