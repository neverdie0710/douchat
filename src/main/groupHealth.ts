import type { GroupMember } from '../shared/bot/group'

export interface MemberHealth {
  fingerprint: string
  status: 'healthy' | 'unavailable' | 'unknown'
  checkedAt: number
  /** Transport probe latency only; never mix with task duration. */
  latencyMs?: number
  planningLatencyMs?: number
  executionLatencyMs?: number
  failures: number
}
export type GroupHealth = Record<string, MemberHealth>

/** One bounded batch, including queue time. A non-cooperative adapter cannot
 * hold up dispatch or overwrite a newer health observation after its deadline. */
export async function refreshGroupHealth(
  previous: GroupHealth,
  members: { id: string; fingerprint: string }[],
  probe: (id: string, signal: AbortSignal) => Promise<boolean | undefined>,
  signal: AbortSignal,
  intervalMs = 300_000,
  budgetMs = 6000
): Promise<GroupHealth> {
  const now = Date.now()
  const result: GroupHealth = {}
  const pending = members.filter(member => {
    const old = previous[member.id]
    result[member.id] = old?.fingerprint === member.fingerprint ? { ...old } : { fingerprint: member.fingerprint, status: 'unknown', checkedAt: 0, failures: 0 }
    const entry = result[member.id]
    if (entry.status === 'unavailable') { entry.status = 'unknown'; return true }
    return now - entry.checkedAt >= (entry.status === 'unknown' ? Math.min(intervalMs, 30_000) : intervalMs) || !entry.checkedAt
  })
  const deadline = now + budgetMs
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(8, pending.length) }, async () => {
    while (cursor < pending.length && !signal.aborted && Date.now() < deadline) {
      const member = pending[cursor++]
      const start = Date.now()
      const abort = new AbortController()
      const combined = AbortSignal.any([signal, abort.signal])
      let timer: ReturnType<typeof setTimeout> | undefined
      let cancel: (() => void) | undefined
      try {
        const ok = await Promise.race([
          probe(member.id, combined),
          new Promise<never>((_, reject) => {
            cancel = () => reject(new Error('Probe cancelled'))
            combined.addEventListener('abort', cancel, { once: true })
            if (combined.aborted) cancel()
            timer = setTimeout(() => abort.abort(), Math.max(1, deadline - Date.now()))
          })
        ])
        if (signal.aborted) break
        result[member.id] = { ...result[member.id], checkedAt: Date.now(), status: ok === undefined ? 'unknown' : ok ? 'healthy' : 'unavailable',
          ...(ok ? { latencyMs: Date.now() - start, failures: 0 } : { failures: result[member.id].failures + Number(ok === false) }) }
      } catch {
        if (!signal.aborted) result[member.id] = { ...result[member.id], status: 'unknown', checkedAt: Date.now(), failures: result[member.id].failures + 1,
          ...(abort.signal.aborted ? { latencyMs: budgetMs } : {}) }
      } finally {
        clearTimeout(timer)
        if (cancel) combined.removeEventListener('abort', cancel)
        abort.abort()
      }
    }
  }))
  return result
}

/** Availability first; relevant role/skills then measured response latency.
 * Ranking only orders candidate policy callers; the policy elects and assigns. */
export function rankGroupMembers(members: GroupMember[], health: GroupHealth, task: string, preferred?: string): GroupMember[] {
  const normalize = (text: string) => text.normalize('NFKC').toLowerCase()
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
  const tokens = [...new Set([...segmenter.segment(normalize(task))].filter(part => part.isWordLike).map(part => part.segment))]
  const score = (member: GroupMember) => {
    const record = health[member.id]
    const profile = normalize(`${member.name} ${member.description ?? ''} ${JSON.stringify(member.routing?.declared ?? [])} ${JSON.stringify(member.routing?.skills ?? [])}`)
    const fit = Math.min(60, tokens.filter(token => profile.includes(token)).length * 15)
    return (record?.status === 'unavailable' ? -1000 : record?.status === 'healthy' ? 1000 : 0)
      + fit - Math.log2(1 + (record?.planningLatencyMs ?? record?.latencyMs ?? 10_000) / 1000) * 12 + Number(member.id === preferred) * 3 - Math.min(60, (member.routing?.activeTasks ?? 0) * 15)
  }
  return [...members].sort((a, b) => score(b) - score(a))
}
