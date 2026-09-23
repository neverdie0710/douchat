import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentPermissionBroker, toolCapability } from './agentPermissions'
import { agentPermissions } from '../shared/agentPermissions'
import type { AgentConfig } from '../shared/types'
const config = { id: 'agent', ownerId: 'owner', name: 'Agent' } as AgentConfig
const input = { requester: 'Friend', roomName: 'Group', capability: 'filesRead' as const, operation: 'read', details: '/private/file' }
afterEach(() => vi.useRealTimers())
describe('agent permission boundary', () => {
  it('defaults to social interaction with explicit approval for sensitive operations', () => {
    expect(agentPermissions()).toMatchObject({ groupHumans: 'allow', groupAgents: 'allow', sensitive: { filesRead: 'ask', localExecution: 'ask' } })
    expect(agentPermissions({ groupHumans: 'bogus', sensitive: { filesRead: true } })).toMatchObject({ groupHumans: 'deny', sensitive: { filesRead: 'deny' } })
  })
  it('does not execute until the owner approves, and approval is single use', async () => {
    const broker = new AgentPermissionBroker(() => 'owner', vi.fn())
    const execute = vi.fn()
    const work = broker.authorize(config, input).then(execute)
    expect(execute).not.toHaveBeenCalled()
    const request = broker.snapshot()[0]
    broker.resolve(request.id, true)
    await work
    expect(execute).toHaveBeenCalledOnce()
    expect(() => broker.resolve(request.id, true)).toThrow('no longer')
    const next = broker.authorize(config, input)
    const denied = expect(next).rejects.toThrow('declined')
    expect(broker.snapshot()).toHaveLength(1)
    broker.resolve(broker.snapshot()[0].id, false)
    await denied
  })
  it('cannot approve from a different signed-in account', async () => {
    let owner = 'owner'
    const broker = new AgentPermissionBroker(() => owner, vi.fn())
    const work = broker.authorize(config, input)
    const rejected = expect(work).rejects.toThrow('account changed')
    const id = broker.snapshot()[0].id
    owner = 'outsider'
    expect(broker.snapshot()).toEqual([])
    expect(() => broker.resolve(id, true)).toThrow('no longer')
    broker.cancelAgent(config.id)
    await rejected
  })
  it('honors deny without prompting and expires unanswered requests', async () => {
    vi.useFakeTimers()
    const broker = new AgentPermissionBroker(() => 'owner', vi.fn())
    const permissions = agentPermissions()
    permissions.sensitive.filesRead = 'deny'
    await expect(broker.authorize({ ...config, permissions }, input)).rejects.toThrow('disabled')
    expect(broker.snapshot()).toHaveLength(0)
    const work = expect(broker.authorize(config, input)).rejects.toThrow('expired')
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    await work
    expect(broker.snapshot()).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('aborts pending approvals without leaking listeners or requests', async () => {
    const broker = new AgentPermissionBroker(() => 'owner', vi.fn())
    const signal = new AbortController()
    const work = expect(broker.authorize(config, input, signal.signal)).rejects.toThrow(/abort/i)
    signal.abort()
    await work
    expect(broker.snapshot()).toHaveLength(0)
  })
  it('classifies tools conservatively', () => {
    expect(toolCapability('computer_list_files')).toBe('filesRead')
    expect(toolCapability('computer_move_file')).toBe('filesWrite')
    expect(toolCapability('computer_click')).toBe('browserControl')
    expect(toolCapability('email_read')).toBe('accountRead')
    expect(toolCapability('email_send')).toBe('accountWrite')
    expect(toolCapability('unknown_tool')).toBe('otherTools')
  })

  it('distinguishes a cancelled request from an owner declining it', async () => {
    const broker = new AgentPermissionBroker(() => 'owner', vi.fn())
    const work = expect(broker.authorize(config, input)).rejects.toThrow('Permission request cancelled')
    broker.cancelAgent(config.id)
    await work
    expect(broker.snapshot()).toHaveLength(0)
  })
})
