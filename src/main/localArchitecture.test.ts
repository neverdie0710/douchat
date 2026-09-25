import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { DouchatStore, LOCAL_DATA_VERSION } from './store'
import { LocalAccountData } from './accountData'

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()))
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'douchat-architecture-'))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  const path = join(root, 'data.db')
  const store = new DouchatStore(path, { seedDemo: true })
  cleanup.push(() => store.close())
  return { store, path }
}

it('binds data access to an account session, including switch-away-and-back', async () => {
  const { store } = setup()
  const data = new LocalAccountData(store), owner = store.currentAccountId
  const message = store.addMessage({ conversationId: 'crew', topicId: store.activeTopicId('crew'), authorId: 'user', authorName: 'You', text: 'private account text', kind: 'message' })
  expect(await data.searchMessages('crew', 'private account')).toContainEqual(message)
  const document = await data.getUserMemory('dobi')
  await data.saveUserMemory({ ...document, notes: 'My profile' }, 'dobi')
  await expect(data.saveUserMemory({ ...document, notes: 'Stale profile' }, 'dobi')).rejects.toThrow()
  store.setCurrentAccountId('other')
  await expect(data.getUserMemory()).rejects.toThrow('Account changed')
  const other = new LocalAccountData(store)
  await expect(other.searchMessages('crew', 'private')).rejects.toThrow('Chat not found')
  await expect(other.getMessagePage('crew', 'main')).rejects.toThrow('Chat not found')
  await expect(other.getUserMemory('dobi')).rejects.toThrow('Agent not found')
  store.setCurrentAccountId(owner)
  await expect(data.getUserMemory()).rejects.toThrow('Account changed')
  expect((await new LocalAccountData(store).getUserMemory('dobi')).notes).toBe('My profile')
})

it('uses full UUIDs for new contacts/groups and rejects stale record edits', () => {
  const { store } = setup()
  const agent = store.createAgent({ name: 'Reader', role: '', instructions: '', color: '#123456', provider: 'local', model: 'default', localAgentId: 'codex' })
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  expect(agent.id).toMatch(uuid)
  const group = store.createGroup({ name: 'Readers', agentIds: [agent.id] })
  expect(group.id).toMatch(uuid)
  const updated = store.updateAgent(agent.id, { name: 'New name', expectedRevision: agent.revision })!
  expect(updated.revision).toBe(agent.revision! + 1)
  expect(updated).not.toHaveProperty('expectedRevision')
  expect(() => store.updateAgent(agent.id, { name: 'Stale', expectedRevision: agent.revision })).toThrow('Agent changed')
  const groupRevision = store.conversation(group.id)!.revision
  store.updateConversation(group.id, { name: 'New group', expectedRevision: groupRevision })
  expect(() => store.updateConversation(group.id, { name: 'Stale', expectedRevision: groupRevision })).toThrow('Conversation changed')
})

it('adds versions to legacy data without changing IDs or messages and rejects future formats', () => {
  const { store, path } = setup()
  const before = store.messages
  const db = new DatabaseSync(path)
  db.exec("PRAGMA user_version = 0; UPDATE agents SET data = json_remove(data, '$.revision'); UPDATE conversations SET data = json_remove(data, '$.revision')")
  const reopened = new DouchatStore(path, { seedDemo: true })
  try {
    expect(reopened.agent('dobi')?.revision).toBeGreaterThanOrEqual(1)
    expect(reopened.conversation('crew')?.revision).toBeGreaterThanOrEqual(1)
    expect(reopened.messages).toEqual(before)
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: LOCAL_DATA_VERSION })
  } finally { reopened.close() }
  db.exec(`PRAGMA user_version = ${LOCAL_DATA_VERSION + 1}`)
  expect(() => new DouchatStore(path)).toThrow('newer Douchat version')
  expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: LOCAL_DATA_VERSION + 1 })
  db.close()
})
