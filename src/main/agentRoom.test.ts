import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DouchatStore } from './store'
import { DouchatRuntime } from './runtime'
import { agentRoomAgentId, rendererSocialSnapshot, SocialClient } from './social'
import type { DesktopAuth } from './desktopAuth'
import type { ComputerProvider } from './computer'
import type { SocialRoom } from '../shared/social'
import type { RemoteExecutionBridge } from './remote/daemonClient'

const directories: string[] = []
afterEach(() => { vi.unstubAllGlobals(); for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'agent-room-')); directories.push(directory)
  const store = new DouchatStore(join(directory, 'store.db'))
  store.setCurrentAccountId('alice')
  const auth = { getState: () => ({ status: 'signed-in', user: { id: 'alice' } }), getAccessToken: () => 'alice' } as unknown as DesktopAuth
  const runtime = new DouchatRuntime(store, { sessions: [], snapshot: () => [], snapshots: () => [] } as unknown as ComputerProvider, () => {})
  const client = new SocialClient('https://example.com', auth, store, runtime)
  const agent = store.createAgent({ name: 'Codex', role: 'Assistant', instructions: '', color: '#123456', provider: 'local', model: 'default' })
  const direct = store.accountConversations.find(item => item.type === 'direct' && item.agentIds[0] === agent.id)!
  const roomAgentId = agentRoomAgentId('alice', agent.id)
  const room: SocialRoom = { id: 'dm-agent-x', kind: 'agent', name: 'Codex', createdAt: '2026-10-01T00:00:00Z',
    members: [{ id: 'alice', name: 'Alice', email: '' }], agents: [{ id: roomAgentId, localId: agent.id, ownerId: 'alice', name: 'Codex' }] }
  return { store, runtime, client, agent, direct, room, roomAgentId }
}

it('keeps a daemon agent in its own direct chat and maps replies to the local agent', () => {
  const { store, agent, direct, room, roomAgentId } = setup()
  const synced = store.syncFriendConversation('alice', room, [{ id: 'm1', roomId: room.id, authorId: 'alice', authorName: 'Alice', content: 'hi', status: 'succeeded',
    agentId: roomAgentId, agentName: 'Codex', reply: 'hello', createdAt: '2026-10-01T00:00:01Z' }])
  expect(synced.id).toBe(direct.id)
  expect(synced).toMatchObject({ type: 'direct', remoteRoomId: room.id, agentIds: [agent.id], name: direct.name })
  expect(synced.person).toBeUndefined()
  const messages = store.topicMessages(direct.id, synced.activeTopicId)
  expect(messages.find(message => message.id === `${direct.id}:m1`)).toMatchObject({ authorId: 'user', socialTasks: [{ agentId: agent.id }] })
  expect(messages.find(message => message.id === `${direct.id}:m1:reply`)).toMatchObject({ authorId: agent.id, text: 'hello' })
})

it('does not create chats for agent rooms of agents on another computer', () => {
  const { store, room } = setup()
  expect(store.agentRoomConversation('alice', { ...room, agents: [{ ...room.agents[0], localId: 'missing' }] })).toBeUndefined()
  expect(() => store.syncFriendConversation('alice', { ...room, agents: [{ ...room.agents[0], localId: 'missing' }] }, [])).toThrow()
  expect(rendererSocialSnapshot({ userId: 'alice', friendships: [], rooms: [room] } as never).rooms).toEqual([])
})

it('links a daemon agent chat on first send and addresses its one agent', async () => {
  const { store, runtime, client, agent, direct, room, roomAgentId } = setup()
  const bridge: RemoteExecutionBridge = { activity: () => [], approvals: () => [], resolveApproval: async () => {}, cancelConversation: async () => 0, isDaemonAgent: id => id === agent.id }
  runtime.setHumanSender((id, text, images, files, mentions) => client.sendMessage(id, text, images, files, mentions))
  runtime.setRemoteBridge(bridge, id => client.ensureAgentRoom(id))
  client.setDaemonAgents(() => new Set([agent.id]))
  const requests: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, options?: RequestInit) => {
    if (!options?.body) return Response.json({ data: { userId: 'alice', friendships: [], rooms: [room] } })
    const body = JSON.parse(String(options.body))
    requests.push(body)
    if (body.action === 'create-room') return Response.json({ data: { roomId: room.id } })
    if (body.action === 'messages') return Response.json({ data: { messages: [] } })
    return Response.json({ data: {} })
  }))
  await runtime.sendMessage(direct.id, 'build it')
  expect(requests.find(item => item.action === 'create-room')).toMatchObject({ kind: 'agent', localId: agent.id, name: 'Codex' })
  expect(requests.find(item => item.action === 'send')).toMatchObject({ roomId: room.id, content: 'build it', agentIds: [roomAgentId], agentId: roomAgentId })
  expect(store.conversation(direct.id)?.remoteRoomId).toBe(room.id)
  client.stop()
})

it('routes remote approvals and stop to the daemon bridge', async () => {
  const { runtime, direct } = setup()
  const resolved: unknown[] = []
  const cancelled: string[] = []
  runtime.setRemoteBridge({ activity: () => [{ conversationId: direct.id, topicId: direct.activeTopicId, phase: 'replying', agentIds: direct.agentIds, label: 'Replying', startedAt: 1, remoteText: 'partial' }],
    approvals: () => [], resolveApproval: async (id, allow) => { resolved.push([id, allow]) }, cancelConversation: async id => { cancelled.push(id); return 1 }, isDaemonAgent: () => true }, async () => '')
  await runtime.resolveAgentPermission('remote:t:approval:1', 'task')
  expect(resolved).toEqual([['remote:t:approval:1', 'task']])
  runtime.stopConversation(direct.id)
  expect(cancelled).toEqual([direct.id])
  expect(runtime.snapshot().activity.find(item => item.conversationId === direct.id)?.remoteText).toBe('partial')
})
