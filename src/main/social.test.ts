import { afterEach, describe, expect, it, vi } from 'vitest'
import { SocialClient } from './social'
import type { DesktopAuth } from './desktopAuth'
import type { DouchatStore } from './store'
import type { DouchatRuntime } from './runtime'

function setup() {
  let userId = 'alice'
  const auth = { getState: () => ({ status: 'signed-in', user: { id: userId } }), getAccessToken: () => `token-${userId}`, invalidateSession: vi.fn() } as unknown as DesktopAuth
  const store = { agents: [{ id: 'local', ownerId: 'alice' }], socialTaskOutbox: () => [], saveSocialTaskResult: vi.fn(), removeSocialTaskResult: vi.fn(), claimSocialAgent: vi.fn(() => ({ id: 'local', name: 'Owned agent', ownerId: 'alice' })), agent: vi.fn(() => ({ ownerId: 'alice' })) } as unknown as DouchatStore
  const runtime = { executeSocialTask: vi.fn(async () => 'Done') } as unknown as DouchatRuntime
  const client = new SocialClient('https://example.com', auth, store, runtime)
  return { client, store, runtime, switchAccount: () => { userId = 'bob' } }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('social IPC and task execution', () => {
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
  it('refuses a claimed task whose author is not the owner', async () => {
    const { client, runtime } = setup()
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      if (!options?.body) return new Response(JSON.stringify({ data: { userId: 'alice', rooms: [], friendships: [] } }))
      const body = JSON.parse(options.body)
      const data = body.action === 'tasks' ? { tasks: [{ id: 'task', localId: 'local' }] } : body.action === 'claim' ? { task: { id: 'task', claim: 'secret', ownerId: 'alice', authorId: 'bob', agent: { localId: 'local', ownerId: 'alice' }, content: 'run' } } : {}
      return new Response(JSON.stringify({ data }))
    }))
    client.start()
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4))
    client.stop()
    expect(runtime.executeSocialTask).not.toHaveBeenCalled()
    const completed = JSON.parse(vi.mocked(fetch).mock.calls[3]![1]!.body as string)
    expect(completed.failed).toBe(true)
  })
  it('leaves tasks on another device queued', async () => {
    const { client, store, runtime } = setup()
    vi.mocked(store.agent).mockReturnValue(undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { tasks: [{ id: 'task', localId: 'remote' }] } }))))
    client.start()
    await vi.waitFor(() => expect(store.agent).toHaveBeenCalled())
    client.stop()
    expect(fetch).toHaveBeenCalledTimes(2)
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
