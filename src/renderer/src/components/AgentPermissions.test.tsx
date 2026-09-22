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
  expect(node.textContent).toContain('individual actions cannot currently be approved separately')
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
