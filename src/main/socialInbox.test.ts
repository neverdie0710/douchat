import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DouchatStore } from './store'
import { DouchatRuntime } from './runtime'
import { SocialClient } from './social'
import type { DesktopAuth } from './desktopAuth'
import type { ComputerProvider } from './computer'
import type { SocialMessage, SocialRoom } from '../shared/social'

const directories: string[] = []
afterEach(() => { vi.unstubAllGlobals(); for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })
const room: SocialRoom = { id: 'dm', kind: 'direct', name: '', agents: [], createdAt: '2026-09-21T00:00:00Z',
  members: [{ id: 'alice', name: 'Alice', email: 'alice@example.com', image: 'alice.png' }, { id: 'bob', name: 'Bob', email: 'bob@example.com', image: 'bob.png' }] }
function account(id: string) {
  const directory = mkdtempSync(join(tmpdir(), 'friend-inbox-')); directories.push(directory)
  const path = join(directory, 'store.db')
  const store = new DouchatStore(path)
  store.setCurrentAccountId(id)
  const auth = { getState: () => ({ status: 'signed-in', user: { id } }), getAccessToken: () => id } as unknown as DesktopAuth
  const runtime = new DouchatRuntime(store, { sessions: [], snapshot: () => [] } as unknown as ComputerProvider, () => {})
  const client = new SocialClient('https://example.com', auth, store, runtime)
  runtime.setHumanSender((conversationId, text, images) => client.sendMessage(conversationId, text, images))
  return { store, runtime, client, path }
}
function server(messages: SocialMessage[] = []) {
  let failAfterDelivery = false
  const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => {
    const authorId = String((options?.headers as Record<string, string>).Authorization).slice(7)
    if (!options?.body) return Response.json({ data: { userId: authorId, friendships: [], rooms: [room] } })
    const body = JSON.parse(String(options.body))
    if (body.action === 'send') {
      if (!messages.some((message) => message.id === body.id)) messages.push({ ...body, authorId, authorName: authorId, status: 'sent', createdAt: new Date().toISOString() })
      if (failAfterDelivery) { failAfterDelivery = false; throw new Error('Connection lost after delivery') }
      return Response.json({ data: {} })
    }
    const before = body.before ? messages.findIndex((message) => message.id === body.before) : messages.length
    const history = messages.slice(0, before)
    return Response.json({ data: { messages: history.slice(-100), hasMore: history.length > 100 } })
  })
  vi.stubGlobal('fetch', fetcher)
  return { messages, fetcher, loseReceipt: () => { failAfterDelivery = true } }
}

it('delivers text and images into the other account’s standard inbox without touching a model', async () => {
  const remote = server()
  const alice = account('alice'), bob = account('bob')
  const connect = vi.spyOn(alice.runtime, 'connect')
  await alice.client.syncInbox(); await bob.client.syncInbox()
  const aliceId = alice.store.accountConversations[0].id, bobId = bob.store.accountConversations[0].id
  await alice.runtime.sendMessage(aliceId, 'Hello Bob')
  await bob.client.syncInbox()
  expect(connect).not.toHaveBeenCalled()
  expect(bob.store.conversation(bobId)).toMatchObject({ unread: 1, person: { name: 'Alice', image: 'alice.png' } })
  expect(bob.store.messagePage(bobId, 'main').messages[0]).toMatchObject({ text: 'Hello Bob', authorId: 'alice' })
  bob.store.markConversationRead(bobId)
  bob.store.setConversationPinned(bobId, true)
  bob.store.updateConversation(bobId, { muted: true })
  await bob.client.syncInbox()
  expect(bob.store.conversation(bobId)).toMatchObject({ unread: 0, pinned: true, muted: true })
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64'))
  await alice.runtime.sendMessage(aliceId, '', [{ name: 'pixel.png', mimeType: 'image/png', data: png }])
  await bob.client.syncInbox()
  const attachment = bob.store.topicMessages(bobId, 'main').at(-1)!.attachments![0]
  expect(await bob.store.attachmentDataUrl(attachment.id)).toBe('data:image/png;base64,' + Buffer.from(png).toString('base64'))
  expect(remote.messages).toHaveLength(2)
  expect(connect).not.toHaveBeenCalled()
  const reopened = new DouchatStore(bob.path)
  expect(reopened.accountConversations[0]).toMatchObject({ pinned: true, muted: true })
  reopened.setCurrentAccountId('outsider')
  expect(reopened.accountConversations).toEqual([])
})

it('retries an uncertain send without duplicates and never resurrects cleared or deleted history', async () => {
  const remote = server()
  const alice = account('alice')
  await alice.client.syncInbox()
  const id = alice.store.accountConversations[0].id
  remote.loseReceipt()
  await expect(alice.runtime.sendMessage(id, 'Once')).rejects.toThrow('Connection lost')
  await alice.runtime.sendMessage(id, 'Once')
  expect(remote.messages).toHaveLength(1)
  alice.store.clearConversation(id, 'main')
  await alice.client.syncInbox()
  expect(alice.store.topicMessages(id, 'main')).toEqual([])
  alice.store.deleteConversation(id)
  await alice.client.syncInbox()
  expect(alice.store.conversation(id)?.hidden).toBe(true)
  remote.messages.push({ id: 'new', roomId: 'dm', authorId: 'bob', authorName: 'Bob', content: 'New message',
    status: 'sent', createdAt: new Date(Date.now() + 1000).toISOString() })
  await alice.client.syncInbox()
  expect(alice.store.conversation(id)).toMatchObject({ hidden: false, unread: 1 })
  expect(alice.store.searchMessages(id, 'new')).toHaveLength(1)
  expect(alice.store.topicMessages(id, 'main')).toHaveLength(1)
})

it('imports more than a page once, keeps chronological history and uses account-specific local IDs', async () => {
  const messages: SocialMessage[] = Array.from({ length: 205 }, (_, index) => ({
    id: String(index), roomId: 'dm', authorId: 'bob', authorName: 'Bob', content: 'Message ' + index, status: 'sent',
    createdAt: new Date(Date.parse(room.createdAt) + index).toISOString()
  }))
  const remote = server(messages)
  const alice = account('alice')
  await alice.client.syncInbox()
  const id = alice.store.accountConversations[0].id
  expect(alice.store.topicMessages(id, 'main')).toHaveLength(205)
  const page = alice.store.messagePage(id, 'main')
  expect(page.hasMore).toBe(true)
  expect(page.messages.at(-1)?.text).toBe('Message 204')
  expect(alice.store.messagePage(id, 'main', page.messages[0].id).messages.at(-1)?.text).toBe('Message 154')
  remote.fetcher.mockClear()
  await alice.client.syncInbox()
  expect(remote.fetcher).toHaveBeenCalledTimes(2)
  expect(alice.store.topicMessages(id, 'main')).toHaveLength(205)
  alice.store.setCurrentAccountId('bob')
  const own = alice.store.syncFriendConversation('bob', room, messages)
  expect(own.id).not.toBe(id)
  expect(alice.store.accountConversations).toHaveLength(1)
  expect(alice.store.topicMessages(own.id, 'main')[0].authorId).toBe('user')
})

it('waits for a fresh room list when a friend chat is created during an older inbox poll', async () => {
  const alice = account('alice')
  let releaseOld!: () => void
  let roomCreated = false
  let roomReads = 0
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, options?: RequestInit) => {
    if (!options?.body) {
      roomReads++
      if (roomReads === 1) {
        await new Promise<void>((resolve) => { releaseOld = resolve })
        return Response.json({ data: { userId: 'alice', rooms: [], friendships: [] } })
      }
      return Response.json({ data: { userId: 'alice', rooms: roomCreated ? [room] : [], friendships: [] } })
    }
    const body = JSON.parse(String(options.body))
    if (body.action === 'create-room') {
      roomCreated = true
      return Response.json({ data: { roomId: room.id } })
    }
    return Response.json({ data: { messages: [], hasMore: false } })
  }))
  const oldPoll = alice.client.syncInbox()
  await vi.waitFor(() => expect(roomReads).toBe(1))
  let opened = false
  const opening = alice.client.action({ action: 'create-room', kind: 'direct', friendIds: ['bob'] }).then((result) => {
    opened = true
    return result
  })
  await vi.waitFor(() => expect(roomCreated).toBe(true))
  expect(opened).toBe(false)
  releaseOld()
  await oldPoll
  const result = await opening
  expect(roomReads).toBe(2)
  expect(result.conversationId).toBe('friend:alice:dm')
  expect(alice.store.conversation(result.conversationId!)).toMatchObject({ person: { id: 'bob' }, remoteRoomId: 'dm' })
})

 it('routes ordinary shared group messages to an owned agent, never a peer agent', async () => {
  const remote = server()
  const alice = account('alice')
  const shared: SocialRoom = { ...room, id: 'shared-room', kind: 'group', agents: [
    { id: 'peer-agent', localId: 'peer', ownerId: 'bob', name: 'Peer' },
    { id: 'own-agent', localId: 'own', ownerId: 'alice', name: 'My agent' }
  ] }
  const chat = alice.store.syncFriendConversation('alice', shared, [])!
  await alice.client.sendMessage(chat.id, '大家好')
  expect(remote.messages.at(-1)?.agentId).toBe('own-agent')
  await alice.client.sendMessage(chat.id, '@Bob hello')
  expect(remote.messages.at(-1)?.agentId).toBeUndefined()
  await expect(alice.client.sendMessage(chat.id, '@Peer work')).rejects.toThrow('调用权限尚未同步')
  expect(remote.messages).toHaveLength(2)
})

it('broadcasts a roll call to every owned agent and renders only one human message', async () => {
  const remote = server()
  const alice = account('alice')
  const shared: SocialRoom = { ...room, id: 'roll-call', kind: 'group', agents: [
    { id: 'one', localId: 'one', ownerId: 'alice', name: 'One' },
    { id: 'two', localId: 'two', ownerId: 'alice', name: 'Two' },
    { id: 'peer', localId: 'peer', ownerId: 'bob', name: 'Peer' }
  ] }
  const chat = alice.store.syncFriendConversation('alice', shared, [])!
  await alice.client.sendMessage(chat.id, '@all 报个数')
  const send = remote.fetcher.mock.calls.map(([, options]) => options?.body ? JSON.parse(String(options.body)) : {}).find((body) => body.action === 'send')
  expect(send.agentIds).toEqual(['one', 'two'])
  const base: SocialMessage = { id: send.id, roomId: shared.id, authorId: 'alice', authorName: 'Alice', content: '@all 报个数', status: 'succeeded', agentId: 'one', reply: 'One here', createdAt: new Date().toISOString() }
  const batch = [base, { ...base, id: 'child', parentMessageId: send.id, agentId: 'two', reply: 'Two here' }]
  alice.store.syncFriendConversation('alice', shared, batch)
  alice.store.syncFriendConversation('alice', shared, batch)
  expect(alice.store.topicMessages(chat.id, 'main').map((message) => message.text)).toEqual(['@all 报个数', 'One here', 'Two here'])
})

it('syncs a shared group after its last other human is removed', async () => {
  const alice = account('alice')
  const shared: SocialRoom = { ...room, id: 'remaining-group', kind: 'group', name: 'Team', agents: [{ id: 'own', localId: 'own', ownerId: 'alice', name: 'Own' }] }
  const previous = alice.store.syncFriendConversation('alice', shared, [])
  const next = alice.store.syncFriendConversation('alice', { ...shared, members: [shared.members[0]] }, [])
  expect(next.id).toBe(previous.id)
  expect(next.name).toBe('Team')
  expect(next.agentIds).toEqual(['own'])
  expect(next.socialRoom?.members.map((member) => member.id)).toEqual(['alice'])
  expect(next.person).toBeUndefined()
})

it('refreshes existing owned agent avatars without republishing unchanged or peer profiles', async () => {
  const alice = account('alice')
  const agent = alice.store.createAgent({ name: 'Cat', role: 'Assistant', instructions: '', color: '#112233', provider: 'openai', model: 'test', avatarEmoji: '🐱' })
  const shared: SocialRoom = { ...room, id: 'avatar-room', kind: 'group', agents: [
    { id: 'owned', localId: agent.id, ownerId: 'alice', name: 'Cat' },
    { id: 'peer', localId: agent.id, ownerId: 'bob', name: 'Other Cat', avatarEmoji: '🐶' }
  ] }
  const updates: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, options?: RequestInit) => {
    if (!options?.body) return Response.json({ data: { userId: 'alice', friendships: [], rooms: [shared] } })
    const body = JSON.parse(String(options.body))
    if (body.action === 'update-agent') {
      updates.push(body)
      Object.assign(shared.agents[0], body)
      return Response.json({ data: { agent: shared.agents[0] } })
    }
    return Response.json({ data: { messages: [] } })
  }))
  await alice.client.syncInbox()
  await alice.client.syncInbox()
  expect(updates).toHaveLength(1)
  expect(updates[0]).toMatchObject({ localId: agent.id, avatarEmoji: '🐱', avatarSeed: agent.avatarSeed })
  const synced = alice.store.accountConversations.find((item) => item.remoteRoomId === shared.id)!
  expect(synced.socialRoom?.agents[0].avatarEmoji).toBe('🐱')
  expect(synced.socialRoom?.agents[1].avatarEmoji).toBe('🐶')
})

it('syncs generated reply images even when the task message was already cached', async () => {
  const task: SocialMessage = { id: 'image-task', roomId: room.id, authorId: 'alice', authorName: 'Alice', content: 'Draw a car', agentId: 'artist', agentName: 'Artist', status: 'running', createdAt: '2026-09-21T01:00:00Z' }
  server([task])
  const bob = account('bob')
  await bob.client.syncInbox()
  task.status = 'succeeded'
  task.reply = ''
  task.replyImages = [{ name: 'car.png', mimeType: 'image/png', base64: 'iVBORw0KGgo=' }]
  await bob.client.syncInbox()
  const conversation = bob.store.accountConversations[0]
  const reply = bob.store.topicMessages(conversation.id, conversation.activeTopicId).find((message) => message.authorId === 'artist')!
  expect(reply.attachments).toHaveLength(1)
  expect(await bob.store.attachmentDataUrl(reply.attachments![0].id)).toBe('data:image/png;base64,iVBORw0KGgo=')
  await bob.client.syncInbox()
  const again = bob.store.topicMessages(conversation.id, conversation.activeTopicId).find((message) => message.authorId === 'artist')!
  expect(again.attachments).toEqual(reply.attachments)
})

it('shows a sending bubble before a slow request resolves and reconciles it without duplicates', async () => {
  const remote = server()
  const alice = account('alice')
  await alice.client.syncInbox()
  const id = alice.store.accountConversations[0].id
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const original = remote.fetcher.getMockImplementation()!
  remote.fetcher.mockImplementation(async (url, options) => {
    if (options?.body && JSON.parse(String(options.body)).action === 'send') await gate
    return original(url, options)
  })
  const pending = alice.client.sendMessage(id, 'Immediate')
  await vi.waitFor(() => expect(alice.store.topicMessages(id, 'main')).toHaveLength(1))
  expect(alice.store.topicMessages(id, 'main')[0]).toMatchObject({ text: 'Immediate', deliveryState: 'sending' })
  expect(remote.messages).toHaveLength(0)
  release()
  await pending
  await alice.client.syncInbox()
  expect(alice.store.topicMessages(id, 'main')).toHaveLength(1)
  expect(alice.store.topicMessages(id, 'main')[0].deliveryState).toBeUndefined()
})

it('uses incremental cursors, skips unchanged rooms and still fetches old task completions', async () => {
  const alice = account('alice')
  let revision = 'one'
  const task: SocialMessage = { id: 'old-task', roomId: room.id, authorId: 'alice', authorName: 'Alice', content: 'Work', agentId: 'agent', status: 'pending', createdAt: '2026-09-21T01:00:00Z' }
  const later: SocialMessage = { ...task, id: 'later', agentId: undefined, status: 'sent', content: 'Hi', createdAt: '2026-09-21T02:00:00Z' }
  const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => {
    if (!options?.body) return Response.json({ data: { userId: 'alice', syncVersion: 1, friendships: [], rooms: [{ ...room, revision }] } })
    const body = JSON.parse(String(options.body))
    if (body.after) return Response.json({ data: { messages: [], updates: [{ ...task, status: 'succeeded', reply: 'Done' }], hasMore: false } })
    return Response.json({ data: { messages: [task, later], hasMore: false } })
  })
  vi.stubGlobal('fetch', fetcher)
  await alice.client.syncInbox()
  fetcher.mockClear()
  await alice.client.syncInbox()
  expect(fetcher).toHaveBeenCalledTimes(1)
  revision = 'two'
  await alice.client.syncInbox()
  const body = JSON.parse(String(fetcher.mock.calls.at(-1)![1]!.body))
  expect(body.after).toEqual({ time: '2026-09-21T01:59:55.000Z', id: '' })
  expect(body.pending).toEqual(['old-task'])
  const chat = alice.store.accountConversations[0]
  expect(alice.store.topicMessages(chat.id, 'main').map((message) => message.text)).toContain('Done')
})

it('refreshes a fast room without waiting for a slow room', async () => {
  const alice = account('alice')
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, options?: RequestInit) => {
    if (!options?.body) return Response.json({ data: { userId: 'alice', rooms: [{ ...room, id: 'slow' }, { ...room, id: 'fast' }], friendships: [] } })
    const body = JSON.parse(String(options.body))
    if (body.roomId === 'slow') await gate
    return Response.json({ data: { messages: [{ id: body.roomId, roomId: body.roomId, authorId: 'bob', authorName: 'Bob', content: 'Hello', status: 'sent', createdAt: room.createdAt }], hasMore: false } })
  }))
  const pending = alice.client.syncInbox()
  await vi.waitFor(() => expect(alice.store.accountConversations.some((chat) => chat.remoteRoomId === 'fast')).toBe(true))
  expect(alice.store.accountConversations.some((chat) => chat.remoteRoomId === 'slow')).toBe(false)
  release()
  await pending
})

it('opens an authenticated change notification request and aborts it on stop', async () => {
  const alice = account('alice')
  let notificationSignal: AbortSignal | undefined
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, options?: RequestInit) => {
    if (!options?.body) return Response.json({ data: { userId: 'alice', syncVersion: 1, rooms: [{ ...room, revision: 'r1' }], friendships: [] } })
    const body = JSON.parse(String(options.body))
    if (body.action === 'watch') {
      expect(body.versions).toEqual({ [room.id]: 'r1' })
      expect((options.headers as Record<string, string>).Authorization).toBe('Bearer alice')
      notificationSignal = options.signal as AbortSignal
      return new Promise<Response>((_resolve, reject) => notificationSignal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    }
    return Response.json({ data: { messages: [], tasks: [], hasMore: false } })
  }))
  alice.client.start()
  try {
    await vi.waitFor(() => expect(notificationSignal).toBeDefined())
  } finally { alice.client.stop() }
  expect(notificationSignal!.aborted).toBe(true)
})

it('applies bundled notification messages without another metadata or message request', async () => {
  const alice = account('alice')
  const snapshot = { userId: 'alice', syncVersion: 1, rooms: [{ ...room, revision: 'one' }], friendships: [] }
  const first: SocialMessage = { id: 'first', roomId: room.id, authorId: 'bob', authorName: 'Bob', content: 'First', status: 'sent', createdAt: '2026-09-21T01:00:00.000Z' }
  const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => options?.body
    ? Response.json({ data: { messages: [first], hasMore: false } })
    : Response.json({ data: snapshot }))
  vi.stubGlobal('fetch', fetcher)
  await alice.client.syncInbox()
  fetcher.mockClear()
  const next = { ...first, id: 'next', content: 'Instant', createdAt: '2026-09-21T01:00:01.000Z' }
  await alice.client.syncInbox(false, {
    snapshot: { ...snapshot, rooms: [{ ...room, revision: 'two' }] },
    pages: { [room.id]: { after: { time: '2026-09-21T00:59:55.000Z', id: '' }, pending: [], messages: [first, next], hasMore: false } }
  })
  expect(fetcher).not.toHaveBeenCalled()
  const chat = alice.store.accountConversations[0]
  expect(alice.store.topicMessages(chat.id, 'main').map((message) => message.text)).toEqual(['First', 'Instant'])
})
