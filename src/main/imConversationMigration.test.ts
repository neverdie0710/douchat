import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { DouchatStore } from './store'
import type { Conversation } from '../shared/types'
const directories: string[] = []
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })))

it('merges existing channel history, topics and task references once without crossing accounts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'im-merge-')); directories.push(directory)
  const file = join(directory, 'state.db')
  let store = new DouchatStore(file, { seedDemo: true })
  const direct = store.conversation('direct-dobi')!
  const beforeIds = store.topicMessages(direct.id, direct.activeTopicId).map(m => m.id)
  const owner = store.currentAccountId
  store.close()
  const db = new DatabaseSync(file)
  const insert = db.prepare('INSERT INTO conversations (id, type, updatedAt, data) VALUES (?, ?, ?, ?)')
  for (const provider of ['telegram', 'wechat']) {
    const channel: Conversation = { ...direct, id: `im-${provider}`, name: `Dobi · ${provider}`, unread: 2,
      activeTopicId: `${provider}-main`, topics: [
        { id: `${provider}-main`, title: 'current', createdAt: 1, updatedAt: 2 },
        { id: `${provider}-archive`, title: 'saved topic', createdAt: 1, updatedAt: 1 }
      ] }
    insert.run(channel.id, channel.type, channel.updatedAt, JSON.stringify(channel))
  }
  const foreign = { ...direct, id: 'im-foreign', ownerId: 'other-owner' }
  insert.run(foreign.id, foreign.type, foreign.updatedAt, JSON.stringify(foreign))
  db.close()
  // Populate through the old schema before running the migration on restart.
  const fixture = new DatabaseSync(file)
  const add = fixture.prepare('INSERT INTO messages (id, conversationId, topicId, createdAt, data) VALUES (?, ?, ?, ?, ?)')
  for (const provider of ['telegram', 'wechat']) for (const topic of ['main', 'archive']) {
    const message = { id: `${provider}-${topic}-message`, conversationId: `im-${provider}`, topicId: `${provider}-${topic}`,
      createdAt: 100, authorId: 'user', authorName: 'You', text: `${provider}-${topic}`, kind: 'message', attachments: [] }
    add.run(message.id, message.conversationId, message.topicId, message.createdAt, JSON.stringify(message))
  }
  const privateMessage = { id: 'private-note', conversationId: 'im-telegram', topicId: 'telegram-main', sender: { id: 'dobi', name: 'Dobi' }, recipient: { id: 'lin', name: 'Lin' }, content: 'private history', createdAt: 100 }
  fixture.prepare('INSERT INTO privateMessages VALUES (?, ?, ?, ?, ?, ?, ?)').run(privateMessage.id, privateMessage.conversationId, privateMessage.topicId, 'dobi', 'lin', 100, JSON.stringify(privateMessage))
  const routine = { id: 'channel-routine', ownerId: owner, agentId: 'dobi', conversationId: 'im-telegram', nextRunAt: 1000 }
  fixture.prepare('INSERT INTO routines VALUES (?, ?, ?, ?, ?)').run(routine.id, 'dobi', routine.conversationId, 1000, JSON.stringify(routine))
  const run = { id: 'channel-run', ownerId: owner, agentId: 'dobi', conversationId: 'im-telegram', routineId: routine.id, createdAt: 100, status: 'succeeded' }
  fixture.prepare('INSERT INTO runs VALUES (?, ?, ?, ?, ?)').run(run.id, 'dobi', routine.id, 100, JSON.stringify(run))
  fixture.close()
  store = new DouchatStore(file, { seedDemo: true })
  expect(store.currentAccountId).toBe(owner)
  expect(store.accountConversations.filter(c => c.type === 'direct' && c.agentIds[0] === 'dobi')).toHaveLength(1)
  expect(store.conversation('im-foreign')?.ownerId).toBe('other-owner')
  const merged = store.conversation(direct.id)!
  expect(merged.unread).toBe(direct.unread + 4)
  expect(merged.topics.map(t => t.id)).toEqual(expect.arrayContaining(['telegram-archive', 'wechat-archive']))
  expect(store.topicMessages(direct.id, direct.activeTopicId).map(m => m.id)).toEqual([...beforeIds, 'telegram-main-message', 'wechat-main-message'])
  expect(store.topicMessages(direct.id, 'wechat-archive')[0].text).toBe('wechat-archive')
  expect(store.privateMessages.find(m => m.id === 'private-note')).toMatchObject({ conversationId: direct.id, topicId: direct.activeTopicId })
  expect(store.routines.find(r => r.id === 'channel-routine')?.conversationId).toBe(direct.id)
  expect(store.runs.find(r => r.id === 'channel-run')?.conversationId).toBe(direct.id)
  expect(store.messages.find(m => m.id === 'telegram-main-message')?.sourceChannel).toBe('telegram')
  expect(store.messages.find(m => m.id === 'wechat-main-message')?.sourceChannel).toBe('wechat')
  const ids = store.messages.map(m => m.id)
  store.close()
  store = new DouchatStore(file, { seedDemo: true })
  expect(store.messages.map(m => m.id)).toEqual(ids)
  expect(store.conversation(direct.id)?.unread).toBe(merged.unread)
  expect(store.ensureIMConversation('dobi', 'new-binding').id).toBe(direct.id)
  store.close()
})
