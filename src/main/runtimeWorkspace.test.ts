import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { groupMemberSessionId } from '../shared/bot/group'
import { runLocalAgent } from './localAgentRuntime'
import { DouchatRuntime } from './runtime'
import { DouchatStore } from './store'

vi.mock('./localAgentRuntime', async (original) => ({ ...await original<object>(), runLocalAgent: vi.fn() }))
vi.mock('./localWorkspaces', async (original) => {
  const actual = await original<typeof import('./localWorkspaces')>()
  return { ...actual, resolveSavedWorkspace: (path: string) => actual.resolveSavedWorkspace(path, { systemRoots: [] }) }
})
const directories: string[] = []
afterEach(() => { vi.clearAllMocks(); directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })) })

function setup() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'douchat-workspace-runtime-')))
  directories.push(directory)
  const project = join(directory, 'project')
  mkdirSync(project)
  const store = new DouchatStore(join(directory, 'state.json'))
  store.setCurrentAccountId('me')
  const runtime = new DouchatRuntime(store, { snapshots: () => [], start: vi.fn(), stop: vi.fn(), show: vi.fn(), createTools: () => [], dispose: vi.fn() }, () => undefined)
  const make = (name: string, localAgentId?: string) => store.createAgent({ name, role: 'Engineer', instructions: '', color: '#14B8A6', provider: localAgentId ? 'local' : 'gateway', model: 'default', ...(localAgentId ? { localAgentId } : {}) })
  const codex = make('Codex', 'codex'), claude = make('Claude', 'claude'), cloud = make('Cloud')
  store.createGroup({ name: 'Builders', agentIds: [codex.id, claude.id] })
  const group = store.accountConversations.find(item => item.type === 'group' && item.name === 'Builders')!
  const internal = runtime as any
  const run = (agentId: string, conversationId = group.id, sessionKey = groupMemberSessionId(conversationId, agentId, 'main'), extra: object = {}) =>
    internal.runReply({ config: store.agent(agentId)!, sessionKey, conversationId, topicId: 'main', context: 'group', prompt: 'Edit files', ...extra })
  return { store, runtime, group, project, codex, claude, cloud, run }
}

it('runs group members in the chosen folder one at a time', async () => {
  const { store, group, project, codex, claude, run } = setup()
  store.setConversationWorkspace(group.id, project)
  const started: string[] = [], release = new Map<string, () => void>()
  vi.mocked(runLocalAgent).mockImplementation(async (config, prompt, _signal, _images, options) => {
    expect(options?.workspaceDirectory).toBe(project)
    expect(prompt).toContain(project)
    started.push(config.id)
    await new Promise<void>(resolve => release.set(config.id, resolve))
    return { text: config.name, images: [] }
  })
  const first = run(codex.id), second = run(claude.id)
  await vi.waitFor(() => expect(started).toEqual([codex.id]))
  await new Promise(resolve => setTimeout(resolve, 30))
  expect(started).toEqual([codex.id])
  release.get(codex.id)!()
  expect((await first).text).toBe('Codex')
  await vi.waitFor(() => expect(started).toEqual([codex.id, claude.id]))
  release.get(claude.id)!()
  expect((await second).text).toBe('Claude')
})

it('a stopped waiter does not block the folder', async () => {
  const { runtime, store, group, project, codex, claude, run } = setup()
  store.setConversationWorkspace(group.id, project)
  const release = new Map<string, () => void>(), started: string[] = []
  vi.mocked(runLocalAgent).mockImplementation(async (config) => {
    started.push(config.id)
    await new Promise<void>(resolve => release.set(config.id, resolve))
    return { text: config.name, images: [] }
  })
  const first = run(codex.id)
  await vi.waitFor(() => expect(started).toEqual([codex.id]))
  const waiting = run(claude.id)
  await new Promise(resolve => setTimeout(resolve, 20))
  ;(runtime as any).pendingReplies.forEach((task: any) => { if (task.agentId === claude.id) task.abort.abort() })
  expect((await waiting).error).toBeTruthy()
  release.get(codex.id)!(); await first
  const again = run(claude.id)
  await vi.waitFor(() => expect(started).toEqual([codex.id, claude.id]))
  release.get(claude.id)!(); await again
})

it('falls back to the managed folder when the chat is no longer eligible, keeping the setting', async () => {
  const { store, group, project, codex, cloud, run } = setup()
  store.setConversationWorkspace(group.id, project)
  vi.mocked(runLocalAgent).mockResolvedValue({ text: 'ok', images: [] })
  store.updateConversation(group.id, { agentIds: [...group.agentIds, cloud.id] })
  await run(codex.id)
  expect(vi.mocked(runLocalAgent).mock.calls[0][4]?.workspaceDirectory).toBeUndefined()
  expect(store.conversation(group.id)?.workspacePath).toBe(project)
})

it('does not apply the folder to controllers, attendance checks or other chats', async () => {
  const { store, group, project, codex, run } = setup()
  store.setConversationWorkspace(group.id, project)
  vi.mocked(runLocalAgent).mockResolvedValue({ text: 'ok', images: [] })
  await run(codex.id, group.id, groupMemberSessionId(group.id, codex.id, 'main') + ':controller', { context: 'controller' })
  await run(codex.id, group.id, groupMemberSessionId(group.id, codex.id, 'main') + ':attendance', { toolsDisabled: true })
  await run(codex.id, `direct-${codex.id}`, `direct:direct-${codex.id}:main`, { context: 'direct' })
  await run(codex.id, group.id, `handoff:${group.id}:main:${codex.id}:caller`)
  for (const call of vi.mocked(runLocalAgent).mock.calls) expect(call[4]?.workspaceDirectory).toBeUndefined()
})

it('reports a missing folder instead of silently recreating it', async () => {
  const { store, group, project, codex, run } = setup()
  store.setConversationWorkspace(group.id, join(project, 'deleted'))
  const reply = await run(codex.id)
  expect(reply.error).toMatch(/unavailable/)
  expect(runLocalAgent).not.toHaveBeenCalled()
})

it('uses the folder for a direct chat with my local agent', async () => {
  const { store, runtime, project, codex } = setup()
  const { conversation } = store.ensureDirectConversation(codex.id)
  store.setConversationWorkspace(conversation.id, project)
  vi.mocked(runLocalAgent).mockResolvedValue({ text: 'ok', images: [] })
  await (runtime as any).runReply({ config: store.agent(codex.id)!, sessionKey: `direct:${conversation.id}:main`, conversationId: conversation.id, topicId: 'main', context: 'direct', prompt: 'hi' })
  expect(vi.mocked(runLocalAgent).mock.calls[0][4]?.workspaceDirectory).toBe(project)
})
