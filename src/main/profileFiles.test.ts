import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { DouchatStore } from './store'
import { AgentProfileFiles, profileDirectory } from './profileFiles'
import { UserMemoryFiles } from './userMemoryFile'
import { emptyUserMemory } from '../shared/userMemory'

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()))
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'douchat-profiles-'))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, 'douchat.db')
  const store = new DouchatStore(file)
  cleanup.push(() => store.close())
  store.setCurrentAccountId('owner')
  const agent = store.createAgent({ name: 'Reader', role: '', instructions: '', color: '#123456', provider: 'local', model: 'default', localAgentId: 'codex' })
  return { root, file, store, agent }
}
it('uses one contact directory for identity and memory and protects external edits', () => {
  const { root, store, agent } = setup()
  store.updateAgent(agent.id, { systemFiles: { 'SOUL.md': 'Be concise', 'IDENTITY.md': 'Reader' } })
  const directory = store.agent(agent.id)!.systemFilesDirectory!
  expect(directory).toBe(profileDirectory(join(root, 'accounts'), 'owner', agent.id))
  expect(readFileSync(join(directory, 'SOUL.md'), 'utf8')).toBe('Be concise')
  expect(dirname(store.userMemories.read(agent.id).filePath!)).toBe(directory)
  expect(dirname(store.userMemories.read().filePath!)).not.toBe(directory)
  writeFileSync(join(directory, 'SOUL.md'), 'External edit')
  expect(store.agent(agent.id)?.systemFiles?.['SOUL.md']).toBe('External edit')
  expect(store.accountAgents[0].systemFiles?.['SOUL.md']).toBe('External edit')
  expect(() => store.updateAgent(agent.id, { systemFiles: { 'SOUL.md': 'Stale edit' }, expectedSystemFiles: { 'SOUL.md': 'Be concise' } })).toThrow('changed')
  store.updateAgent(agent.id, { name: 'Renamed' })
  expect(readFileSync(join(directory, 'SOUL.md'), 'utf8')).toBe('External edit')
  rmSync(join(directory, 'SOUL.md'))
  expect(store.agent(agent.id)?.systemFiles?.['SOUL.md']).toBe('')
  store.deleteAgent(agent.id)
  expect(existsSync(directory)).toBe(false)
})
it('migrates database identity and old memory files without overwriting existing Markdown', () => {
  const { root, file, store, agent } = setup()
  const oldMemory = new UserMemoryFiles(join(root, 'memories'))
  oldMemory.write({ ...emptyUserMemory('owner', agent.id), notes: 'Edited old USER.md' })
  const db = new DatabaseSync(file)
  db.prepare('UPDATE agents SET data = ? WHERE id = ?').run(JSON.stringify({ ...agent, systemFiles: { 'SOUL.md': 'Legacy soul', 'IDENTITY.md': 'Legacy identity', 'USER.md': 'Legacy user note' } }), agent.id)
  db.prepare('INSERT INTO agent_user_memories VALUES (?, ?, ?)').run('owner', agent.id, JSON.stringify({ ...emptyUserMemory('owner', agent.id), notes: 'Old database copy' }))
  db.close()
  const directory = profileDirectory(join(root, 'accounts'), 'owner', agent.id)
  rmSync(join(directory, '.initialized'), { force: true })
  // One existing file is user-authored; migration only fills missing files.
  const profiles = new AgentProfileFiles(join(root, 'accounts'))
  profiles.save(agent, { 'SOUL.md': 'Existing Markdown' })
  const reopened = new DouchatStore(file)
  try {
    expect(reopened.agent(agent.id)?.systemFiles).toMatchObject({ 'SOUL.md': 'Existing Markdown', 'IDENTITY.md': 'Legacy identity' })
    expect(reopened.userMemories.read(agent.id).notes).toBe('Edited old USER.md\n\n# USER.md\nLegacy user note')
    expect(dirname(reopened.userMemories.read(agent.id).filePath!)).toBe(directory)
  } finally { reopened.close() }
  expect(store.agent(agent.id)?.systemFiles?.['SOUL.md']).toBe('Existing Markdown')
})
it('recovers interrupted file batches and keeps accounts isolated', () => {
  const { root, store, agent } = setup()
  const directory = store.agent(agent.id)!.systemFilesDirectory!
  writeFileSync(join(directory, '.pending-files.json'), JSON.stringify({ 'SOUL.md': 'Recovered soul', 'IDENTITY.md': 'Recovered identity' }))
  expect(store.agent(agent.id)?.systemFiles).toMatchObject({ 'SOUL.md': 'Recovered soul', 'IDENTITY.md': 'Recovered identity' })
  expect(existsSync(join(directory, '.pending-files.json'))).toBe(false)
  expect(profileDirectory(join(root, 'accounts'), 'other', agent.id)).not.toBe(directory)
})
