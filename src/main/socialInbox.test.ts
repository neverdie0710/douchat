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
  await expect(alice.client.sendMessage(chat.id, '@Peer work')).rejects.toThrow('只能指挥自己的')
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
  const base: SocialMessage = { id: 'root', roomId: shared.id, authorId: 'alice', authorName: 'Alice', content: '大家报个数', status: 'succeeded', agentId: 'one', reply: 'One here', createdAt: new Date().toISOString() }
  const batch = [base, { ...base, id: 'child', parentMessageId: 'root', agentId: 'two', reply: 'Two here' }]
  alice.store.syncFriendConversation('alice', shared, batch)
  alice.store.syncFriendConversation('alice', shared, batch)
  expect(alice.store.topicMessages(chat.id, 'main').map((message) => message.text)).toEqual(['大家报个数', 'One here', 'Two here'])
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
