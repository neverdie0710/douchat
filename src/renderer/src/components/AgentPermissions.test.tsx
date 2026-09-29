// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentPermissionsDialog, AgentPermissionPrompt } from './AgentPermissions'
import type { AgentConfig } from '../../../shared/types'
vi.mock('../preferences', () => ({ t: (text: string) => text }))
let node: HTMLDivElement
let root: Root
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; node = document.createElement('div'); document.body.append(node); root = createRoot(node) })
afterEach(async () => { await act(async () => root.unmount()); node.remove() })
it('saves independent interaction and sensitive-operation permissions', async () => {
  const save = vi.fn(async () => {})
  const close = vi.fn()
  await act(async () => root.render(<AgentPermissionsDialog agent={{ id: 'a', name: 'Agent' } as AgentConfig} onClose={close} onSave={save} />))
  const read = node.querySelector<HTMLSelectElement>('select[aria-label="Read local files"]')!
  expect(read.value).toBe('ask')
  await act(async () => { read.value = 'deny'; read.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => node.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ groupHumans: 'allow', sensitive: expect.objectContaining({ filesRead: 'deny', filesWrite: 'ask' }) }))
  expect(close).toHaveBeenCalledOnce()
})
it('does not pretend that local CLI internal tools are individually controlled', async () => {
  await act(async () => root.render(<AgentPermissionsDialog agent={{ id: 'a', name: 'Local', localAgentId: 'codex' } as AgentConfig} onClose={vi.fn()} onSave={vi.fn()} />))
  expect(node.querySelector('select[aria-label="Read local files"]')).toBeNull()
  expect(node.querySelector<HTMLSelectElement>('select[aria-label="Run on my computer"]')?.value).toBe('ask')
  expect(node.textContent).toContain('Codex Computer Use requests separate approval')
})
it('shows requester and exact operation, with explicit single-operation approval', async () => {
  const resolve = vi.fn(async () => {})
  await act(async () => root.render(<AgentPermissionPrompt request={{ id: 'r', ownerId: 'owner', agentId: 'a', agentName: 'Agent', requester: 'Friend', roomName: 'Game', capability: 'filesRead', operation: 'computer_list_files', details: '{"directory":"Documents"}', createdAt: 0 }} onResolve={resolve} />))
  expect(node.textContent).toContain('Friend')
  expect(node.textContent).toContain('Group: Game')
  expect(node.textContent).toContain('Documents')
  expect(resolve).not.toHaveBeenCalled()
  await act(async () => [...node.querySelectorAll('button')].find((b) => b.textContent === 'Allow once')!.click())
  expect(resolve).toHaveBeenCalledExactlyOnceWith(true)
})

it('shows the bounded task scope and submits task approval explicitly', async () => {
  const resolve = vi.fn(async () => {})
  await act(async () => root.render(<AgentPermissionPrompt request={{ id: 'r', ownerId: 'owner', agentId: 'a', agentName: 'Agent', requester: 'Owner', roomName: 'Chat', capability: 'network', operation: 'computer_open', details: '{}', createdAt: 0, taskScope: 'https://douchat.ai' }} onResolve={resolve} />))
  expect(node.textContent).toContain('https://douchat.ai')
  expect(node.textContent).toContain('Expires when this task ends')
  await act(async () => [...node.querySelectorAll('button')].find(button => button.textContent === 'Allow for this task')!.click())
  expect(resolve).toHaveBeenCalledExactlyOnceWith('task')
})

it('explains native shell approval and displays the exact command without the generic category', async () => {
  const command = 'python3 build_slides.py --output presentation.pptx'
  await act(async () => root.render(<AgentPermissionPrompt request={{ id: 'r', ownerId: 'owner', agentId: 'claude', agentName: 'Claude', requester: 'Claude', requesterId: 'claude', requesterKind: 'agent', context: 'direct', roomName: 'Claude', capability: 'otherTools', operation: 'Claude: Bash', details: JSON.stringify({ tool: 'Bash', input: { command, timeout: 120000 } }), createdAt: 0 }} onResolve={vi.fn()} />))
  expect(node.textContent).toContain('Run a terminal command')
  expect(node.textContent).not.toContain('Other tools')
  expect(node.textContent).not.toContain('Claude: Bash')
  expect(node.querySelector('pre')?.textContent).toBe(command)
  expect(node.querySelector('details')?.open).toBe(false)
  expect(node.querySelector('details')?.textContent).toContain('120000')
})

it('omits redundant requester metadata for an agent acting on itself', async () => {
  await act(async () => root.render(<AgentPermissionPrompt request={{ id: 'r', ownerId: 'owner', agentId: 'monica-69ef5b', agentName: 'Monica', requester: 'Monica', requesterId: 'monica-69ef5b', requesterKind: 'agent', context: 'direct', roomName: 'Monica', capability: 'filesWrite', operation: 'Install skills into Monica', details: 'Source: example skill', createdAt: 0 }} onResolve={vi.fn()} />))
  expect(node.textContent).not.toContain('Requested by')
  expect(node.textContent).not.toContain('monica-69ef5b')
  expect(node.textContent).not.toContain('Group:')
  expect(node.textContent).toContain('Install skills into Monica')
  expect(node.textContent).toContain('Source: example skill')
})

it('keeps a different requesting agent identifiable even when its name matches the executor', async () => {
  await act(async () => root.render(<AgentPermissionPrompt request={{ id: 'r', ownerId: 'owner', agentId: 'own-agent', agentName: 'Monica', requester: 'Monica', requesterId: 'external-agent', requesterKind: 'agent', context: 'group', roomName: 'Project', capability: 'filesRead', operation: 'Read file', details: '/file', createdAt: 0 }} onResolve={vi.fn()} />))
  expect(node.textContent).toContain('Requested by: Monica')
  expect(node.textContent).toContain('Group: Project')
  expect(node.querySelector('[title="external-agent"]')).not.toBeNull()
})

// Component behavior tests use an inline host; NativeDialog has separate window lifecycle tests.
vi.mock('./NativeDialog', async () => {
  const { createElement } = await import('react')
  return { NativeDialog: ({ children, onClose, width, height, ...props }: any) => createElement('div', props, children) }
})

it('shows a human requester’s profile photo and nickname instead of their UUID', async () => {
  const request = { id: 'r', ownerId: 'owner', agentId: 'a', agentName: 'Agent', requester: 'Old name', requesterId: 'person-uuid', requesterKind: 'person' as const, roomName: 'Game', capability: 'filesRead' as const, operation: 'Read', details: '', createdAt: 0 }
  await act(async () => root.render(<AgentPermissionPrompt request={request} social={{ userId: 'owner', friendships: [], rooms: [{ id: 'room', name: 'Game', kind: 'group', createdAt: '', agents: [], members: [{ id: 'person-uuid', name: 'Deniffer Yoho', email: '', image: 'https://example.com/avatar.png' }] }] }} onResolve={vi.fn()} />))
  expect(node.querySelector('.permission-requester')?.textContent).toContain('Deniffer Yoho')
  expect(node.querySelector('.permission-requester img')?.getAttribute('src')).toBe('https://example.com/avatar.png')
  expect(node.textContent).not.toContain('person-uuid')
  expect(node.textContent).not.toContain('Old name')
})

it('falls back to the request name and default avatar when no member profile is available', async () => {
  await act(async () => root.render(<AgentPermissionPrompt request={{ id: 'r', ownerId: 'owner', agentId: 'a', agentName: 'Agent', requester: 'Friend', requesterId: 'person-uuid', requesterKind: 'person', roomName: 'Game', capability: 'filesRead', operation: 'Read', details: '', createdAt: 0 }} onResolve={vi.fn()} />))
  expect(node.querySelector('.permission-requester')?.textContent).toContain('Friend')
  expect(node.querySelector('.permission-requester .user-avatar')).not.toBeNull()
  expect(node.querySelector('.permission-requester img')).toBeNull()
  expect(node.textContent).not.toContain('person-uuid')
})

it('shows the executing contact’s current avatar and nickname above the action', async () => {
  const request = { id: 'r', ownerId: 'owner', agentId: 'a', agentName: 'Old name', requester: 'Owner', roomName: 'Chat', context: 'direct' as const, capability: 'filesWrite' as const, operation: 'Write', details: '', createdAt: 0 }
  const agent = { id: 'a', ownerId: 'owner', name: '小丽', avatar: 'https://example.com/xiaoli.png' } as AgentConfig
  await act(async () => root.render(<AgentPermissionPrompt request={request} agent={agent} onResolve={vi.fn()} />))
  expect(node.querySelector('.permission-actor strong')?.textContent).toBe('小丽')
  expect(node.querySelector('.permission-actor img')?.getAttribute('src')).toBe(agent.avatar)
  await act(async () => root.render(<AgentPermissionPrompt request={request} agent={{ ...agent, ownerId: 'another-owner' }} onResolve={vi.fn()} />))
  expect(node.querySelector('.permission-actor strong')?.textContent).toBe('Old name')
  expect(node.querySelector('.permission-actor img')).toBeNull()
})

it.each(['get_app_state', 'click', 'type_text', 'scroll'])('offers app-scoped session approval for %s and collapses technical details', async tool => {
  const resolve = vi.fn(async () => {})
  await act(async () => root.render(<AgentPermissionPrompt request={{ id: 'r', ownerId: 'owner', agentId: 'a', agentName: 'Codex', requester: 'Codex', requesterId: 'a', requesterKind: 'agent', context: 'direct', roomName: 'Codex', capability: 'otherTools', operation: 'Allow Computer Use to use NetEaseMusic?', details: JSON.stringify({ tool, arguments: { app: 'com.netease.163music' } }), sessionScope: 'NetEaseMusic', nativeApp: { id: 'com.netease.163music', name: 'NetEaseMusic' }, createdAt: 0 }} onResolve={resolve} />))
  expect(node.querySelector('.permission-actor')?.textContent).toContain('Access a desktop app')
  expect(node.textContent).toContain('Application: NetEaseMusic')
  expect(node.querySelector('details')?.open).toBe(false)
  expect(node.textContent).toContain('Expires when the native session closes')
  await act(async () => [...node.querySelectorAll('button')].find(button => button.textContent === 'Allow this app for this session')!.click())
  expect(resolve).toHaveBeenCalledExactlyOnceWith('session')
})
