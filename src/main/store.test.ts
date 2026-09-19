import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { DouchatStore } from './store'

const temporaryDirectories: string[] = []

function createStore(): DouchatStore {
  const directory = mkdtempSync(join(tmpdir(), 'douchat-test-'))
  temporaryDirectories.push(directory)
  return new DouchatStore(join(directory, 'douchat.db'), { seedDemo: true })
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('DouchatStore', () => {
  it('persists menu preferences and restores hidden chats when new messages arrive', () => {
    const directory = mkdtempSync(join(tmpdir(), 'douchat-menu-'))
    temporaryDirectories.push(directory)
    const file = join(directory, 'douchat.db')
    const store = new DouchatStore(file, { seedDemo: true })
    store.setConversationPinned('direct-dobi', true)
    store.updateConversation('direct-dobi', { muted: true, hidden: true, manuallyUnread: true })
    const restored = new DouchatStore(file, { seedDemo: true })
    expect(restored.conversation('direct-dobi')).toMatchObject({ pinned: true, muted: true, hidden: true, manuallyUnread: true, unread: 1 })
    restored.addUnread('direct-dobi', 1)
    expect(restored.conversation('direct-dobi')).toMatchObject({ hidden: false, unread: 2, muted: true })
    restored.markConversationRead('direct-dobi')
    expect(restored.conversation('direct-dobi')).toMatchObject({ manuallyUnread: false, unread: 0 })
    restored.deleteConversation('direct-dobi')
    expect(new DouchatStore(file, { seedDemo: true }).conversation('direct-dobi')).toBeUndefined()
  })

  it('starts with a crew and private threads', () => {
    const store = createStore()

    expect(store.agents.map((agent) => agent.name)).toEqual(['Dobi', 'Lin'])
    expect(store.conversations.filter((conversation) => conversation.type === 'direct')).toHaveLength(2)
    expect(store.conversations.find((conversation) => conversation.id === 'crew')?.agentIds).toEqual(['dobi', 'lin'])
  })

  it('starts production profiles empty and removes an untouched legacy demo', () => {
    const directory = mkdtempSync(join(tmpdir(), 'douchat-empty-'))
    temporaryDirectories.push(directory)
    const empty = new DouchatStore(join(directory, 'empty.db'))
    expect(empty.agents).toEqual([])
    expect(empty.conversations).toEqual([])
    empty.close()

    const legacyFile = join(directory, 'legacy.db')
    new DouchatStore(legacyFile, { seedDemo: true }).close()
    const migrated = new DouchatStore(legacyFile)
    expect(migrated.agents).toEqual([])
    expect(migrated.conversations).toEqual([])
  })

  it('backfills a stable illustrated avatar seed for existing cloud contacts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'douchat-avatar-migration-'))
    temporaryDirectories.push(directory)
    const file = join(directory, 'legacy.db')
    const original = new DouchatStore(file, { seedDemo: true })
    original.close()

    // Model the on-disk shape written by releases before avatarSeed existed.
    const database = new DatabaseSync(file)
    const rows = database.prepare('SELECT id, data FROM agents').all() as Array<{ id: string; data: string }>
    for (const row of rows) {
      const agent = JSON.parse(row.data) as { avatarSeed?: string }
      delete agent.avatarSeed
      database.prepare('UPDATE agents SET data = ? WHERE id = ?').run(JSON.stringify(agent), row.id)
    }
    database.close()

    const migrated = new DouchatStore(file, { seedDemo: true })
    const seeds = migrated.agents.map((agent) => agent.avatarSeed)
    expect(seeds.every((seed) => /^[0-9a-f-]{36}$/i.test(seed ?? ''))).toBe(true)
    migrated.close()

    expect(new DouchatStore(file, { seedDemo: true }).agents.map((agent) => agent.avatarSeed)).toEqual(seeds)
  })

  it('preserves legacy demo contacts after the user has chatted with them', () => {
    const directory = mkdtempSync(join(tmpdir(), 'douchat-used-demo-'))
    temporaryDirectories.push(directory)
    const file = join(directory, 'legacy.db')
    const legacy = new DouchatStore(file, { seedDemo: true })
    legacy.addMessage({
      conversationId: 'direct-dobi',
      topicId: legacy.activeTopicId('direct-dobi'),
      authorId: 'user',
      authorName: 'You',
      text: 'Keep this conversation',
      kind: 'message'
    })
    legacy.close()

    const migrated = new DouchatStore(file)
    expect(migrated.agent('dobi')).toBeDefined()
    expect(migrated.conversation('direct-dobi')).toBeDefined()
  })

  it('reopens an existing direct chat or recreates it after deletion', () => {
    const store = createStore()
    const originalTopic = store.activeTopicId('direct-dobi')
    store.updateConversation('direct-dobi', { hidden: true })

    const reopened = store.ensureDirectConversation('dobi')
    expect(reopened.created).toBe(false)
    expect(reopened.conversation.hidden).toBeUndefined()
    expect(reopened.conversation.activeTopicId).toBe(originalTopic)

    store.deleteConversation('direct-lin')
    const recreated = store.ensureDirectConversation('lin')
    expect(recreated.created).toBe(true)
    expect(recreated.conversation).toMatchObject({ id: 'direct-lin', type: 'direct', agentIds: ['lin'] })
    expect(recreated.conversation.topics).toHaveLength(1)
    expect(() => store.ensureDirectConversation('missing')).toThrow('Contact not found')
  })

  it('backfills private source content in existing reply records', () => {
    const directory = mkdtempSync(join(tmpdir(), 'douchat-private-source-'))
    temporaryDirectories.push(directory)
    const file = join(directory, 'douchat.db')
    const store = new DouchatStore(file, { seedDemo: true })
    store.addMessage({
      conversationId: 'direct-dobi',
      topicId: store.activeTopicId('direct-dobi'),
      authorId: 'dobi',
      authorName: 'Dobi',
      text: 'I sent Lin the details.',
      kind: 'message',
      deliveries: [{ id: 'legacy-delivery', recipientId: 'lin', recipientName: 'Lin', content: '今晚七点半，老地方见。' }]
    })
    store.addMessage({
      conversationId: 'direct-lin',
      topicId: store.activeTopicId('direct-lin'),
      authorId: 'lin',
      authorName: 'Lin',
      text: '好，我会准时到。',
      kind: 'message',
      source: { kind: 'bot', id: 'dobi', name: 'Dobi' }
    })
    store.close()

    const restored = new DouchatStore(file, { seedDemo: true })
    expect(restored.topicMessages('direct-lin', restored.activeTopicId('direct-lin')).at(-1)?.source?.content)
      .toBe('今晚七点半，老地方见。')
    expect(restored.topicMessages('direct-dobi', restored.activeTopicId('direct-dobi')).at(-1)?.deliveries?.[0].replies?.[0])
      .toMatchObject({ senderId: 'lin', content: '好，我会准时到。' })
    restored.close()
  })

  it('creates one Dr. Dou Cloud contact per newly signed-in account', () => {
    const store = createStore()
    const binding = { provider: 'gateway', model: 'default' }

    const first = store.ensureDefaultCloudContact('user-1', binding)
    expect(first.created).toBe(true)
    expect(first.agent).toMatchObject({
      name: 'Dr. Dou',
      role: '豆博士',
      provider: 'gateway',
      model: 'default'
    })
    expect(first.conversation).toMatchObject({ type: 'direct', agentIds: [first.agent?.id] })
    expect(store.defaultConversationId).toBe(first.conversation?.id)

    const repeated = store.ensureDefaultCloudContact('user-1', { provider: 'gateway', model: 'changed' })
    expect(repeated.created).toBe(false)
    expect(repeated.agent?.id).toBe(first.agent?.id)
    expect(store.agents.filter((agent) => agent.name === 'Dr. Dou')).toHaveLength(1)

    const second = store.ensureDefaultCloudContact('user-2', binding)
    expect(second.created).toBe(true)
    expect(second.agent?.id).not.toBe(first.agent?.id)
    expect(store.defaultConversationId).toBe(second.conversation?.id)
    expect(store.agents.filter((agent) => agent.name === 'Dr. Dou')).toHaveLength(2)

    store.deleteAgent(first.agent!.id)
    const deleted = store.ensureDefaultCloudContact('user-1', binding)
    expect(deleted.created).toBe(false)
    expect(deleted.agent).toBeUndefined()
    expect(store.defaultConversationId).toBeUndefined()
    expect(store.agents.filter((agent) => agent.name === 'Dr. Dou')).toHaveLength(1)
  })

  it('gives a new bot its own private chat without joining existing groups', () => {
    const store = createStore()
    const agent = store.createAgent({
      name: 'Nova',
      role: 'Researcher',
      instructions: 'Find useful evidence.',
      color: '#7C6CF2',
      provider: 'openai',
      model: 'gpt-5.6-terra'
    })

    expect(store.conversations.find((conversation) => conversation.id === 'crew')?.agentIds).not.toContain(agent.id)
    const direct = store.conversations.find(
      (conversation) => conversation.type === 'direct' && conversation.agentIds[0] === agent.id
    )
    expect(agent.avatarSeed).toMatch(/^[0-9a-f-]{36}$/i)
    expect(store.agent(agent.id)?.avatarSeed).toBe(agent.avatarSeed)
    expect(direct?.topics).toHaveLength(1)
  })

  it('persists a local agent binding and keeps contacts on the same CLI independent', () => {
    const directory = mkdtempSync(join(tmpdir(), 'douchat-local-store-'))
    temporaryDirectories.push(directory)
    const file = join(directory, 'douchat.db')
    const store = new DouchatStore(file, { seedDemo: true })
    const input = { name: 'Research', role: 'Researcher', instructions: 'Find evidence', color: '#14B8A6', provider: 'local', model: 'default', localAgentId: 'codex' }
    const first = store.createAgent(input)
    const second = store.createAgent({ ...input, name: 'Builder' })
    const restored = new DouchatStore(file, { seedDemo: true })
    expect(first.avatarSeed).toBeUndefined()
    expect(second.avatarSeed).toBeUndefined()
    expect(restored.agent(first.id)?.localAgentId).toBe('codex')
    expect(restored.agent(second.id)?.localAgentId).toBe('codex')
    expect(restored.activeTopicId(`direct-${first.id}`)).not.toBe(restored.activeTopicId(`direct-${second.id}`))
  })

  it('switches an existing contact between local and endpoint without losing its chat', () => {
    const store = createStore()
    const topic = store.activeTopicId('direct-dobi')
    const before = store.topicMessages('direct-dobi', topic)
    store.updateAgent('dobi', { localAgentId: 'codex', provider: 'local', model: 'default' })
    expect(store.agent('dobi')?.localAgentId).toBe('codex')
    expect(store.activeTopicId('direct-dobi')).toBe(topic)
    expect(store.topicMessages('direct-dobi', topic)).toEqual(before)
    store.updateAgent('dobi', { localAgentId: '', provider: 'openai', model: 'test' })
    expect(store.agent('dobi')?.localAgentId).toBeFalsy()
  })

  it('creates a group with an explicit lead member', () => {
    const store = createStore()
    const group = store.createGroup({ name: 'AGI Group', agentIds: ['lin', 'dobi'], leadAgentId: 'lin' })

    expect(group.type).toBe('group')
    expect(group.leadAgentId).toBe('lin')
    expect(group.topics).toHaveLength(1)
  })

  it('keeps topics, their transcripts and unread counts apart', () => {
    const store = createStore()
    const first = store.activeTopicId('direct-dobi')
    store.addMessage({
      conversationId: 'direct-dobi',
      topicId: first,
      authorId: 'user',
      authorName: 'You',
      text: 'Plan the launch',
      kind: 'message'
    })
    const second = store.createTopic('direct-dobi')!

    expect(store.activeTopicId('direct-dobi')).toBe(second.id)
    expect(store.topicMessages('direct-dobi', second.id)).toHaveLength(0)
    // The first human line names the topic the way a chat thread is titled.
    expect(store.conversation('direct-dobi')?.topics[0].title).toBe('Plan the launch')

    store.addUnread('direct-dobi', 2)
    expect(store.conversation('direct-dobi')?.unread).toBe(2)
    store.markConversationRead('direct-dobi')
    expect(store.conversation('direct-dobi')?.unread).toBe(0)

    store.deleteTopic('direct-dobi', first)
    expect(store.topicMessages('direct-dobi', first)).toHaveLength(0)
  })

  it('keeps insertion order when messages share a timestamp', () => {
    const store = createStore()
    const topicId = store.activeTopicId('direct-dobi')
    // One model turn splits into several bubbles written in the same
    // millisecond; only insertion order can tell them apart.
    for (const text of ['first', 'second', 'third']) {
      store.addMessage({
        conversationId: 'direct-dobi',
        topicId,
        authorId: 'dobi',
        authorName: 'Dobi',
        text,
        kind: 'message',
        createdAt: 5_000
      })
    }
    expect(store.topicMessages('direct-dobi', topicId).map((message) => message.text)).toEqual([
      'first',
      'second',
      'third'
    ])
  })

  it('takes a conversation\'s messages, deliveries and routines down with it', () => {
    const store = createStore()
    const topicId = store.activeTopicId('direct-dobi')
    store.addMessage({ conversationId: 'direct-dobi', topicId, authorId: 'user', authorName: 'You', text: 'Hi', kind: 'message' })
    store.addPrivateMessages([
      {
        id: 'p1',
        conversationId: 'direct-dobi',
        topicId,
        sender: { id: 'dobi', name: 'Dobi' },
        recipient: { id: 'lin', name: 'Lin' },
        content: 'take this',
        createdAt: 1
      }
    ])
    store.createRoutine(
      {
        name: 'Daily',
        agentId: 'dobi',
        conversationId: 'direct-dobi',
        prompt: 'brief me',
        schedule: { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00' },
        timezone: 'Asia/Shanghai'
      },
      1_000
    )

    store.deleteConversation('direct-dobi')

    expect(store.conversation('direct-dobi')).toBeUndefined()
    expect(store.messages.filter((message) => message.conversationId === 'direct-dobi')).toEqual([])
    expect(store.privateMessages).toEqual([])
    expect(store.routines).toEqual([])
  })

  it('removes a deleted bot from groups and drops its private deliveries', () => {
    const store = createStore()
    const topicId = store.activeTopicId('crew')
    store.addPrivateMessages([
      {
        id: 'p1',
        conversationId: 'crew',
        topicId,
        sender: { id: 'lin', name: 'Lin' },
        recipient: { id: 'dobi', name: 'Dobi' },
        content: 'for you',
        createdAt: 1
      }
    ])
    const run = store.createRun({
      agentId: 'dobi',
      conversationId: 'crew',
      title: 'Task',
      prompt: 'go',
      trigger: 'chat'
    })
    store.addRunEvent({ runId: run.id, type: 'status', label: 'Started', status: 'running' })

    store.deleteAgent('dobi')

    expect(store.agent('dobi')).toBeUndefined()
    expect(store.conversation('direct-dobi')).toBeUndefined()
    expect(store.conversation('crew')?.agentIds).toEqual(['lin'])
    expect(store.conversation('crew')?.leadAgentId).toBe('lin')
    expect(store.privateMessages).toEqual([])
    // The run goes, and its events cascade with it.
    expect(store.runs).toEqual([])
    expect(store.runEvents).toEqual([])
  })

  it('caps run history and drops the events of runs that aged out', () => {
    const store = createStore()
    const firstRun = store.createRun({ agentId: 'dobi', conversationId: 'crew', title: 'First', prompt: 'go', trigger: 'chat' })
    store.addRunEvent({ runId: firstRun.id, type: 'status', label: 'Started', status: 'running' })
    for (let index = 0; index < 125; index += 1) {
      store.createRun({ agentId: 'dobi', conversationId: 'crew', title: `Run ${index}`, prompt: 'go', trigger: 'chat' })
    }

    expect(store.runs).toHaveLength(120)
    expect(store.runs.some((item) => item.id === firstRun.id)).toBe(false)
    expect(store.runEvents).toEqual([])
    // An event for a run that already aged out is dropped, not an exception.
    expect(() => store.addRunEvent({ runId: firstRun.id, type: 'status', label: 'Late', status: 'failed' })).not.toThrow()
    expect(store.runEvents).toEqual([])
  })

  it('persists messages between store instances', () => {
    const directory = mkdtempSync(join(tmpdir(), 'douchat-test-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'douchat.db')
    const store = new DouchatStore(filePath, { seedDemo: true })
    store.addMessage({
      conversationId: 'crew',
      topicId: store.activeTopicId('crew'),
      authorId: 'user',
      authorName: 'You',
      text: 'Build the first version.',
      kind: 'message'
    })

    const restored = new DouchatStore(filePath, { seedDemo: true })
    expect(restored.messages.at(-1)?.text).toBe('Build the first version.')
  })

  it('keeps the profile picture across restarts and rejects anything that is not one', () => {
    const directory = mkdtempSync(join(tmpdir(), 'douchat-test-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'douchat.db')
    const store = new DouchatStore(filePath, { seedDemo: true })
    const picture = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

    expect(store.userAvatar).toBe('')
    store.setUserAvatar(picture)
    expect(new DouchatStore(filePath, { seedDemo: true }).userAvatar).toBe(picture)

    // A remote URL would let the state file pull an image at render time, and
    // an oversized payload would slow every load; both are refused outright.
    store.setUserAvatar('https://example.com/me.png')
    store.setUserAvatar(`data:image/png;base64,${'A'.repeat(2_000_000)}`)
    expect(store.userAvatar).toBe(picture)

    store.setUserAvatar('')
    expect(new DouchatStore(filePath, { seedDemo: true }).userAvatar).toBe('')
  })

  it('persists a contact picture, clears it, and refuses remote images', () => {
    const directory = mkdtempSync(join(tmpdir(), 'douchat-contact-avatar-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'douchat.db')
    const store = new DouchatStore(filePath, { seedDemo: true })
    const picture = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

    store.updateAgent('dobi', { avatar: picture })
    expect(new DouchatStore(filePath, { seedDemo: true }).agent('dobi')?.avatar).toBe(picture)

    store.updateAgent('dobi', { avatar: 'https://example.com/contact.png' })
    expect(store.agent('dobi')?.avatar).toBe(picture)

    store.updateAgent('dobi', { avatar: '' })
    expect(new DouchatStore(filePath, { seedDemo: true }).agent('dobi')?.avatar).toBe('')
  })

  it('persists routines and their run history', () => {
    const directory = mkdtempSync(join(tmpdir(), 'douchat-test-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'douchat.db')
    const store = new DouchatStore(filePath, { seedDemo: true })
    const routine = store.createRoutine(
      {
        name: 'Morning brief',
        agentId: 'dobi',
        conversationId: 'direct-dobi',
        prompt: 'Review the morning brief.',
        schedule: { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00' },
        timezone: 'Asia/Shanghai'
      },
      2_000
    )
    const run = store.createRun({
      agentId: 'dobi',
      conversationId: 'direct-dobi',
      routineId: routine.id,
      title: routine.name,
      prompt: routine.prompt,
      trigger: 'manual'
    })
    store.updateRun(run.id, { status: 'succeeded', finishedAt: 3_000 })
    store.addRunEvent({ runId: run.id, type: 'status', label: 'Finished', status: 'succeeded' })

    const restored = new DouchatStore(filePath, { seedDemo: true })
    expect(restored.routines[0]).toMatchObject({ name: 'Morning brief', nextRunAt: 2_000, enabled: true })
    expect(restored.runs[0]).toMatchObject({ routineId: routine.id, status: 'succeeded' })
    expect(restored.runEvents[0]).toMatchObject({ runId: run.id, label: 'Finished' })
  })

  it('persists connector metadata without credentials', () => {
    const directory = mkdtempSync(join(tmpdir(), 'douchat-connectors-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'douchat.db')
    const store = new DouchatStore(filePath, { seedDemo: true })
    store.setConnectors([{
      id: 'email-work', kind: 'email', name: 'Work email', email: 'team@example.com', username: 'team@example.com',
      imapHost: 'imap.example.com', imapPort: 993, imapSecure: true,
      smtpHost: 'smtp.example.com', smtpPort: 465, smtpSecure: true,
      agentIds: ['dobi'], status: 'connected', updatedAt: 123
    }])

    const restored = new DouchatStore(filePath, { seedDemo: true }).connectors
    expect(restored).toEqual([expect.objectContaining({ id: 'email-work', email: 'team@example.com', agentIds: ['dobi'] })])
    expect(JSON.stringify(restored)).not.toContain('password')
  })
})

describe('message pagination', () => {
  it('pages by insertion order without gaps when timestamps match and new replies arrive', () => {
    const store = createStore()
    const agent = store.createAgent({ name: 'Pages', role: 'Assistant', instructions: 'Help', color: '#fff', provider: 'local', model: 'default' })
    const conversationId = `direct-${agent.id}`
    const topicId = store.activeTopicId(conversationId)
    const add = (index: number) => store.addMessage({ conversationId, topicId, authorId: 'user', authorName: 'You', text: String(index), kind: 'message', createdAt: 1 })
    for (let i = 0; i < 125; i++) add(i)
    const latest = store.messagePage(conversationId, topicId)
    expect(latest.messages.map(m => Number(m.text))).toEqual(Array.from({ length: 50 }, (_, i) => i + 75))
    expect(latest.hasMore).toBe(true)
    add(125)
    const middle = store.messagePage(conversationId, topicId, latest.messages[0].id)
    const first = store.messagePage(conversationId, topicId, middle.messages[0].id)
    expect([...first.messages, ...middle.messages, ...latest.messages].map(m => Number(m.text))).toEqual(Array.from({ length: 125 }, (_, i) => i))
    expect(first.hasMore).toBe(false)
    expect(store.recentMessages().filter(m => m.conversationId === conversationId)).toHaveLength(51)
    expect(store.messagePage('missing', topicId).messages).toEqual([])
    expect(store.searchMessages(conversationId, '12').map(m => m.text)).toEqual(['125', '124', '123', '122', '121', '120', '112', '12'])
    expect(store.searchMessages('missing', '12')).toEqual([])
  })
})
