import { agentPermissions } from '../shared/agentPermissions'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { groupMemberSessionId } from '../shared/bot/group'
import { runLocalAgent } from './localAgentRuntime'
import { DouchatRuntime } from './runtime'
import { DouchatStore } from './store'
import { configureLocalWorkspaces, localExecutionTarget } from './localWorkspaces'

vi.mock('./localAgentRuntime', async (original) => ({ ...await original<object>(), runLocalAgent: vi.fn() }))
// Agents whose localAgentId starts with "custom:srv" run on a server in these tests.
const servers = vi.hoisted(() => new Map<string, { executionTargetId: string; targetRevision: number }>())
vi.mock('./localAgents', async (original) => {
  const actual = await original<typeof import('./localAgents')>()
  const spec = (host: string) => ({ transport: 'ssh' as const, host, adapter: 'codex' as const, executable: 'codex', args: [], allowSharing: true })
  return {
    ...actual,
    remoteAgentPlacement: async (id?: string) => id && servers.has(id) ? { spec: spec(id.slice(7)), target: servers.get(id)! } : undefined,
    remoteAgentSpec: async (id?: string) => id && servers.has(id) ? spec(id.slice(7)) : undefined,
    cachedRemoteAgentSpec: (id?: string) => id && servers.has(id) ? spec(id.slice(7)) : undefined
  }
})
vi.mock('./remote/sshTransport', async (original) => {
  const actual = await original<typeof import('./remote/sshTransport')>()
  return { ...actual, openSshTransport: async (spec: never) => ({ ...actual.sshTransport({ ...(spec as object), remotePath: '/usr/bin', remoteHome: '/home/me' } as never), openBridge: async () => undefined }) }
})
vi.mock('./remoteTransport', async (original) => ({ ...await original<object>(), probeRemoteAgent: async (input: object) => ({ ...input, remotePath: '/usr/bin', remoteHome: '/home/me' }) }))
vi.mock('./localWorkspaces', async (original) => {
  const actual = await original<typeof import('./localWorkspaces')>()
  return { ...actual, resolveSavedWorkspace: (path: string) => actual.resolveSavedWorkspace(path, { systemRoots: [] }) }
})
const directories: string[] = []
afterEach(() => { vi.clearAllMocks(); servers.clear(); configureLocalWorkspaces(); directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })) })

function setup() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'douchat-workspace-runtime-')))
  directories.push(directory)
  const project = join(directory, 'project')
  mkdirSync(project)
  configureLocalWorkspaces(join(directory, 'user-data'))
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

it('keeps the chosen folder when a cloud agent joins the private group', async () => {
  const { store, group, project, codex, cloud, run } = setup()
  store.setConversationWorkspace(group.id, project)
  vi.mocked(runLocalAgent).mockResolvedValue({ text: 'ok', images: [] })
  store.updateConversation(group.id, { agentIds: [...group.agentIds, cloud.id] })
  await run(codex.id)
  expect(vi.mocked(runLocalAgent).mock.calls[0][4]?.workspaceDirectory).toBe(project)
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

it('lets cloud agents read and write the selected folder while enforcing permissions and shared-room isolation', async () => {
  const { store, runtime, project, cloud } = setup()
  const { conversation } = store.ensureDirectConversation(cloud.id)
  store.setConversationWorkspace(conversation.id, project)
  const permissions = agentPermissions(); permissions.sensitive.filesRead = 'allow'; permissions.sensitive.filesWrite = 'allow'
  store.updateAgent(cloud.id, { permissions })
  const internal = runtime as any, session = `direct:${conversation.id}:test`
  internal.replyCancels.set(session, { conversationId: conversation.id, abort: new AbortController() })
  internal.activeConversation.set(session, conversation.id)
  const tools = internal.artifactTools(cloud.id, session)
  const write = tools.find((tool: any) => tool.name === 'write_workspace_file')
  await write.execute('write', { path: 'hello.md', content: '# Cloud workspace' })
  expect(readFileSync(join(project, 'hello.md'), 'utf8')).toBe('# Cloud workspace')
  expect(JSON.stringify(await tools.find((tool: any) => tool.name === 'read_workspace_file').execute('read', { path: 'hello.md' }))).toContain('Cloud workspace')
  permissions.sensitive.filesWrite = 'deny'; store.updateAgent(cloud.id, { permissions })
  await expect(write.execute('write', { path: 'denied.md', content: 'no' })).rejects.toThrow('disabled')
  internal.sharedCallers.set(session, { requesterId: 'another-person' })
  await expect(tools.find((tool: any) => tool.name === 'read_workspace_file').execute('read', { path: 'hello.md' })).rejects.toThrow('unavailable')
})


it('refreshes file roots from the active conversation and excludes shared tasks', () => {
  const { store, runtime, project, cloud } = setup()
  const { conversation } = store.ensureDirectConversation(cloud.id)
  const extra = join(project, 'assets'); mkdirSync(extra)
  store.setConversationWorkspace(conversation.id, project)
  store.setConversationAllowedFolders(conversation.id, [extra])
  const internal = runtime as any, session = `direct:${conversation.id}:main`
  internal.activeConversation.set(session, conversation.id)
  expect(internal.conversationFileRoots(cloud.id, session)).toEqual([])
  internal.replyCancels.set(session, { abort: new AbortController() })
  expect(internal.conversationFileRoots(cloud.id, session)).toEqual([extra, project])
  expect(internal.conversationFileRoots('other-agent', session)).toEqual([])
  store.setConversationAllowedFolders(conversation.id, [])
  expect(internal.conversationFileRoots(cloud.id, session)).toEqual([project])
  internal.sharedCallers.set(session, { requesterId: 'other-person' })
  expect(internal.conversationFileRoots(cloud.id, session)).toEqual([])
  internal.sharedCallers.delete(session)
  store.setCurrentAccountId('another-account')
  expect(internal.conversationFileRoots(cloud.id, session)).toEqual([])
})


it.each(['allow', 'decline', 'cancel', 'account-change'])('handles on-demand folder approval: %s', async decision => {
  const { store, runtime, project, cloud } = setup()
  const { conversation } = store.ensureDirectConversation(cloud.id)
  const internal = runtime as any, session = `direct:${conversation.id}:main`
  const abort = new AbortController()
  internal.activeConversation.set(session, conversation.id)
  internal.replyCancels.set(session, { conversationId: conversation.id, abort })
  const permissions = agentPermissions(); permissions.sensitive.filesRead = 'allow'
  store.updateAgent(cloud.id, { permissions })
  const pending = internal.requestConversationFolder(cloud.id, session, project, 'computer_list_files')
  const result = pending.then(() => 'allowed', () => 'denied')
  const request = runtime.snapshot().permissionRequests![0]
  expect(request).toBeDefined()
  expect(JSON.parse(request.details).folder).toBe(project)
  expect(store.conversation(conversation.id)?.allowedFolders).toBeUndefined()
  if (decision === 'cancel') abort.abort()
  else {
    runtime.resolveAgentPermission(request.id, decision !== 'decline')
    if (decision === 'account-change') store.setCurrentAccountId('another-account')
  }
  expect(await result).toBe(decision === 'allow' ? 'allowed' : 'denied')
  expect(store.conversation(conversation.id)?.allowedFolders ?? []).toEqual(decision === 'allow' ? [project] : [])
})

describe('per-member folders', () => {
  const server = { executionTargetId: 'ssh-legacy:box', targetRevision: 0 }
  const remoteMember = (store: DouchatStore) => {
    servers.set('custom:srvbox', server)
    return store.createAgent({ name: 'Server Codex', role: 'Engineer', instructions: '', color: '#14B8A6', provider: 'local', model: 'default', localAgentId: 'custom:srvbox' })
  }
  const options = (index = 0) => vi.mocked(runLocalAgent).mock.calls[index][4]!

  it('gives each member its own folder on its own target and never a local folder to a remote member', async () => {
    const { store, group, project, codex, claude, run } = setup()
    const srv = remoteMember(store)
    store.updateConversation(group.id, { agentIds: [codex.id, claude.id, srv.id] })
    store.setConversationWorkspace(group.id, project)
    const other = join(project, 'claude-only'); mkdirSync(other)
    store.setAgentWorkspace(group.id, claude.id, { path: other, ...localExecutionTarget() })
    store.setAgentWorkspace(group.id, srv.id, { path: '/home/me/proj', ...server })
    vi.mocked(runLocalAgent).mockResolvedValue({ text: 'ok', images: [] })
    await run(codex.id); await run(claude.id); await run(srv.id)
    expect(options(0)).toMatchObject({ workspaceDirectory: project, remoteWorkspace: undefined })
    expect(options(1)).toMatchObject({ workspaceDirectory: other, remoteWorkspace: undefined })
    expect(options(2).workspaceDirectory).toBeUndefined()
    expect(options(2).remoteWorkspace).toEqual({ path: '/home/me/proj', ...server })
    expect(vi.mocked(runLocalAgent).mock.calls[2][1]).toContain('project folder on srvbox: /home/me/proj')
    expect(vi.mocked(runLocalAgent).mock.calls[2][1]).not.toContain(project)
  })

  it('drops a folder after the server is edited and says so, without falling back to a local folder', async () => {
    const { store, group, project, run } = setup()
    const srv = remoteMember(store)
    store.updateConversation(group.id, { agentIds: [srv.id] })
    store.setConversationWorkspace(group.id, project)
    store.setAgentWorkspace(group.id, srv.id, { path: '/home/me/proj', ...server })
    servers.set('custom:srvbox', { ...server, targetRevision: 1 })
    vi.mocked(runLocalAgent).mockResolvedValue({ text: 'ok', images: [] })
    await run(srv.id)
    expect(options().workspaceDirectory).toBeUndefined()
    expect(options().remoteWorkspace).toBeUndefined()
    expect(vi.mocked(runLocalAgent).mock.calls[0][1]).toContain('belongs to another computer or server')
  })

  it('never uses a local folder saved on another computer', async () => {
    const { store, group, project, codex, run } = setup()
    store.setAgentWorkspace(group.id, codex.id, { path: project, executionTargetId: 'local:another-device', targetRevision: 0 })
    vi.mocked(runLocalAgent).mockResolvedValue({ text: 'ok', images: [] })
    await run(codex.id)
    expect(options().workspaceDirectory).toBeUndefined()
  })

  it('uses the owner\'s folder in a shared room, whoever asked', async () => {
    const { store, runtime, codex } = setup()
    const srv = remoteMember(store)
    const room = { id: 'room-1', name: 'Team', kind: 'group' as const, createdAt: new Date(0).toISOString(), members: [{ id: 'me', name: 'Me', email: 'me@x' }],
      agents: [{ id: 'server-srv', localId: srv.id, ownerId: 'me', name: srv.name }, { id: 'server-codex', localId: codex.id, ownerId: 'me', name: codex.name }] }
    store.syncFriendConversation('me', room, [])
    const local = store.accountConversations.find(item => item.remoteRoomId === 'room-1')!
    store.setAgentWorkspace(local.id, srv.id, { path: '/home/me/team', ...server })
    vi.mocked(runLocalAgent).mockResolvedValue({ text: 'ok', images: [] })
    // Bob is another member; the owner has allowed them to run this agent.
    const permissions = agentPermissions(); permissions.sensitive.localExecution = 'allow'
    store.updateAgent(srv.id, { permissions })
    await runtime.executeSocialTask('me', srv.id, 'task-1', 'hello', new AbortController().signal, '', { roomId: 'room-1', requesterId: 'bob', requester: 'Bob', roomName: 'Team', delegate: async () => {} })
    expect(options().remoteWorkspace).toEqual({ path: '/home/me/team', ...server })
    // Another member's agent in the same room keeps its own default folder.
    await runtime.executeSocialTask('me', codex.id, 'task-2', 'hello', new AbortController().signal, '', { roomId: 'room-1', requesterId: 'me', requester: 'Me', roomName: 'Team', delegate: async () => {} })
    expect(options(1).workspaceDirectory).toBeUndefined()
  })

  it('serializes turns on the same server folder and runs other targets in parallel', async () => {
    const { store, group, codex, claude, run } = setup()
    const srv = remoteMember(store)
    servers.set('custom:srvtwo', server)
    const srv2 = store.createAgent({ name: 'Second', role: 'Engineer', instructions: '', color: '#14B8A6', provider: 'local', model: 'default', localAgentId: 'custom:srvtwo' })
    store.updateConversation(group.id, { agentIds: [codex.id, claude.id, srv.id, srv2.id] })
    for (const agent of [srv, srv2]) store.setAgentWorkspace(group.id, agent.id, { path: '/home/me/proj', ...server })
    const started: string[] = [], release = new Map<string, () => void>()
    vi.mocked(runLocalAgent).mockImplementation(async (config) => {
      started.push(config.id)
      await new Promise<void>(resolve => release.set(config.id, resolve))
      return { text: 'ok', images: [] }
    })
    const first = run(srv.id), second = run(srv2.id), local = run(codex.id)
    await vi.waitFor(() => expect(started.sort()).toEqual([codex.id, srv.id].sort()))
    release.get(srv.id)!(); await first
    await vi.waitFor(() => expect(started).toContain(srv2.id))
    release.get(srv2.id)!(); release.get(codex.id)!()
    await Promise.all([second, local])
  })

  it('clears a member\'s folder when the member leaves or is deleted', () => {
    const { store, group, project, codex, claude } = setup()
    store.setAgentWorkspace(group.id, codex.id, { path: project, ...localExecutionTarget() })
    store.setAgentWorkspace(group.id, claude.id, { path: project, ...localExecutionTarget() })
    store.updateConversation(group.id, { agentIds: [claude.id] })
    expect(Object.keys(store.conversation(group.id)!.agentWorkspaces!)).toEqual([claude.id])
    store.deleteAgent(claude.id)
    expect(store.conversation(group.id)!.agentWorkspaces).toBeUndefined()
  })
})
