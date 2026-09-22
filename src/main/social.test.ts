import { afterEach, describe, expect, it, vi } from 'vitest'
import { privacySafeSocialSnapshot, SocialClient } from './social'
import type { DesktopAuth } from './desktopAuth'
import type { DouchatStore } from './store'
import type { DouchatRuntime } from './runtime'

function setup() {
  let userId = 'alice'
  const auth = { getState: () => ({ status: 'signed-in', user: { id: userId } }), getAccessToken: () => `token-${userId}`, invalidateSession: vi.fn() } as unknown as DesktopAuth
  const store = { agents: [{ id: 'local', ownerId: 'alice' }], socialTaskOutbox: () => [], saveSocialTaskResult: vi.fn(), removeSocialTaskResult: vi.fn(), claimSocialAgent: vi.fn(() => ({ id: 'local', name: 'Owned agent', ownerId: 'alice' })), agent: vi.fn(() => ({ ownerId: 'alice' })) } as unknown as DouchatStore
  const runtime = { executeSocialTask: vi.fn(async () => ({ text: 'Done' })) } as unknown as DouchatRuntime
  const client = new SocialClient('https://example.com', auth, store, runtime)
  return { client, store, runtime, switchAccount: () => { userId = 'bob' } }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('social IPC and task execution', () => {
  it('creates invite URLs on the configured origin and promotes local groups before sharing', async () => {
    const { client, store } = setup()
    const conversation = { id: 'local-group', type: 'group', name: 'Team', agentIds: [] as string[], remoteRoomId: undefined as string | undefined }
    Object.defineProperty(store, 'accountConversations', { value: [conversation] })
    const promote = vi.spyOn(client, 'syncInbox').mockResolvedValue({ userId: 'alice', friendships: [], rooms: [] })
    Object.assign(store, { linkSharedGroup: (_id: string, roomId: string) => { conversation.remoteRoomId = roomId } })
    Object.assign((client as unknown as { runtime: object }).runtime, { snapshot: () => ({ activity: [] }) })
    const calls: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body); calls.push(body)
      const data = body.action === 'create-room' ? { roomId: 'shared-room' } : { invite: { roomId: 'shared-room', name: 'Team', token: 'a'.repeat(43), expiresAt: '2030-01-01T00:00:00Z', url: 'https://untrusted.example' } }
      return new Response(JSON.stringify({ data }))
    }))
    const result = await client.action({ action: 'group-invite', conversationId: conversation.id })
    expect(calls.map((body) => body.action)).toEqual(['create-room', 'group-invite'])
    expect(calls[0].friendIds).toEqual([])
    expect(result.invite?.url).toBe(`https://example.com/join-group?room=shared-room&token=${'a'.repeat(43)}`)
    expect(promote).toHaveBeenCalled()
  })

  it('keeps email addresses only for the signed-in user and accepted friends', () => {
    const snapshot = privacySafeSocialSnapshot({
      userId: 'alice',
      friendships: [
        { id: 'accepted', senderId: 'alice', recipientId: 'bob', status: 'accepted', person: { id: 'bob', name: 'Bob', email: 'bob@example.com' } },
        { id: 'pending', senderId: 'charlie', recipientId: 'alice', status: 'pending', person: { id: 'charlie', name: 'Charlie', email: 'charlie@example.com' } }
      ],
      rooms: [{
        id: 'room', name: 'Group', kind: 'group', agents: [], createdAt: '', members: [
          { id: 'alice', name: 'Alice', email: 'alice@example.com' },
          { id: 'bob', name: 'Bob', email: 'bob@example.com' },
          { id: 'charlie', name: 'Charlie', email: 'charlie@example.com' }
        ]
      }]
    })

    expect(snapshot.friendships.map((item) => item.person.email)).toEqual(['bob@example.com', ''])
    expect(snapshot.rooms[0].members.map((person) => person.email)).toEqual(['alice@example.com', 'bob@example.com', ''])
  })

  it('does not expose worker-only operations and uses trusted local agent names', async () => {
    const { client, store } = setup()
    const fetcher = vi.fn(async (_url: unknown, _options?: RequestInit) => new Response(JSON.stringify({ data: {} })))
    vi.stubGlobal('fetch', fetcher)
    await expect(client.action({ action: 'claim', id: 'task' } as never)).rejects.toThrow('不支持')
    expect(fetcher).not.toHaveBeenCalled()
    await client.action({ action: 'add-agent', roomId: 'room', localId: 'local', name: 'Spoofed' } as never)
    expect(store.claimSocialAgent).toHaveBeenCalledWith('local', 'alice')
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).name).toBe('Owned agent')
  })
  it('discards requests that complete after account switching', async () => {
    const { client, switchAccount } = setup()
    vi.stubGlobal('fetch', vi.fn(async () => { switchAccount(); return new Response(JSON.stringify({ data: { userId: 'alice' } })) }))
    await expect(client.snapshot()).rejects.toThrow('账号已切换')
  })
  it('passes an authenticated external requester to the runtime permission boundary', async () => {
    const { client, runtime } = setup()
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      if (!options?.body) return new Response(JSON.stringify({ data: { userId: 'alice', rooms: [], friendships: [] } }))
      const body = JSON.parse(options.body)
      const data = body.action === 'tasks' ? { tasks: [{ id: 'task', localId: 'local' }] } : body.action === 'claim' ? { task: { id: 'task', claim: 'secret', ownerId: 'alice', authorId: 'bob', agent: { localId: 'local', ownerId: 'alice' }, content: 'run' } } : {}
      return new Response(JSON.stringify({ data }))
    }))
    client.start()
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(5))
    client.stop()
    expect(runtime.executeSocialTask).toHaveBeenCalledWith('alice', 'local', 'task', 'run', expect.any(AbortSignal), undefined, expect.objectContaining({ requesterId: 'bob' }))
    const completed = JSON.parse(vi.mocked(fetch).mock.calls.find((call) => call[1]?.body && JSON.parse(call[1].body as string).action === 'complete')![1]!.body as string)
    expect(completed.failed).toBe(false)
  })
  it('leaves tasks on another device queued', async () => {
    const { client, store, runtime } = setup()
    vi.mocked(store.agent).mockReturnValue(undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { tasks: [{ id: 'task', localId: 'remote' }] } }))))
    client.start()
    await vi.waitFor(() => expect(store.agent).toHaveBeenCalled())
    client.stop()
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(runtime.executeSocialTask).not.toHaveBeenCalled()
  })
})

describe('shared-group continuity', () => {
  const agents = [{ id: 'dong', localId: 'd', ownerId: 'alice', name: '东子' }, { id: 'ge', localId: 'g', ownerId: 'alice', name: '哥飞' }]
  const message = (authorId: string, text: string) => ({ id: text, authorId, authorName: authorId, text, kind: 'message' as const, conversationId: 'g', topicId: 't', createdAt: 1 })
  it('continues the addressed exchange instead of broadcasting to owned agents', async () => {
    const { sharedGroupReplyTargets } = await import('./social')
    expect(sharedGroupReplyTargets('想画个小猫咪', agents, [message('user', '@哥飞 飞哥'), message('ge', '在呢，啥事？')])).toEqual(['ge'])
    expect(sharedGroupReplyTargets('@all 各讲个笑话', agents, [message('ge', '在呢')])).toEqual(['dong', 'ge'])
    expect(sharedGroupReplyTargets('你好', agents, [])).toEqual(['dong'])
    expect(sharedGroupReplyTargets('你好', agents, [message('bob', '@哥飞'), message('ge', '你好')])).toEqual(['dong'])
  })
})
