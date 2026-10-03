// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DouchatApi } from '../../../shared/types'
vi.mock('../preferences', () => ({ t: (en: string) => en }))
import { ConnanyPanel } from './ConnanyPanel'

describe('Connany settings', () => {
  let container: HTMLDivElement
  let root: Root
  const command = vi.fn()
  const select = vi.fn()
  let changed: (() => void) | undefined
  const state = { connectors: [{ name: 'notion', title: 'Notion', description: 'Pages and databases', avatar_url: 'https://c/notion.svg' }, { name: 'linear', title: 'Linear', avatar_url: '' }], connections: [], selections: [] }
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.useFakeTimers(); command.mockReset(); select.mockReset()
    command.mockResolvedValue(state)
    Object.defineProperty(window, 'douchat', { configurable: true, value: { connanyCommand: command, connanySelect: select, onConnanyChanged: (listener: () => void) => { changed = listener; return () => { changed = undefined } } } as Partial<DouchatApi> })
    container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  })
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks() })
  async function render() { await act(async () => root.render(<ConnanyPanel />)) }
  async function open(name = 'Notion') { await act(async () => (container.querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement).click()) }
  async function click(text: string) {
    const button = [...container.querySelectorAll('button')].find(b => b.textContent === text)
    expect(button).toBeTruthy()
    await act(async () => button!.click())
  }
  it('lists exactly the connectors the service enables and opens each detail', async () => {
    command.mockResolvedValue({ ...state, connectors: [...state.connectors, { name: 'github', title: 'GitHub', avatar_url: 'https://c/github.svg' }] })
    await render()
    expect([...container.querySelectorAll('.connany-list-item')].map(b => b.getAttribute('aria-label'))).toEqual(['Notion', 'Linear', 'GitHub'])
    expect(container.querySelector('.connany-icon-github img')?.getAttribute('src')).toBe('https://c/github.svg')
    expect(container.querySelector('button[aria-label="Notion"]')?.textContent).toContain('Pages and databases')
    expect(container.querySelector('button[aria-label="Linear"]')?.textContent).toContain('Let your agents use data from Linear.')
    expect(container.querySelector('.connany-icon-linear')?.textContent).toBe('L')
    await open('GitHub')
    expect(container.querySelector('h1')?.textContent).toBe('GitHub')
    await click('Back to connectors')
    await open('Linear')
    expect(container.querySelector('h1')?.textContent).toBe('Linear')
  })
  it('hides connectors the service does not enable', async () => {
    command.mockResolvedValue({ ...state, connectors: [state.connectors[0]] })
    await render()
    expect([...container.querySelectorAll('.connany-list-item')].map(b => b.getAttribute('aria-label'))).toEqual(['Notion'])
    command.mockResolvedValue({ ...state, connectors: [] })
    await act(async () => changed?.())
    expect(container.textContent).toContain('No connectors are available yet.')
  })
  it('connects, polls the session by connector and shows the connected account', async () => {
    const connected = { ...state, connections: [{ id: 'conn_n', connector: 'notion', status: 'connected', identity: { workspace_name: 'Work notes' } }] }
    let done = false
    command.mockImplementation(async body => body.op === 'list' ? (done ? connected : state)
      : body.op === 'connect' ? { id: 'cs_a', connector: 'notion', status: 'pending', expires_at: new Date(Date.now() + 60000).toISOString() }
      : (done = true, { id: 'cs_a', connector: 'notion', status: 'connected', connection_id: 'conn_n' }))
    await render(); await open(); await click('Add account')
    expect(command).toHaveBeenCalledWith({ op: 'connect', connector: 'notion' })
    expect(container.textContent).toContain('Finish connecting in your browser')
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(command).toHaveBeenCalledWith({ op: 'session', connector: 'notion', id: 'cs_a' })
    expect(container.textContent).toContain('Work notes')
    expect(container.textContent).not.toContain('Finish connecting')
  })
  it.each(['error', 'expired'])('handles %s inside the detail and allows retry', async status => {
    command.mockImplementation(async body => body.op === 'list' ? state : body.op === 'connect' ? { id: 'cs_a', connector: 'notion', status: 'pending', expires_at: new Date(Date.now() + 60000).toISOString() } : { id: 'cs_a', connector: 'notion', status, error_code: 'access_denied' })
    await render(); await open(); await click('Add account')
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(container.textContent).toContain(status === 'error' ? 'Authorization cancelled' : 'link expired')
    const calls = command.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(command.mock.calls.length).toBe(calls)
    await click('Add account')
    expect(command.mock.calls.filter(([body]) => body.op === 'connect')).toHaveLength(2)
  })
  it('requires a shared account choice when several accounts are connected', async () => {
    command.mockResolvedValue({ ...state, connections: ['a', 'b'].map(id => ({ id, connector: 'notion', status: 'connected', identity: { workspace_name: `Workspace ${id}` } })) })
    await render(); await open()
    expect(container.textContent).toContain('Set a default account, or name a connected account in chat.')
    const accounts = container.querySelectorAll<HTMLButtonElement>('.connany-account-option')
    await act(async () => accounts[1].click())
    await click('Set as default')
    expect(select).toHaveBeenCalledWith({ provider: 'notion', connectionId: 'b' })
  })
  it('checks, reconnects and confirms before disconnecting an account', async () => {
    command.mockImplementation(async body => body.op === 'check' ? { connection_id: 'l', tool_count: 12 } : { ...state, selections: [{ provider: 'linear', connectionId: 'l' }], connections: [{ id: 'l', connector: 'linear', status: 'connected', identity: { account_name: 'idoubi', workspace_name: 'ThinkAny' } }] })
    await render(); await open('Linear')
    expect(container.textContent).toContain('Uses the default account')
    await act(async () => (container.querySelector('.connany-account-option') as HTMLButtonElement).click())
    await click('Check connection')
    expect(command).toHaveBeenCalledWith({ op: 'check', id: 'l' })
    expect(container.textContent).toContain('Connection is working.')
    await click('Reconnect')
    expect(command).toHaveBeenCalledWith({ op: 'reconnect', id: 'l' })
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    await click('Disconnect')
    expect(command).not.toHaveBeenCalledWith({ op: 'disconnect', id: 'l' })
    await click('Disconnect')
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('ThinkAny'))
    expect(command).toHaveBeenCalledWith({ op: 'disconnect', id: 'l' })
  })
  it('shows a failed check on the account', async () => {
    command.mockImplementation(async body => { if (body.op === 'check') throw new Error('Connector error: reauth_required'); return { ...state, connections: [{ id: 'n', connector: 'notion', status: 'connected', identity: { workspace_name: 'Work' } }] } })
    await render(); await open()
    await act(async () => (container.querySelector('.connany-account-option') as HTMLButtonElement).click())
    await click('Check connection')
    expect(container.querySelector('.connany-account-row [role="alert"]')?.textContent).toContain('Authorization expired')
  })
  it('offers resource access and refreshes once the platform grants it', async () => {
    let granted = false
    command.mockImplementation(async body => body.op === 'access' ? { add_url: 'https://x', total: granted ? 1 : 0, next_page: null, data: [] }
      : body.op === 'openAccess' ? undefined
      : { ...state, connections: [{ id: 'n', connector: 'notion', status: 'connected', needs_access: !granted, identity: { workspace_name: 'Work' } }] })
    await render(); await open()
    await click('Grant access')
    expect(command).toHaveBeenCalledWith({ op: 'openAccess', id: 'n' })
    expect(container.querySelector('.connany-account-notice')?.textContent).toContain('Finish granting access in your browser')
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(container.querySelector('.connany-account-notice')).not.toBeNull()
    granted = true
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(container.querySelector('.connany-account-notice')).toBeNull()
  })
  it('lists granted resources in the expanded account and opens their management pages', async () => {
    command.mockImplementation(async body => body.op === 'access'
      ? { add_url: 'https://github.com/apps/x/installations/new', total: 1, next_page: null, data: [{ id: '7', type: 'organization', name: 'all-in-aigc', selection: 'selected', suspended: false, manage_url: 'https://github.com/organizations/all-in-aigc/settings/installations/7' }] }
      : body.op === 'openAccess' ? undefined
      : { ...state, connections: [{ id: 'g', connector: 'notion', status: 'connected', needs_access: false, identity: { account_name: 'idoubi' } }] })
    await render(); await open()
    await act(async () => (container.querySelector('.connany-account-option') as HTMLButtonElement).click())
    const access = container.querySelector('.connany-access')!
    expect(access.textContent).toContain('all-in-aigc')
    expect(access.textContent).toContain('Organization · Selected repositories')
    await click('Manage')
    expect(command).toHaveBeenCalledWith({ op: 'openAccess', id: 'g', url: 'https://github.com/organizations/all-in-aigc/settings/installations/7' })
    await click('Add organization or repositories')
    expect(command).toHaveBeenCalledWith({ op: 'openAccess', id: 'g' })
  })
  it('hides the resource section for connectors without a resource step', async () => {
    command.mockImplementation(async body => body.op === 'access' ? { add_url: null, total: 0, next_page: null, data: [] } : { ...state, connections: [{ id: 'n', connector: 'notion', status: 'connected', identity: { workspace_name: 'Work' } }] })
    await render(); await open()
    await act(async () => (container.querySelector('.connany-account-option') as HTMLButtonElement).click())
    expect(container.querySelector('.connany-access')).toBeNull()
  })
  it('hides revoked accounts and reloads when connections change elsewhere', async () => {
    command.mockResolvedValue({ ...state, connections: [{ id: 'old', connector: 'notion', status: 'revoked', identity: { workspace_name: 'Old space' } }] })
    await render(); await open()
    expect(container.textContent).not.toContain('Old space')
    expect(container.textContent).toContain('No accounts connected')
    command.mockResolvedValue({ ...state, connections: [{ id: 'new', connector: 'notion', status: 'connected', identity: { workspace_name: 'Chat space' } }] })
    await act(async () => changed?.())
    expect(container.textContent).toContain('Chat space')
  })
  it('shows service errors instead of claiming connection success', async () => {
    command.mockRejectedValue(new Error('Connector error: service_unavailable'))
    await render()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Cannot reach')
    expect(container.textContent).not.toContain('Connected')
  })
})
