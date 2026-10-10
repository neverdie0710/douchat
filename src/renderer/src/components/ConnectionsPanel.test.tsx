// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ConnectionView } from '../../../shared/types'
vi.mock('./NativeDialog', () => ({ NativeDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('../preferences', () => ({ t: (text: string) => text }))
import { ConnectionsPanel } from './ConnectionsPanel'

let container: HTMLDivElement, root: Root
const view = (extra: Partial<ConnectionView> = {}): ConnectionView => ({ id: `conn_${'a'.repeat(32)}`, name: 'Box', kind: 'ssh', enabled: true, targetRevision: 0, ssh: { host: 'box', user: 'me' }, createdAt: 0, label: 'me@box', agentIds: [], status: { state: 'connected', latencyMs: 40, agents: 0 }, ...extra })
let api: Record<string, ReturnType<typeof vi.fn>>
beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  api = {
    listConnections: vi.fn(async () => [view()]), onConnectionsChanged: vi.fn(() => () => {}), listSshHosts: vi.fn(async () => ['box', 'gpu']),
    setConnectionEnabled: vi.fn(async () => [view({ enabled: false, status: { state: 'disabled' } })]), saveConnection: vi.fn(async () => [view()]),
    testConnection: vi.fn(async () => ({ ok: false, durationMs: 10, steps: [{ name: 'ssh', passed: true }, { name: 'shell', passed: false, message: 'base64 is missing on the server' }] })),
    removeConnection: vi.fn(async () => []), detectLocalAgents: vi.fn(async () => []), openConnectionTerminal: vi.fn(async () => {}),
    discoverRemoteAgents: vi.fn(async () => [{ adapter: 'codex', executable: '/usr/bin/codex', version: '1.0' }, { adapter: 'claude', executable: '/usr/bin/claude' }]),
    addDiscoveredAgents: vi.fn(async () => [])
  }
  Object.defineProperty(window, 'douchat', { configurable: true, value: api })
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks() })
const render = async (onAgentsChange = vi.fn()) => { await act(async () => root.render(<ConnectionsPanel onAgentsChange={onAgentsChange} />)); return onAgentsChange }
const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label)!

it('shows status and toggles a connection off', async () => {
  await render()
  expect(container.querySelector('[role=status]')?.textContent).toBe('Connected · 40 ms')
  expect(container.textContent).toContain('me@box')
  await act(async () => button('Enabled Box').click())
  expect(api.setConnectionEnabled).toHaveBeenCalledWith(view().id, false)
  expect(container.querySelector('[role=status]')?.textContent).toBe('Turned off')
})

it('reports each test step with its reason', async () => {
  await render()
  await act(async () => button('More Box').click())
  await act(async () => button('Test connection').click())
  expect(container.querySelector('.connection-step-ok')?.textContent).toContain('SSH login and host key')
  expect(container.querySelector('.connection-step-failed')?.textContent).toContain('base64 is missing on the server')
})

it('adds a connection from the SSH config', async () => {
  await render()
  await act(async () => button('Add').click())
  await act(async () => button('Save').click())
  expect(api.saveConnection).toHaveBeenCalledWith({ name: '', ssh: { host: 'box' } })
})

it('asks before deleting a connection that agents use, and can keep them', async () => {
  api.listConnections.mockResolvedValue([view({ agentIds: ['custom:a'] })])
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  const changed = await render()
  await act(async () => button('More Box').click())
  await act(async () => button('Delete').click())
  expect(confirm).toHaveBeenCalledTimes(2)
  expect(api.removeConnection).toHaveBeenCalledWith(view().id, 'disable-agents')
  expect(changed).toHaveBeenCalled()
})

it('scans the server and adds only the chosen agents', async () => {
  const changed = await render()
  await act(async () => button('Scan for agents on this server Box').click())
  const boxes = [...container.querySelectorAll<HTMLInputElement>('.local-agent-checkbox input')]
  expect(boxes).toHaveLength(2)
  await act(async () => boxes[1].click())
  await act(async () => button('Add selected').click())
  expect(api.addDiscoveredAgents).toHaveBeenCalledWith(view().id, [{ adapter: 'codex', executable: '/usr/bin/codex', name: 'Codex · Box' }])
  expect(changed).toHaveBeenCalled()
})
