// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentConfig, DouchatApi } from '../../../shared/types'
vi.mock('../preferences', () => ({ usePreferences: () => ({ language: 'en' }), resolveInterfaceLanguage: () => 'en' }))
vi.mock('./common', () => ({ UserAvatar: () => <span /> }))
import { SocialWorkspace } from './SocialWorkspace'
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })
it('offers only owned agents as task recipients and keeps peer agent ownership visible', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Element.prototype.scrollIntoView = vi.fn()
  const socialAction = vi.fn(async () => ({ messages: [], hasMore: false }))
  window.douchat = {
    getSocialSnapshot: vi.fn(async () => ({ userId: 'alice', friendships: [], rooms: [{ id: 'group', name: 'Team', kind: 'group', members: [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }], agents: [{ id: 'a', localId: 'local-a', ownerId: 'alice', name: 'Alice agent' }, { id: 'b', localId: 'local-b', ownerId: 'bob', name: 'Bob agent' }] }] })),
    socialAction
  } as unknown as DouchatApi
  const container = document.createElement('div'); document.body.appendChild(container)
  const root = createRoot(container)
  const agents = [{ id: 'local-a', name: 'Alice agent', ownerId: 'alice' }, { id: 'local-b', name: 'Bob agent', ownerId: 'bob' }, { id: 'admin', name: 'Admin', systemRole: 'admin' }] as AgentConfig[]
  try {
    await act(async () => { root.render(<SocialWorkspace agents={agents} userId="alice" onAddFriend={vi.fn()} />) })
    const group = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Team'))!
    await act(async () => group.click())
    const select = container.querySelector('select[aria-label="Task recipient"]') as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toEqual(['', 'a'])
    expect(container.textContent).toContain('Bob’s agent')
    expect(container.querySelector('[aria-label="Remove from group: Bob agent"]')).toBeNull()
    expect(container.querySelector('[aria-label="Remove from group: Alice agent"]')).not.toBeNull()
    expect(socialAction).toHaveBeenCalledWith({ action: 'messages', roomId: 'group' })
    await act(async () => root.render(<SocialWorkspace agents={agents} userId="alice" onAddFriend={vi.fn()} embedded roomId="group" />))
    expect(container.querySelector('.social-sidebar')).toBeNull()
    expect(container.querySelector('.social-workspace.embedded')).not.toBeNull()
    expect(container.querySelector('select[aria-label="Task recipient"]')).not.toBeNull()
  } finally { await act(async () => root.unmount()) }
})

it('lets the create-group dialog close with Escape', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Element.prototype.scrollIntoView = vi.fn()
  window.douchat = {
    getSocialSnapshot: vi.fn(async () => ({ userId: 'alice', friendships: [], rooms: [] })),
    socialAction: vi.fn(async () => ({}))
  } as unknown as DouchatApi
  const container = document.createElement('div'); document.body.appendChild(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(<SocialWorkspace agents={[]} userId="alice" onAddFriend={vi.fn()} startGroup />) })
    const dialog = container.querySelector<HTMLFormElement>('.social-group-dialog')!
    expect(dialog).not.toBeNull()
    await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(container.querySelector('.social-group-dialog')).toBeNull()
  } finally { await act(async () => root.unmount()) }
})
