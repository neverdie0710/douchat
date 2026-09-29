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
  const state = { providers: [{ name: 'notion', enabled: true }, { name: 'github', enabled: true }], connections: [], selections: [] }
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.useFakeTimers(); command.mockReset(); select.mockReset()
    command.mockResolvedValue(state)
    Object.defineProperty(window, 'douchat', { configurable: true, value: { connanyCommand: command, connanySelect: select } as Partial<DouchatApi> })
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
  it('opens each connector detail and returns to the list without permission controls', async () => {
    await render()
    expect(container.querySelectorAll('.connany-list-item')).toHaveLength(3)
    expect(container.querySelector('.connany-details')).toBeNull()
    await open()
    expect(container.querySelector('h1')?.textContent).toBe('Notion')
    expect(container.querySelector('[aria-label="Tools"]')).toBeNull()
    expect(container.querySelector('[aria-label="Apps"]')).toBeNull()
    expect(container.querySelector('[aria-label="Information"]')).toBeNull()
    expect(container.textContent).not.toContain('Test connection')
    expect(container.querySelector('.connany-access')).toBeNull()
    expect(container.textContent).not.toContain('Agent access')
    await click('Back to connectors')
    await open('GitHub')
    expect(container.querySelector('h1')?.textContent).toBe('GitHub')
    expect(container.querySelector('[aria-label="Tools"]')).toBeNull()
  })
  it.each(['error', 'expired'])('handles %s inside the detail and allows retry', async status => {
    command.mockImplementation(async body => body.op === 'list' ? state : body.op === 'connect' ? { id: 'cs_a', provider: 'notion', status: 'pending', expires_at: new Date(Date.now() + 60000).toISOString() } : { id: 'cs_a', provider: 'notion', status, error_code: 'access_denied' })
    await render(); await open(); await click('Add account')
    expect(container.textContent).toContain('Finish connecting in your browser')
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(container.textContent).toContain(status === 'error' ? 'Authorization cancelled' : 'link expired')
    const calls = command.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(command.mock.calls.length).toBe(calls)
    await click('Add account')
    expect(command.mock.calls.filter(([body]) => body.op === 'connect')).toHaveLength(2)
  })
  it('requires a shared account choice when several accounts are connected', async () => {
    command.mockResolvedValue({ ...state, connections: ['a', 'b'].map(id => ({ id, provider: 'notion', status: 'connected', identity: { workspace_name: `Workspace ${id}` } })) })
    await render(); await open()
    expect(select).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Set a default account, or name a connected account in chat.')
    const accounts = container.querySelectorAll<HTMLButtonElement>('.connany-account-option')
    await act(async () => accounts[1].click())
    expect(select).not.toHaveBeenCalled()
    await click('Set as default')
    expect(select).toHaveBeenCalledWith({ provider: 'notion', connectionId: 'b' })
    expect(container.querySelector('select')).toBeNull()
  })
  it('confirms before disconnecting the shared account', async () => {
    command.mockResolvedValue({ ...state, selections: [{ provider: 'github', connectionId: 'g' }], connections: [{ id: 'g', provider: 'github', status: 'connected', identity: { account_name: 'octocat' } }] })
    await render(); await open('GitHub')
    expect(container.textContent).toContain('Uses the default account')
    expect(container.querySelector('.connany-detail-header .connany-actions')).toBeNull()
    expect(container.querySelector('.connany-account-panel')).toBeNull()
    await act(async () => (container.querySelector('.connany-account-option') as HTMLButtonElement).click())
    await click('Manage repository access')
    expect(command).toHaveBeenCalledWith({ op: 'installGithub' })
    await click('Reconnect')
    expect(command).toHaveBeenCalledWith({ op: 'reconnect', id: 'g' })
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    await click('Disconnect')
    expect(command).not.toHaveBeenCalledWith({ op: 'disconnect', id: 'g' })
    await click('Disconnect')
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('octocat'))
    expect(command).toHaveBeenCalledWith({ op: 'disconnect', id: 'g' })
  })
  it('expands one account at a time and targets actions to that account', async () => {
    command.mockResolvedValue({ ...state, selections: [{ provider: 'github', connectionId: 'a' }], connections: ['a', 'b'].map(id => ({ id, provider: 'github', status: 'connected', identity: { account_name: `Account ${id}` } })) })
    await render(); await open('GitHub')
    const rows = container.querySelectorAll<HTMLButtonElement>('.connany-account-option')
    await act(async () => rows[0].click())
    expect(rows[0].getAttribute('aria-expanded')).toBe('true')
    await act(async () => rows[1].click())
    expect(rows[0].getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelectorAll('.connany-account-panel')).toHaveLength(1)
    expect(select).not.toHaveBeenCalled()
    await click('Reconnect')
    expect(command).toHaveBeenCalledWith({ op: 'reconnect', id: 'b' })
    await click('Disconnect')
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Account b'))
    expect(command).toHaveBeenCalledWith({ op: 'disconnect', id: 'b' })
    await act(async () => rows[1].click())
    expect(container.querySelector('.connany-account-panel')).toBeNull()
  })
  it('hides revoked accounts and saves a custom name without selecting a different account', async () => {
    const connection = { id: 'g', provider: 'github', status: 'connected', identity: { account_name: 'octocat' }, display_name: '' }
    command.mockImplementation(async body => {
      if (body.op === 'rename') { connection.display_name = body.name; return }
      return { ...state, selections: [{ provider: 'github', connectionId: 'g' }], connections: [connection, { id: 'old', provider: 'github', status: 'revoked', identity: { account_name: 'old-account' } }] }
    })
    await render(); await open('GitHub')
    expect(container.textContent).not.toContain('old-account')
    expect(container.querySelectorAll('.connany-account-row')).toHaveLength(1)
    expect(container.querySelector('.connany-account-panel')).toBeNull()
    await act(async () => (container.querySelector('.connany-rename') as HTMLButtonElement).click())
    const input = container.querySelector('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Work GitHub')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(command).toHaveBeenCalledWith({ op: 'rename', id: 'g', name: 'Work GitHub' })
    expect(container.querySelector('.connany-account-name')?.textContent).toContain('Work GitHub')
    expect(select).not.toHaveBeenCalled()
  })
  it('keeps reconnect failures on their account and dismisses them across refreshes', async () => {
    const session = { id: 'cs_retry', provider: 'github', target_connection_id: 'g', status: 'error', error_code: 'access_denied' }
    command.mockResolvedValue({ ...state, connections: [{ id: 'g', provider: 'github', status: 'connected', identity: { account_name: 'octocat' } }], sessions: [session] })
    await render(); await open('GitHub')
    const row = container.querySelector('.connany-account-row')!
    expect(row.querySelector('[role="alert"]')?.textContent).toContain('Authorization cancelled')
    await act(async () => (row.querySelector('button[aria-label="Dismiss"]') as HTMLButtonElement).click())
    expect(container.querySelector('[role="alert"]')).toBeNull()
    await act(async () => (row.querySelector('.connany-account-option') as HTMLButtonElement).click())
    await click('Manage repository access')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    command.mockRejectedValueOnce(new Error('reauth_required'))
    await click('Reconnect')
    expect(row.querySelector('[role="alert"]')?.textContent).toContain('Authorization expired')
  })
  it('shows service errors instead of claiming connection success', async () => {
    command.mockRejectedValue(new Error('Connany: service_unavailable'))
    await render()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Cannot reach')
    expect(container.textContent).not.toContain('Connected')
  })
})
