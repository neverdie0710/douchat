// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DouchatApi, LocalAgent } from '../../../shared/types'
import { LocalAgentEditor } from './LocalAgentEditor'

vi.mock('./NativeDialog', () => ({ NativeDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('../preferences', () => ({ t: (text: string) => text }))
let container: HTMLDivElement
let root: Root
const test = vi.fn()
const update = vi.fn()
const add = vi.fn()
const cancel = vi.fn(async () => {})
const saved = vi.fn()
const closed = vi.fn()
const agent: LocalAgent = { id: 'codex', name: 'My Codex', command: '/my/codex', args: ['--profile', 'work'], avatar: 'data:image/png;base64,YQ==', installed: true, discovered: true, status: 'ready', chatSupported: true, authentication: 'unchecked' }
beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  Object.defineProperty(window, 'douchat', { configurable: true, value: {
    testLocalAgent: test, updateLocalAgent: update, addCustomLocalAgent: add, cancelLocalAgentTest: cancel
  } as Partial<DouchatApi> })
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
async function render(value?: LocalAgent) {
  await act(async () => root.render(<LocalAgentEditor agent={value} onSaved={saved} onClose={closed} />))
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(button => button.textContent === text)!
  await act(async () => button.click())
}
it('loads saved settings and tests the draft without saving it', async () => {
  test.mockResolvedValue({ reply: 'DOUCHAT_OK', durationMs: 1250, version: 'codex 1.2.3' })
  await render(agent)
  expect(container.querySelector('textarea')?.value).toBe('--profile\nwork')
  expect(container.querySelector('img')?.src).toBe(agent.avatar)
  await click('Test connection')
  expect(test).toHaveBeenCalledWith('codex', { name: agent.name, command: agent.command, args: agent.args, avatar: agent.avatar })
  expect(container.querySelector('[role=status]')?.textContent).toBe('Connected · 1.3s · 1.2.3')
  expect(update).not.toHaveBeenCalled()
  expect(add).not.toHaveBeenCalled()
})
it('shows an actionable error and allows retrying', async () => {
  test.mockRejectedValue(new Error("Error invoking remote method 'douchat:test-local-agent': Error: Please log in"))
  await render(agent); await click('Test connection')
  expect(container.querySelector('[role=alert]')?.textContent).toBe('Please log in')
  test.mockResolvedValue({ reply: 'DOUCHAT_OK', durationMs: 100 })
  await click('Test connection')
  expect(container.querySelector('[role=alert]')).toBeNull()
})
it('saves edits in place and refreshes the local list', async () => {
  update.mockResolvedValue([agent])
  await render(agent); await click('Save')
  expect(update).toHaveBeenCalledWith(agent.id, expect.objectContaining({ command: agent.command, args: agent.args }))
  expect(saved).toHaveBeenCalledWith([agent])
  expect(closed).toHaveBeenCalled()
})
it('cancels an in-flight test when the editor closes', async () => {
  let reject!: (cause: Error) => void
  test.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
  await render(agent); await click('Test connection')
  expect(container.querySelector('fieldset')?.disabled).toBe(true)
  await act(async () => root.render(null))
  expect(cancel).toHaveBeenCalledOnce()
  await act(async () => reject(new Error('Cancelled')))
})

const connection = (id: string, extra: object = {}) => ({ id, name: id === 'conn_a' ? 'Box' : 'Off', kind: 'ssh', enabled: true, targetRevision: 0, ssh: { host: 'box' }, allowSharing: false, createdAt: 0, label: 'box', agentIds: [], status: { state: 'connected', agents: 0 }, ...extra })
it('adds a remote agent by connection, never by host', async () => {
  add.mockResolvedValue([])
  ;(window.douchat as any).listConnections = vi.fn(async () => [connection('conn_a'), connection('conn_b', { enabled: false })])
  await render()
  await act(async () => container.querySelectorAll<HTMLInputElement>('input[name=location]')[1].click())
  const select = [...container.querySelectorAll('label')].find(label => label.textContent?.startsWith('Connection'))!.querySelector('select')!
  expect(select.value).toBe('conn_a')
  expect([...select.options].find(option => option.value === 'conn_b')!.disabled).toBe(true)
  expect(container.textContent).not.toContain('Host alias')
  await act(async () => { const name = container.querySelector<HTMLInputElement>('input[required]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Server Codex'); name.dispatchEvent(new Event('input', { bubbles: true })) })
  await click('Save')
  expect(add).toHaveBeenCalledWith({ name: 'Server Codex', command: 'codex', avatar: '', args: [], remoteAgent: { connectionId: 'conn_a', adapter: 'codex', executable: 'codex', args: [], allowSharing: false } })
  expect(add.mock.calls[0][0]).not.toHaveProperty('remote')
})
it('explains an agent whose connection is gone and keeps its saved settings', async () => {
  ;(window.douchat as any).listConnections = vi.fn(async () => [connection('conn_a')])
  const orphan: LocalAgent = { id: 'custom:x', name: 'Orphan', command: 'claude', installed: false, discovered: true, status: 'not-found', chatSupported: true, authentication: 'unchecked', custom: true, connectionId: 'conn_gone', unavailable: 'missing',
    remoteAgent: { connectionId: 'conn_gone', adapter: 'claude', executable: '/opt/claude', args: ['--x'] } }
  await render(orphan)
  expect(container.querySelector('[role=alert]')?.textContent).toContain('was removed')
  expect(container.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true)
  const select = [...container.querySelectorAll('label')].find(label => label.textContent?.startsWith('Agent type'))!.querySelector('select')!
  expect(select.value).toBe('claude')
})
