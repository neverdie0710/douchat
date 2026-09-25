import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { DouchatStore } from './store'
import { DouchatRuntime } from './runtime'
import { memoryMarkdown, UserMemoryFiles } from './userMemoryFile'
import { emptyUserMemory, userMemoryPrompt } from '../shared/userMemory'
import type { ComputerProvider } from './computer'
const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).reverse().forEach(fn => fn()); vi.useRealTimers() })
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'tiered-memory-'))
  const store = new DouchatStore(join(root, 'douchat.db'))
  cleanups.push(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  store.setCurrentAccountId('owner')
  const create = (name: string) => store.createAgent({ name, role: '', instructions: '', color: '#123456', provider: 'local', model: 'default', localAgentId: 'codex' })
  const agent = create('Reader'), other = create('Other')
  const remember = (key: string, text: string, kind: 'profile' | 'memory' = 'memory') => store.userMemories.remember({ scope: 'agent', action: 'remember', kind, key, text, evidence: text }, agent.id, text, 'owner')
  return { root, store, agent, other, remember }
}
it('separates profile and summary, records local dates, and retrieves corrected historical decisions', () => {
  const { store, agent, remember } = setup()
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 24, 12))
  remember('interest', 'I study astronomy', 'profile')
  remember('decision', 'Project Orion uses SQLite')
  vi.setSystemTime(new Date(2026, 8, 25, 12))
  remember('decision', 'Project Orion uses PostgreSQL')
  const doc = store.userMemories.read(agent.id)
  expect(readFileSync(doc.filePath!, 'utf8')).toContain('astronomy')
  expect(readFileSync(doc.filePath!, 'utf8')).not.toContain('PostgreSQL')
  expect(readFileSync(doc.memoryFilePath!, 'utf8')).toContain('PostgreSQL')
  expect(readFileSync(doc.memoryFilePath!, 'utf8')).not.toContain('astronomy')
  expect(readdirSync(doc.historyDirectory!)).toEqual(['2026-09-24.md', '2026-09-25.md'])
  expect(store.userMemories.search('Orion SQLite', agent.id).hits).toContainEqual(expect.objectContaining({ text: 'Project Orion uses SQLite', historical: true, path: 'memory/2026-09-24.md' }))
  expect(store.userMemories.readHistory('agent', '2026-09-24.md', agent.id).text).toContain('SQLite')
  expect(userMemoryPrompt(store.userMemories.read(), doc)).not.toContain('SQLite')
  expect(() => store.userMemories.readHistory('agent', '../USER.md', agent.id)).toThrow('Invalid memory date')
  store.userMemories.remember({ scope: 'agent', action: 'forget', key: 'decision', evidence: 'Forget Orion' }, agent.id, 'Forget Orion', 'owner')
  expect(store.userMemories.search('Orion', agent.id).hits).toEqual([])
  for (const file of readdirSync(doc.historyDirectory!)) expect(readFileSync(join(doc.historyDirectory!, file), 'utf8')).not.toContain('Orion')
})
it('keeps evicted summary facts searchable, supports archived-key forgetting and clears history', () => {
  const { store, agent, remember } = setup()
  vi.useFakeTimers()
  for (let i = 0; i < 103; i++) { vi.setSystemTime(new Date(2026, 8, 25, 12, 0, i)); remember(`fact-${i}`, `Decision number ${i} NEBULA${i}`) }
  const doc = store.userMemories.read(agent.id)
  expect(doc.facts).toHaveLength(100)
  expect(doc.facts.some(f => f.key === 'fact-0')).toBe(false)
  expect(store.userMemories.search('NEBULA0', agent.id).hits[0]).toMatchObject({ key: 'fact-0', historical: true })
  store.userMemories.remember({ scope: 'agent', action: 'forget', key: 'fact-0', evidence: 'forget' }, agent.id, 'forget', 'owner')
  expect(store.userMemories.search('NEBULA0', agent.id).hits).toEqual([])
  store.userMemories.save({ ...store.userMemories.read(agent.id), notes: '', memoryNotes: '', facts: [], clearHistory: true }, agent.id)
  expect(store.userMemories.search('NEBULA', agent.id).hits).toEqual([])
})
it('defaults to private, requires explicit shared intent, and guards hosted retrieval by turn/account', async () => {
  const { store, agent, other, remember } = setup()
  remember('secret', 'PRIVATE_STARGAZER')
  expect(store.userMemories.search('PRIVATE_STARGAZER', other.id).hits).toEqual([])
  const edit = { scope: 'shared' as const, action: 'remember' as const, key: 'shared', text: 'SHARED_STARGAZER', evidence: 'Share this' }
  expect(() => store.userMemories.remember(edit, agent.id, 'Share this', 'owner')).toThrow('explicit request')
  store.userMemories.remember({ ...edit, shareWithAll: true }, agent.id, 'Share this', 'owner')
  expect(store.userMemories.search('SHARED_STARGAZER', other.id).hits[0].scope).toBe('shared')
  const computer: ComputerProvider = { snapshots: () => [], start: vi.fn(), stop: vi.fn(), show: vi.fn(), createTools: () => [], dispose: vi.fn() }
  const runtime = new DouchatRuntime(store, computer, () => {})
  cleanups.push(() => runtime.disposeAgent(agent.id))
  const internal = runtime as any, key = `direct:direct-${agent.id}:topic`
  const [search] = internal.memoryRetrievalTools(key)
  await expect(search.execute('outside', { query: 'STARGAZER' })).rejects.toThrow('active owner')
  internal.memoryTurns.set(key, { userId: 'owner', agentId: agent.id, humanText: 'remember?', signal: new AbortController().signal, groupId: 'group' })
  await expect(search.execute('group', { query: 'STARGAZER' })).rejects.toThrow('active owner')
  internal.memoryTurns.set(key, { userId: 'owner', agentId: agent.id, humanText: 'remember?', signal: new AbortController().signal })
  expect((await search.execute('valid', { query: 'STARGAZER' })).content[0].text).toContain('PRIVATE_STARGAZER')
  store.setCurrentAccountId('other-account')
  await expect(search.execute('account', { query: 'STARGAZER' })).rejects.toThrow('Account')
})
it('migrates a combined USER.md losslessly and honors manual MEMORY.md edits', () => {
  const { store, agent } = setup()
  const empty = store.userMemories.read(agent.id)
  writeFileSync(empty.filePath!, memoryMarkdown({ ...emptyUserMemory('owner', agent.id), notes: 'Stable profile', facts: [{ key: 'old', text: 'Old agreement' }] }))
  const migrated = store.userMemories.read(agent.id)
  expect(migrated.notes).toBe('Stable profile')
  expect(readFileSync(migrated.memoryFilePath!, 'utf8')).toContain('Old agreement')
  expect(readFileSync(migrated.filePath!, 'utf8')).not.toContain('Old agreement')
  writeFileSync(migrated.memoryFilePath!, readFileSync(migrated.memoryFilePath!, 'utf8').replace('Old agreement', 'New agreement'))
  expect(() => store.userMemories.save(migrated, agent.id)).toThrow('Memory changed')
  expect(store.userMemories.read(agent.id).facts[0].text).toBe('New agreement')
  expect(dirname(migrated.filePath!)).toBe(dirname(migrated.memoryFilePath!))
})

it('recovers a newer file commit without erasing archived history or replaying the diary', () => {
  const { root, store, agent, remember } = setup()
  remember('archived', 'RECOVERY_SENTINEL')
  const before = store.userMemories.read(agent.id)
  // Simulate the file transaction committing, followed by interruption before SQLite updates.
  const files = new UserMemoryFiles(join(root, 'accounts'))
  files.write({ ...before, revision: before.revision + 1, facts: [] }, before, { retainRemovedKeys: ['archived'] })
  expect(store.userMemories.read(agent.id).facts).toEqual([])
  expect(store.userMemories.search('RECOVERY_SENTINEL', agent.id).hits[0]).toMatchObject({ historical: true, key: 'archived' })
  const date = files.dates('owner', agent.id)[0]
  const once = files.entries('owner', agent.id, date)
  store.userMemories.read(agent.id)
  expect(files.entries('owner', agent.id, date)).toEqual(once)
})

it('deleting the last current fact does not erase unrelated archived memories', () => {
  const { root, store, agent, remember } = setup()
  remember('archived', 'Keep archived fact')
  const before = store.userMemories.read(agent.id)
  new UserMemoryFiles(join(root, 'accounts')).write({ ...before, revision: before.revision + 1, facts: [] }, before, { retainRemovedKeys: ['archived'] })
  store.userMemories.read(agent.id)
  remember('current', 'Remove current fact')
  store.userMemories.save({ ...store.userMemories.read(agent.id), facts: [] }, agent.id)
  expect(store.userMemories.search('Keep archived', agent.id).hits[0]?.key).toBe('archived')
  expect(store.userMemories.search('Remove current', agent.id).hits).toEqual([])
})
