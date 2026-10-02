import { describe, expect, it, vi } from 'vitest'
import { ConnanyManager, type ConnectorChatHooks } from './connany'
import type { DouchatStore } from './store'
import type { ConnanyConnection, ConnectorSelection } from '../shared/connany'

const connectors = [{ name: 'notion', title: 'Notion', avatar_url: 'https://c/notion.svg' }, { name: 'linear', title: 'Linear', avatar_url: 'https://c/linear.svg' }]
function setup(options: { allowWrites?: boolean } = {}) {
  let selections: ConnectorSelection[] = [{ provider: 'notion', connectionId: 'conn_work' }]
  const names: Record<string, string> = {}
  const connections: ConnanyConnection[] = [
    { id: 'conn_work', connector: 'notion', status: 'connected', identity: { account_name: 'Ada', workspace_name: 'Work notes' } },
    { id: 'conn_home', connector: 'notion', status: 'connected', identity: { account_name: 'Ada', workspace_name: 'Home notes' } },
    { id: 'conn_linear', connector: 'linear', status: 'connected', identity: { account_name: 'idoubi', workspace_name: 'ThinkAny' } }
  ]
  const store = { getConnanyNames: () => ({ ...names }), setConnanyName: (_: string, id: string, name: string) => { names[id] = name }, currentAccountId: 'user-a', accountAgents: [{ id: 'agent-a' }, { id: 'agent-b' }, { id: 'local', localAgentId: 'cli' }], getConnanySelections: () => selections, setConnanySelections: (_: string, b: ConnectorSelection[]) => { selections = b } } as unknown as DouchatStore
  const fail = (code: string, status = 409) => Response.json({ code: -1, message: `Connector error: ${code}` }, { status })
  const handlers: Record<string, (body: any) => Response | undefined> = {}
  const request = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    const custom = handlers[body.op]?.(body)
    if (custom) return custom
    if (body.op === 'list') return Response.json({ code: 0, data: { connectors, connections, allow_writes: options.allowWrites === true } })
    if (body.op === 'disconnect') {
      const connection = connections.find(c => c.id === body.id)!
      connection.status = 'revoked'
      return Response.json({ code: 0, data: connection })
    }
    if (body.op === 'list_tools') return Response.json({ code: 0, data: { data: [{ name: 'notion.notion-search', read_only: true }], total: 1, next_offset: null } })
    if (body.op === 'call_tool') {
      if (body.tool.endsWith('create-pages') && !body.confirmed) return fail(options.allowWrites ? 'confirmation_required' : 'write_not_allowed', options.allowWrites ? 409 : 403)
      return Response.json({ code: 0, data: { data: { content: [{ type: 'text', text: `result from ${body.id}` }] }, request_id: 'req_1' } })
    }
    if (body.op === 'connect' || body.op === 'reconnect') return Response.json({ code: 0, data: { id: 'cs_1', connector: body.connector ?? 'notion', status: 'pending', expires_at: new Date(Date.now() + 900_000).toISOString(), connect_url: 'http://localhost:3200/connect/private' } })
    if (body.op === 'session') return Response.json({ code: 0, data: { id: body.id, connector: body.connector, status: 'connected', connection_id: 'conn_new', expires_at: '' } })
    if (body.op === 'events') return Response.json({ code: 0, data: { data: [], next_cursor: body.after ?? '7' } })
    return Response.json({ code: 0, data: {} })
  })
  const open = vi.fn(async () => {})
  const changed = vi.fn()
  const manager = new ConnanyManager(store, 'http://localhost:3004', () => 'dch_private', open, request, changed)
  const hooks: ConnectorChatHooks & { requestConnection: ReturnType<typeof vi.fn>; requestAccess: ReturnType<typeof vi.fn>; confirmWrite: ReturnType<typeof vi.fn> } = { requestConnection: vi.fn(async () => {}), requestAccess: vi.fn(async () => {}), confirmWrite: vi.fn(async () => {}) }
  const tools = () => manager.createTools('agent-a', hooks)
  const tool = (name: string) => tools().find(t => t.name === name)!
  const bodies = (op?: string) => request.mock.calls.map(([, init]) => JSON.parse(String(init?.body))).filter(b => !op || b.op === op)
  const output = (result: { content: unknown[] }) => JSON.parse((result.content[0] as { text: string }).text)
  return { store, request, open, changed, manager, hooks, tools, tool, bodies, output, connections, handlers, fail }
}

describe('Connany executor', () => {
  it('registers tools only after the turn loads the user’s connections', async () => {
    const { manager, tools } = setup()
    expect(tools()).toEqual([])
    await manager.prepare()
    expect(tools().map(t => t.name).sort()).toEqual(['connector_accounts', 'linear_call_tool', 'linear_list_tools', 'notion_call_tool', 'notion_list_tools', 'request_connection'])
    expect(tools().find(t => t.name === 'notion_list_tools')!.description).toContain('Work notes')
    expect(manager.createTools('stranger')).toEqual([])
    // Local CLI agents get the same tools through the loopback bridge.
    expect(manager.createTools('local').map(t => t.name)).toContain('linear_list_tools')
  })
  it('lists and calls tools with the resolved connection; the model never chooses an ID', async () => {
    const { manager, tool, bodies, output } = setup()
    await manager.prepare()
    await tool('notion_list_tools').execute('1', { query: 'search' })
    expect(bodies('list_tools').at(-1)).toEqual({ op: 'list_tools', id: 'conn_work', query: 'search' })
    const result = output(await tool('notion_call_tool').execute('2', { tool: 'notion.notion-search', input: { query: 'Q3' }, account: 'Home notes' }))
    expect(bodies('call_tool').at(-1)).toEqual({ op: 'call_tool', id: 'conn_home', tool: 'notion.notion-search', input: { query: 'Q3' } })
    expect(result).toMatchObject({ data: { content: [{ text: 'result from conn_home' }] }, account: { workspace_name: 'Home notes', default: false } })
    expect(JSON.stringify(result.account)).not.toContain('conn_')
    for (const bad of [{ tool: 'linear.get_user', input: {} }, { tool: 'notion.notion-search', input: {}, connection_id: 'foreign' }, { tool: 'notion.notion-search', input: {}, external_user_id: 'victim' }])
      await expect(tool('notion_call_tool').execute('x', bad)).rejects.toThrow('Invalid parameters')
    await expect(tool('notion_call_tool').execute('x', { tool: 'notion.notion-search', input: {}, account: 'conn_home' })).rejects.toThrow('not connected')
    expect(bodies('call_tool')).toHaveLength(1)
  })
  it('refuses ambiguous defaults instead of choosing the first account', async () => {
    const { manager, tool, store, bodies } = setup()
    store.setConnanySelections('', [])
    await manager.prepare()
    expect(store.getConnanySelections('')).toEqual([{ provider: 'linear', connectionId: 'conn_linear' }])
    await expect(tool('notion_list_tools').execute('1', {})).rejects.toThrow('none is the default')
    await tool('linear_list_tools').execute('2', {})
    expect(bodies('list_tools').map(b => b.id)).toEqual(['conn_linear'])
  })
  it('asks the user before every write and never runs a declined write', async () => {
    const { manager, tool, hooks, bodies } = setup({ allowWrites: true })
    await manager.prepare()
    await tool('notion_call_tool').execute('1', { tool: 'notion.notion-create-pages', input: { title: 'Plan' } })
    expect(hooks.confirmWrite).toHaveBeenCalledWith('Notion', 'notion.notion-create-pages', { title: 'Plan' }, 'Work notes', undefined)
    expect(bodies('call_tool').map(b => b.confirmed)).toEqual([undefined, true])
    hooks.confirmWrite.mockRejectedValueOnce(new Error('The owner declined this request'))
    await expect(tool('notion_call_tool').execute('2', { tool: 'notion.notion-create-pages', input: {} })).rejects.toThrow('declined')
    expect(bodies('call_tool').filter(b => b.confirmed)).toHaveLength(1)
  })
  it('reports disabled writes without asking the user', async () => {
    const { manager, tool, hooks } = setup()
    await manager.prepare()
    await expect(tool('notion_call_tool').execute('1', { tool: 'notion.notion-create-pages', input: {} })).rejects.toThrow('write tools are disabled')
    expect(hooks.confirmWrite).not.toHaveBeenCalled()
  })
  it('shows a connect button in chat and continues once authorization completes', async () => {
    vi.useFakeTimers()
    try {
      const { manager, tool, hooks, open, bodies, output, connections } = setup()
      connections.splice(0, 2)
      await manager.prepare()
      expect(tool('notion_list_tools').description).toContain('call request_connection first')
      connections.push({ id: 'conn_new', connector: 'notion', status: 'connected', identity: { workspace_name: 'New space' } })
      const pending = tool('request_connection').execute('1', { connector: 'notion' })
      await vi.advanceTimersByTimeAsync(5000)
      const result = output(await pending)
      expect(hooks.requestConnection).toHaveBeenCalledWith('notion', 'Notion', false, undefined)
      expect(open).toHaveBeenCalledWith('http://localhost:3200/connect/private')
      expect(bodies('session')[0]).toEqual({ op: 'session', connector: 'notion', id: 'cs_1' })
      expect(result).toMatchObject({ status: 'connected', account: { workspace_name: 'New space', default: true } })
      expect(JSON.stringify(result)).not.toContain('connect/private')
    } finally { vi.useRealTimers() }
  })
  it('wakes the chat wait as soon as the browser returns through douchat://', async () => {
    vi.useFakeTimers()
    try {
      const { manager, tool, bodies, connections } = setup()
      connections.splice(0, 2)
      await manager.prepare()
      const pending = tool('request_connection').execute('1', { connector: 'notion' })
      await vi.advanceTimersByTimeAsync(0)
      expect(bodies('connect')[0]).toMatchObject({ connector: 'notion', locale: 'en' })
      await manager.handleReturn('cs_unknown')
      expect(bodies('session')).toEqual([])
      await manager.handleReturn('cs_1')
      await vi.advanceTimersByTimeAsync(0)
      expect(bodies('session')).toHaveLength(1)
      expect((await pending).content[0]).toMatchObject({ type: 'text' })
    } finally { vi.useRealTimers() }
  })
  it('does not open a browser when the user declines to connect', async () => {
    const { manager, tool, hooks, open } = setup()
    await manager.prepare()
    hooks.requestConnection.mockRejectedValueOnce(new Error('The owner declined this request'))
    await expect(tool('request_connection').execute('1', { connector: 'linear' })).rejects.toThrow('declined')
    expect(open).not.toHaveBeenCalled()
  })
  it('reconnects inline on reauth_required and retries the call once', async () => {
    vi.useFakeTimers()
    try {
      const { manager, tool, hooks, handlers, fail, bodies } = setup()
      await manager.prepare()
      let first = true
      handlers.call_tool = () => first ? (first = false, fail('reauth_required')) : undefined
      const pending = tool('notion_call_tool').execute('1', { tool: 'notion.notion-search', input: {} })
      await vi.advanceTimersByTimeAsync(5000)
      await pending
      expect(hooks.requestConnection).toHaveBeenCalledWith('notion', 'Notion', true, undefined)
      expect(bodies('reconnect')).toEqual([{ op: 'reconnect', id: 'conn_work', locale: 'en' }])
      expect(bodies('call_tool').map(b => b.id)).toEqual(['conn_work', 'conn_work'])
    } finally { vi.useRealTimers() }
  })
  it('stops using revoked connections reported by the event feed', async () => {
    const { manager, tool, handlers, connections, changed, bodies } = setup()
    await manager.prepare()
    await manager.pollEvents()
    expect(bodies('events').at(-1)).toEqual({ op: 'events' })
    const existing = tool('notion_call_tool')
    connections[0].status = 'revoked'
    handlers.events = () => Response.json({ code: 0, data: { data: [{ type: 'connection.revoked', connection_id: 'conn_work' }], next_cursor: '8' } })
    const revision = manager.revision()
    await manager.pollEvents()
    expect(bodies('events').at(-1)).toEqual({ op: 'events', after: '7' })
    expect(manager.revision()).not.toBe(revision)
    expect(changed).toHaveBeenCalled()
    await expect(existing.execute('1', { tool: 'notion.notion-search', input: {} })).rejects.toThrow()
    expect(bodies('call_tool')).toEqual([])
  })
  it('gives the agent plain errors that never name the connector service', async () => {
    const { manager, tool, handlers, fail } = setup()
    await manager.prepare()
    for (const [code, text] of [['mcp_tool_error', 'platform rejected'], ['tool_not_found', 'List tools again'], ['service_unavailable', 'unavailable']]) {
      handlers.call_tool = () => fail(code, 502)
      const error = await tool('notion_call_tool').execute('1', { tool: 'notion.notion-search', input: {} }).then(() => new Error('resolved'), (e: Error) => e)
      expect(error.message).toContain(text)
      expect(error.message).not.toMatch(/connany|connector error/i)
    }
  })
  it('prompts for resource access in chat and continues once access appears', async () => {
    vi.useFakeTimers()
    try {
      const { manager, tool, tools, hooks, handlers, open, connections, output } = setup()
      connections.push({ id: 'conn_gh', connector: 'notion', status: 'connected', needs_access: true, identity: { workspace_name: 'Needs access' } })
      await manager.prepare()
      expect(tools().map(t => t.name)).toContain('request_resource_access')
      let total = 0
      handlers.access = () => Response.json({ code: 0, data: { add_url: 'https://github.com/apps/x/installations/new', total, next_page: null, data: total ? [{ id: '7', type: 'organization', name: 'acme', selection: 'selected', suspended: false, manage_url: null }] : [] } })
      const listed = output(await tool('notion_list_tools').execute('0', { account: 'Needs access' }))
      expect(listed.access_note).toContain('request_resource_access')
      const pending = tool('request_resource_access').execute('1', { connector: 'notion', account: 'Needs access' })
      await vi.advanceTimersByTimeAsync(0)
      expect(hooks.requestAccess).toHaveBeenCalledWith('notion', 'Notion', undefined)
      expect(open).toHaveBeenCalledWith('https://github.com/apps/x/installations/new')
      total = 1
      await vi.advanceTimersByTimeAsync(5000)
      expect(output(await pending)).toMatchObject({ status: 'granted', resources: [{ name: 'acme' }] })
      await manager.command({ op: 'list' })
      expect(tools().map(t => t.name)).not.toContain('request_resource_access')
    } finally { vi.useRealTimers() }
  })
  it('denies stale tools after switching users', async () => {
    const { manager, tool, store, request } = setup()
    await manager.prepare()
    const existing = tool('notion_call_tool')
    request.mockClear()
    Object.assign(store, { currentAccountId: 'user-b' })
    await expect(existing.execute('x', { tool: 'notion.notion-search', input: {} })).rejects.toThrow('access changed')
    expect(request).not.toHaveBeenCalled()
  })
  it('keeps authorization links out of renderer results and browser errors', async () => {
    const { manager, open } = setup()
    expect(await manager.command({ op: 'connect', connector: 'notion' })).not.toHaveProperty('connect_url')
    open.mockRejectedValue(new Error('Failed to open http://localhost:3200/connect/private'))
    await expect(manager.command({ op: 'connect', connector: 'notion' })).rejects.toThrow('Could not open the authorization browser')
    await expect(manager.command({ op: 'connect', connector: '../admin' })).rejects.toThrow('Invalid connector')
  })
  it('opens resource access only from URLs returned for that connection', async () => {
    const { manager, open, handlers } = setup()
    handlers.access = () => Response.json({ code: 0, data: { add_url: 'https://github.com/apps/x/installations/new', total: 1, next_page: null, data: [{ id: '1', manage_url: 'https://github.com/settings/installations/1' }] } })
    await manager.command({ op: 'openAccess', id: 'conn_work' })
    await manager.command({ op: 'openAccess', id: 'conn_work', url: 'https://github.com/settings/installations/1' })
    await expect(manager.command({ op: 'openAccess', id: 'conn_work', url: 'https://evil.example' })).rejects.toThrow('not available')
    expect(open.mock.calls).toEqual([['https://github.com/apps/x/installations/new'], ['https://github.com/settings/installations/1']])
  })
  it('persists names without changing upstream identity or default selection', async () => {
    const { manager, store } = setup()
    await manager.command({ op: 'rename', id: 'conn_home', name: ' Personal ' })
    const result = await manager.command({ op: 'list' }) as { connections: ConnanyConnection[] }
    expect(result.connections.find(c => c.id === 'conn_home')).toMatchObject({ display_name: 'Personal', identity: { workspace_name: 'Home notes' } })
    expect(store.getConnanySelections('')[0].connectionId).toBe('conn_work')
    await expect(manager.command({ op: 'rename', id: 'foreign', name: 'Mine' })).rejects.toThrow('unavailable')
    await expect(manager.command({ op: 'rename', id: 'conn_home', name: ' ' })).rejects.toThrow('Invalid account name')
  })
})
