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
  expect(node.textContent).toContain('Friend · Game')
  expect(node.textContent).toContain('Documents')
  expect(resolve).not.toHaveBeenCalled()
  await act(async () => [...node.querySelectorAll('button')].find((b) => b.textContent === 'Allow once')!.click())
  expect(resolve).toHaveBeenCalledExactlyOnceWith(true)
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
