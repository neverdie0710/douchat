// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { AgentConfig, Conversation, ConversationWorkspaceView } from '../../../shared/types'
vi.mock('../preferences', () => ({ t: (s: string) => s }))
import { ConversationWorkspaceSetting } from './ConversationWorkspaceSetting'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const agents = [{ id: 'codex', ownerId: 'me', localAgentId: 'codex', name: 'Codex' }, { id: 'srv', ownerId: 'me', localAgentId: 'custom:x', name: 'Server Codex' }] as AgentConfig[]
const direct = { id: 'direct-codex', type: 'direct', name: 'Codex', agentIds: ['codex'], topics: [], activeTopicId: '', unread: 0, readAt: 0, createdAt: 0, updatedAt: 0, ownerId: 'me' } as Conversation
const group = { ...direct, id: 'g', type: 'group', name: 'G', agentIds: ['codex', 'srv'] } as Conversation

async function render(conversation: Conversation, api: Record<string, unknown>) {
  Object.defineProperty(window, 'douchat', { configurable: true, value: api })
  const host = document.createElement('div'); const root = createRoot(host)
  await act(async () => root.render(<ConversationWorkspaceSetting conversation={conversation} agents={agents} />))
  return { host, root, button: (text: string) => [...host.querySelectorAll('button')].find(item => item.textContent === text) }
}

it('picks, opens and clears a local member folder by agent', async () => {
  const local: ConversationWorkspaceView = { eligible: true, members: [{ agentId: 'codex', location: 'local', source: 'default' }] }
  const chosen: ConversationWorkspaceView = { eligible: true, members: [{ agentId: 'codex', location: 'local', source: 'custom', path: '/Users/me/code/project' }] }
  const api = { conversationWorkspaces: vi.fn().mockResolvedValue(local), chooseAgentWorkspace: vi.fn().mockResolvedValue(chosen), clearAgentWorkspace: vi.fn().mockResolvedValue(local), openAgentWorkspace: vi.fn().mockResolvedValue(undefined) }
  const { host, root, button } = await render(direct, api)
  try {
    expect(host.querySelector('.conversation-workspace-path span')!.textContent).toBe('Default')
    await act(async () => button('Choose folder')!.click())
    expect(api.chooseAgentWorkspace).toHaveBeenCalledWith('direct-codex', 'codex')
    expect(host.querySelector('.conversation-workspace-path span')!.textContent).toBe('project')
    expect(host.querySelector('.conversation-workspace-path')!.getAttribute('title')).toBe('/Users/me/code/project')
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Open folder"]')!.click())
    expect(api.openAgentWorkspace).toHaveBeenCalledWith('direct-codex', 'codex')
    await act(async () => button('Use default')!.click())
    expect(api.clearAgentWorkspace).toHaveBeenCalledWith('direct-codex', 'codex')
  } finally { await act(async () => root.unmount()) }
})

it('never offers the local folder picker for a remote member and browses the server instead', async () => {
  const view: ConversationWorkspaceView = { eligible: true, members: [
    { agentId: 'codex', location: 'local', source: 'default' },
    { agentId: 'srv', location: 'remote', host: 'me@box', source: 'custom', path: '/home/me/proj' }
  ] }
  const api = {
    conversationWorkspaces: vi.fn().mockResolvedValue(view), chooseAgentWorkspace: vi.fn(), copyText: vi.fn().mockResolvedValue(undefined),
    openRemoteAgentWorkspaceTerminal: vi.fn().mockResolvedValue(undefined),
    listRemoteAgentDirectories: vi.fn()
      .mockResolvedValueOnce({ path: '/home/me/proj', directories: ['api', 'web'] })
      .mockResolvedValueOnce({ path: '/home/me/proj/web', directories: [] }),
    chooseRemoteAgentWorkspace: vi.fn().mockResolvedValue(view)
  }
  const { host, root, button } = await render(group, api)
  try {
    expect(host.textContent).toContain('Server Codex · me@box')
    expect(host.querySelectorAll('[aria-label="Open folder"]')).toHaveLength(1)
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Copy path"]')!.click())
    expect(api.copyText).toHaveBeenCalledWith('/home/me/proj')
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Open in terminal"]')!.click())
    expect(api.openRemoteAgentWorkspaceTerminal).toHaveBeenCalledWith('g', 'srv')
    await act(async () => button('Choose server folder')!.click())
    expect(api.chooseAgentWorkspace).not.toHaveBeenCalled()
    expect(api.listRemoteAgentDirectories).toHaveBeenLastCalledWith('g', 'srv', '/home/me/proj', undefined)
    // The renderer sends the parent from the server and a child name, never a joined path.
    await act(async () => [...host.querySelectorAll('.remote-directory-list button')].find(item => item.textContent?.includes('web'))!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(api.listRemoteAgentDirectories).toHaveBeenLastCalledWith('g', 'srv', '/home/me/proj', 'web')
    await act(async () => button('Use this folder')!.click())
    expect(api.chooseRemoteAgentWorkspace).toHaveBeenCalledWith('g', 'srv', '/home/me/proj/web')
    expect(api.chooseRemoteAgentWorkspace.mock.calls[0]).toHaveLength(3)
  } finally { await act(async () => root.unmount()) }
})

it('flags folders from another target and an unused legacy folder', async () => {
  const view: ConversationWorkspaceView = { eligible: true, legacyPath: '/Users/me/old', legacyUnused: true, members: [{ agentId: 'srv', location: 'remote', host: 'box', source: 'default', stale: true }] }
  const api = { conversationWorkspaces: vi.fn().mockResolvedValue(view), clearConversationWorkspace: vi.fn().mockResolvedValue({ ...view, legacyPath: undefined, legacyUnused: undefined }), clearAgentWorkspace: vi.fn().mockResolvedValue(view) }
  const { host, root, button } = await render({ ...group, agentIds: ['srv'], workspacePath: '/Users/me/old' }, api)
  try {
    expect(host.textContent).toContain('belongs to another computer or server')
    expect(host.textContent).toContain('no agent here can use it')
    await act(async () => button('Remove')!.click())
    expect(api.clearConversationWorkspace).toHaveBeenCalledWith('g')
    await act(async () => button('Use default')!.click())
    expect(api.clearAgentWorkspace).toHaveBeenCalledWith('g', 'srv')
  } finally { await act(async () => root.unmount()) }
})

it('renders nothing for chats without the owner\'s agents', async () => {
  const { host, root } = await render(direct, { conversationWorkspaces: vi.fn().mockResolvedValue({ eligible: false, members: [] }) })
  try { expect(host.innerHTML).toBe('') } finally { await act(async () => root.unmount()) }
})

it('lets a chat with only local members go back to the default folder', async () => {
  const view: ConversationWorkspaceView = { eligible: true, legacyPath: '/Users/me/old', legacyUnused: false, members: [{ agentId: 'codex', location: 'local', source: 'legacy', path: '/Users/me/old' }] }
  const cleared: ConversationWorkspaceView = { eligible: true, members: [{ agentId: 'codex', location: 'local', source: 'default' }] }
  const api = { conversationWorkspaces: vi.fn().mockResolvedValue(view), clearConversationWorkspace: vi.fn().mockResolvedValue(cleared), clearAgentWorkspace: vi.fn() }
  const { host, root, button } = await render({ ...direct, workspacePath: '/Users/me/old' }, api)
  try {
    expect(host.textContent).toContain('Uses the folder chosen earlier')
    await act(async () => button('Use default')!.click())
    expect(api.clearConversationWorkspace).toHaveBeenCalledWith('direct-codex')
    expect(api.clearAgentWorkspace).not.toHaveBeenCalled()
    expect(host.querySelector('.conversation-workspace-path span')!.textContent).toBe('Default')
  } finally { await act(async () => root.unmount()) }
})
