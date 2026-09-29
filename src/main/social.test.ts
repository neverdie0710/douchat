import { afterEach, describe, expect, it, vi } from 'vitest'
import { privacySafeSocialSnapshot, SocialClient } from './social'
import type { DesktopAuth } from './desktopAuth'
import type { DouchatStore } from './store'
import type { DouchatRuntime } from './runtime'

function setup() {
  let userId = 'alice'
  const auth = { getState: () => ({ status: 'signed-in', user: { id: userId } }), getAccessToken: () => `token-${userId}`, invalidateSession: vi.fn() } as unknown as DesktopAuth
  const store = { agents: [{ id: 'local', ownerId: 'alice' }], socialTaskOutbox: () => [], saveSocialTaskResult: vi.fn(), removeSocialTaskResult: vi.fn(), claimSocialAgent: vi.fn(() => ({ id: 'local', name: 'Owned agent', ownerId: 'alice' })), agent: vi.fn(() => ({ ownerId: 'alice' })) } as unknown as DouchatStore
  const runtime = { snapshot: () => ({ permissionRequests: [] }), executeSocialTask: vi.fn(async () => ({ text: 'Done' })) } as unknown as DouchatRuntime
  const client = new SocialClient('https://example.com', auth, store, runtime)
  return { client, store, runtime, switchAccount: () => { userId = 'bob' } }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('social IPC and task execution', () => {
  it('creates invite URLs on the configured origin and promotes local groups before sharing', async () => {
    const { client, store } = setup()
    const conversation = { id: 'local-group', type: 'group', name: 'Team', agentIds: [] as string[], remoteRoomId: undefined as string | undefined }
    Object.defineProperty(store, 'accountConversations', { value: [conversation] })
    vi.spyOn(client as any, 'refreshRoom').mockResolvedValue(undefined)
    vi.spyOn(client, 'syncInbox').mockResolvedValue({ userId: 'alice', friendships: [], rooms: [] })
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
    expect((client as any).refreshRoom).toHaveBeenCalledWith('shared-room')
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
    await expect(client.action({ action: 'claim', id: 'task' } as never)).rejects.toThrow('Unsupported')
    expect(fetcher).not.toHaveBeenCalled()
    await client.action({ action: 'add-agent', roomId: 'room', localId: 'local', name: 'Spoofed' } as never)
    expect(store.claimSocialAgent).toHaveBeenCalledWith('local', 'alice')
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).name).toBe('Owned agent')
  })
  it('discards requests that complete after account switching', async () => {
    const { client, switchAccount } = setup()
    vi.stubGlobal('fetch', vi.fn(async () => { switchAccount(); return new Response(JSON.stringify({ data: { userId: 'alice' } })) }))
    await expect(client.snapshot()).rejects.toThrow('account changed')
  })
  it('passes an authenticated external requester to the runtime permission boundary', async () => {
    const { client, runtime } = setup()
    const images = [{ name: 'photo.png', mimeType: 'image/png', base64: 'iVBORw0KGgo=' }]
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      if (!options?.body) return new Response(JSON.stringify({ data: { userId: 'alice', rooms: [], friendships: [] } }))
      const body = JSON.parse(options.body)
      const data = body.action === 'tasks' ? { tasks: [{ id: 'task', localId: 'local' }] } : body.action === 'claim' ? { task: { id: 'task', claim: 'secret', ownerId: 'alice', authorId: 'bob', agent: { localId: 'local', ownerId: 'alice' }, content: 'run', images } } : {}
      return new Response(JSON.stringify({ data }))
    }))
    client.start()
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(5))
    client.stop()
    expect(runtime.executeSocialTask).toHaveBeenCalledWith('alice', 'local', 'task', 'run', expect.any(AbortSignal), undefined, expect.objectContaining({ requesterId: 'bob' }), images, undefined)
    const completed = JSON.parse(vi.mocked(fetch).mock.calls.find((call) => call[1]?.body && JSON.parse(call[1].body as string).action === 'complete')![1]!.body as string)
    expect(completed.failed).toBe(false)
  })
  it('executes shared tasks concurrently and does not publish crash placeholders for active work', async () => {
    vi.useFakeTimers()
    const { client, store, runtime } = setup()
    const release = new Map<string, () => void>()
    const outbox = new Map<string, any>()
    Object.assign(store, { socialTaskOutbox: () => [...outbox.values()] })
    vi.mocked(store.saveSocialTaskResult).mockImplementation(result => { outbox.set(result.id, result) })
    vi.mocked(store.removeSocialTaskResult).mockImplementation(id => { outbox.delete(id) })
    vi.mocked(runtime.executeSocialTask).mockImplementation(async (_owner, _agent, id) => {
      await new Promise<void>(resolve => release.set(id, resolve))
      return { text: id }
    })
    Object.assign(runtime, { snapshot: () => ({ permissionRequests: [] }) })
    vi.spyOn(client, 'syncInbox').mockResolvedValue({ userId: 'alice', rooms: [], friendships: [] })
    const completed: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body)
      if (body.action === 'complete') completed.push(body)
      const data = body.action === 'tasks' ? { tasks: ['one', 'two'].map(id => ({ id, localId: 'local' })) }
        : body.action === 'claim' ? { task: { id: body.id, claim: 'secret', ownerId: 'alice', authorId: 'alice', agent: { localId: 'local', ownerId: 'alice' }, content: 'run' } } : {}
      return Response.json({ data })
    }))
    try {
      client.start()
      await vi.waitFor(() => expect(release.size).toBe(2))
      await vi.advanceTimersByTimeAsync(2600)
      expect(runtime.executeSocialTask).toHaveBeenCalledTimes(2)
      expect(completed).toEqual([])
      release.get('two')!()
      await vi.waitFor(() => expect(completed.map(item => item.id)).toEqual(['two']))
      expect(completed[0].failed).toBe(false)
      release.get('one')!()
      await vi.waitFor(() => expect(completed.map(item => item.id)).toEqual(['two', 'one']))
      expect(outbox.size).toBe(0)
    } finally { release.forEach(resolve => resolve()); client.stop() }
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

describe('shared-group explicit response policy', () => {
  const agents = [{ id: 'dong', localId: 'd', ownerId: 'alice', name: '东子' }, { id: 'ge', localId: 'g', ownerId: 'bob', name: '哥飞' }]
  const humans = [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }]
  it.each(['你好', '回答你刚才的问题', 'Yes, I will do that.', '¿Puedes ayudarme?', '手伝ってください', '@Bob hello', '> @哥飞 please help\nI agree', '`@东子`', '```\n@哥飞\n```'])('does not infer agent authorization from human conversation: %s', async content => {
    const { sharedGroupReplyTargets } = await import('./social')
    expect(sharedGroupReplyTargets(content, agents, humans)).toEqual([])
  })
  it('selects only named agents across owners, including mixed human and agent recipients', async () => {
    const { sharedGroupReplyTargets } = await import('./social')
    expect(sharedGroupReplyTargets('@Bob @哥飞 help @东子', agents, humans)).toEqual(['ge', 'dong'])
    expect(sharedGroupReplyTargets('@all @东子 help', agents, humans, 'alice')).toEqual(['dong'])
    expect(sharedGroupReplyTargets('@东子 @东子', agents, humans)).toEqual(['dong'])
  })
  it('routes selected duplicate names by ID and never falls back when that member leaves', async () => {
    const { sharedGroupReplyTargets } = await import('./social')
    const same = agents.map(agent => ({ ...agent, name: 'Dr. Dou' }))
    const selected = [{ id: 'ge', name: 'Dr. Dou', start: 0, end: 8 }]
    expect(sharedGroupReplyTargets('@Dr. Dou help', same, humans, 'alice', selected)).toEqual(['ge'])
    expect(() => sharedGroupReplyTargets('@Dr. Dou help', [same[0]], humans, 'alice', selected)).toThrow('no longer')
    expect(sharedGroupReplyTargets('@Dr. Dou help', same, [{ id: 'human', name: 'Dr. Dou' }], 'alice', [{ ...selected[0], id: 'human' }])).toEqual([])
  })
  it('rejects ambiguous names rather than invoking the wrong owner’s agent', async () => {
    const { sharedGroupReplyTargets } = await import('./social')
    expect(() => sharedGroupReplyTargets('@东子 help', [...agents, { ...agents[1], name: '东子' }], humans)).toThrow('multiple members')
    expect(() => sharedGroupReplyTargets('@Alice help', [{ ...agents[0], name: 'Ａｌｉｃｅ' }], humans)).toThrow('multiple members')
  })
  it('limits all aliases to the group owner and respects other owners’ permissions', async () => {
    const { sharedGroupReplyTargets } = await import('./social')
    const participants = [...agents, { ...agents[1], id: 'ask', interactionHumans: 'ask' as const },
      { ...agents[1], id: 'allow', interactionHumans: 'allow' as const },
      { ...agents[1], id: 'deny', interactionHumans: 'deny' as const }]
    for (const content of ['@all 报数', '@everyone hello', '@全体成员 报数', '＠ａｌｌ 报数']) {
      expect(sharedGroupReplyTargets(content, participants, humans, 'alice')).toEqual(['dong', 'ask', 'allow'])
      expect(() => sharedGroupReplyTargets(content, participants, humans, 'bob')).toThrow('Only the group owner')
    }
    for (const content of ['> @all 报数\n引用', '`@all`', '```\n@all\n```', 'email@all.com']) {
      expect(sharedGroupReplyTargets(content, participants, humans, 'bob')).toEqual([])
    }
  })
})
