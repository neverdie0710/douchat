import { describe, expect, it, vi } from 'vitest'
import { ConnanyManager } from './connany'
import type { DouchatStore } from './store'
import type { ConnanyConnection, ConnectorSelection } from '../shared/connany'
function setup() {
  let selections: ConnectorSelection[] = [{ provider: 'github', connectionId: 'conn_mike' }, { provider: 'notion', connectionId: 'conn_notes' }]
  const names: Record<string, string> = {}
  const connections: ConnanyConnection[] = [
    { id: 'conn_mike', provider: 'github', status: 'connected', identity: { account_name: 'mikeaq3161' } },
    { id: 'conn_idoubi', provider: 'github', status: 'connected', identity: { account_name: 'idoubi' } },
    { id: 'conn_notes', provider: 'notion', status: 'connected', identity: { account_name: 'Notion User', workspace_name: 'Work notes' } }
  ]
  const store = { getConnanyNames: () => ({ ...names }), setConnanyName: (_: string, id: string, name: string) => { names[id] = name }, currentAccountId: 'user-a', accountAgents: [{ id: 'agent-a' }, { id: 'agent-b' }, { id: 'local', localAgentId: 'cli' }], getConnanySelections: () => selections, setConnanySelections: (_: string, b: ConnectorSelection[]) => { selections = b } } as unknown as DouchatStore
  const request = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    if (body.op === 'list') return Response.json({ code: 0, data: { providers: [], connections } })
    if (body.op === 'disconnect') {
      const connection = connections.find(c => c.id === body.id)!
      connection.status = 'revoked'
      return Response.json({ code: 0, data: connection })
    }
    if (body.op === 'execute') {
      const isIdoubi = body.id === 'conn_idoubi'
      return Response.json({ code: 0, data: { data: body.action === 'github.get_me' ? { installations: [{ id: isIdoubi ? 200 : 100 }], total_count: 1 } : { repositories: isIdoubi ? [{ name: 'private-project', private: true }] : [], total_count: isIdoubi ? 1 : 0 } } })
    }
    return Response.json({ code: 0, data: {} })
  })
  const open = vi.fn(async () => {})
  const manager = new ConnanyManager(store, 'http://localhost:3000', () => 'dch_private', open, request)
  const tool = (name: string) => manager.createTools('agent-a').find(t => t.name === name)!
  const executions = () => request.mock.calls.map(([, init]) => JSON.parse(String(init?.body))).filter(b => b.op === 'execute')
  return { store, request, open, manager, tool, executions, connections }
}
describe('Connany multi-account executor', () => {
  it.each(['github', 'notion', 'linear'] as const)('uses the same discovery and execution flow for %s', async provider => {
    const { manager, tool, connections, request, executions } = setup()
    if (provider === 'linear') connections.push({ id: 'conn_linear', provider, status: 'connected', identity: { account_name: 'idoubi', workspace_name: 'ThinkAny' } })
    const account = provider === 'github' ? 'idoubi' : provider === 'notion' ? 'Work notes' : 'ThinkAny'
    const expectedId = provider === 'github' ? 'conn_idoubi' : provider === 'notion' ? 'conn_notes' : 'conn_linear'
    await tool(`${provider}_discover`).execute('d', { account, query: 'search', offset: 20 })
    expect(JSON.parse(String(request.mock.calls.at(-1)?.[1]?.body))).toEqual({ op: 'discover', id: expectedId, query: 'search', offset: 20 })
    await tool(`${provider}_execute`).execute('e', { account, action: `${provider}.search`, input: { query: 'test', cursor: 'next' } })
    expect(executions().at(-1)).toEqual({ op: 'execute', id: expectedId, action: `${provider}.search`, input: { query: 'test', cursor: 'next' } })
    await expect(tool(`${provider}_execute`).execute('e', { action: `${provider}.__identity`, input: {} })).rejects.toThrow('Invalid action parameters')
    expect(manager.createTools('agent-a').map(t => t.name).sort()).toEqual(['connector_accounts', 'github_discover', 'github_execute', 'linear_discover', 'linear_execute', 'notion_discover', 'notion_execute'])
  })
  it('discovers Notion MCP tools for the default even when workspace names are identical', async () => {
    const { tool, connections, request } = setup()
    connections.push({ ...connections[2], id: 'conn_notes_other' })
    await tool('notion_discover').execute('d', { query: 'search', offset: 20 })
    const bodies = request.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))
    expect(bodies.at(-1)).toEqual({ op: 'discover', id: 'conn_notes', query: 'search', offset: 20 })
    await expect(tool('notion_discover').execute('d', { account: 'Work notes' })).rejects.toThrow('ambiguous')
  })
  it('forwards discovered MCP names and business parameters only for the resolved account', async () => {
    const { tool, store, connections, executions, manager } = setup()
    connections.push({ ...connections[2], id: 'conn_notes_other' })
    store.setConnanyName('', 'conn_notes_other', 'Personal notes')
    await tool('notion_execute').execute('n', { account: 'Personal notes', action: 'notion.notion-search', input: { query: 'MCP', query_type: 'internal' } })
    expect(executions()[0]).toEqual({ op: 'execute', id: 'conn_notes_other', action: 'notion.notion-search', input: { query: 'MCP', query_type: 'internal' } })
    await expect(tool('notion_execute').execute('n', { action: 'github.search_repositories', input: {} })).rejects.toThrow('Invalid action parameters')
    expect(manager.createTools('agent-a').some(t => t.name === 'notion_search')).toBe(false)
  })
  it('case 1: an unspecified account uses the default on installations and repository reads', async () => {
    const { tool, executions } = setup()
    await tool('github_execute').execute('1', { ...{}, action: 'github.get_me', input: {} })
    const response = await tool('github_execute').execute('2', { action: 'github.search_repositories', input: { query: 'user:mikeaq3161' } })
    expect(executions().map(x => x.id)).toEqual(['conn_mike', 'conn_mike'])
    expect(JSON.parse((response.content[0] as { text: string }).text)).toMatchObject({ account: { account_name: 'mikeaq3161', default: true }, data: { repositories: [] } })
  })
  it('case 2: explicit idoubi reads that connection throughout without changing the default', async () => {
    const { tool, executions, store } = setup()
    const directory = await tool('connector_accounts').execute('0', { provider: 'github' })
    const accounts = JSON.parse((directory.content[0] as { text: string }).text).accounts
    expect(accounts).toEqual(expect.arrayContaining([expect.objectContaining({ account_name: 'idoubi', default: false }), expect.objectContaining({ account_name: 'mikeaq3161', default: true })]))
    expect(JSON.stringify(accounts)).not.toContain('conn_')
    await tool('github_execute').execute('1', { ...{ account: 'idoubi' }, action: 'github.get_me', input: {} })
    const response = await tool('github_execute').execute('2', { account: 'idoubi', action: 'github.search_repositories', input: { query: 'user:idoubi', page: 2 } })
    expect(executions().map(x => x.id)).toEqual(['conn_idoubi', 'conn_idoubi'])
    expect(executions()[1].input).toEqual({ query: 'user:idoubi', page: 2 })
    expect(JSON.parse((response.content[0] as { text: string }).text)).toMatchObject({ account: { account_name: 'idoubi', default: false }, data: { repositories: [{ name: 'private-project', private: true }] } })
    expect(store.getConnanySelections('')[0].connectionId).toBe('conn_mike')
    await tool('github_execute').execute('3', { ...{}, action: 'github.get_me', input: {} })
    expect(executions().at(-1).id).toBe('conn_mike')
  })
  it('resolves custom names and GitHub login case, with provider-scoped matches', async () => {
    const { tool, store, executions } = setup()
    store.setConnanyName('', 'conn_idoubi', 'Work GitHub')
    await tool('github_execute').execute('1', { ...{ account: 'Work GitHub' }, action: 'github.get_me', input: {} })
    await tool('github_execute').execute('2', { ...{ account: 'IDOUBI' }, action: 'github.get_me', input: {} })
    await tool('notion_execute').execute('3', { account: 'Work notes', action: 'notion.notion-search', input: { query: 'plan' } })
    expect(executions().map(x => x.id)).toEqual(['conn_idoubi', 'conn_idoubi', 'conn_notes'])
    await expect(tool('github_execute').execute('4', { ...{ account: 'Work notes' }, action: 'github.get_me', input: {} })).rejects.toThrow('not connected')
  })
  it('rejects unknown, ambiguous and arbitrary ID selectors without default fallback', async () => {
    const { tool, store, executions } = setup()
    for (const account of ['unknown', 'conn_idoubi', '']) await expect(tool('github_execute').execute('x', { ...{ account }, action: 'github.get_me', input: {} })).rejects.toThrow()
    store.setConnanyName('', 'conn_mike', 'Shared')
    store.setConnanyName('', 'conn_idoubi', 'Shared')
    await expect(tool('github_execute').execute('x', { ...{ account: 'Shared' }, action: 'github.get_me', input: {} })).rejects.toThrow('ambiguous')
    await expect(tool('github_execute').execute('x', { ...{ connection_id: 'foreign', external_user_id: 'victim' }, action: 'github.get_me', input: {} })).rejects.toThrow('controlled by the executor')
    expect(executions()).toEqual([])
  })
  it('supports named accounts without a default but refuses unspecified calls', async () => {
    const { tool, store, executions } = setup()
    store.setConnanySelections('', [])
    await expect(tool('github_execute').execute('x', { ...{}, action: 'github.get_me', input: {} })).rejects.toThrow('No usable default')
    await tool('github_execute').execute('y', { ...{ account: 'idoubi' }, action: 'github.get_me', input: {} })
    expect(executions()[0].id).toBe('conn_idoubi')
  })
  it('default changes affect unspecified calls, while explicit selections remain independent', async () => {
    const { tool, manager, executions } = setup()
    const existing = tool('github_execute')
    await manager.select({ provider: 'github', connectionId: 'conn_idoubi' })
    await existing.execute('1', { ...{}, action: 'github.get_me', input: {} })
    await existing.execute('2', { ...{ account: 'mikeaq3161' }, action: 'github.get_me', input: {} })
    expect(executions().map(x => x.id)).toEqual(['conn_idoubi', 'conn_mike'])
  })
  it('denies stale tools after switching users and excludes foreign/local contacts', async () => {
    const { tool, store, request, manager } = setup()
    const existing = tool('github_execute')
    expect(manager.createTools('agent-b')).toHaveLength(7)
    expect(manager.createTools('stranger')).toEqual([])
    expect(manager.createTools('local')).toEqual([])
    Object.assign(store, { currentAccountId: 'user-b' })
    await expect(existing.execute('x', { ...{ account: 'idoubi' }, action: 'github.get_me', input: {} })).rejects.toThrow('access changed')
    expect(request).not.toHaveBeenCalled()
  })
  it('rejects disconnected and expired accounts without trying another connection', async () => {
    const { tool, manager, connections, executions, store } = setup()
    const existing = tool('github_execute')
    connections[1].status = 'reauth_required'
    await expect(existing.execute('x', { ...{ account: 'idoubi' }, action: 'github.get_me', input: {} })).rejects.toThrow('requires reconnection')
    await manager.command({ op: 'disconnect', id: 'conn_mike' })
    await expect(existing.execute('x', { ...{}, action: 'github.get_me', input: {} })).rejects.toThrow('No usable default')
    await expect(existing.execute('x', { ...{ account: 'mikeaq3161' }, action: 'github.get_me', input: {} })).rejects.toThrow('not connected')
    expect(store.getConnanySelections('')[0].connectionId).toBe('')
    expect(executions()).toEqual([])
  })
  it('enables a sole account by default but does not choose the first of multiple accounts', async () => {
    const { manager, store } = setup()
    store.setConnanySelections('', [])
    await manager.command({ op: 'list' })
    expect(store.getConnanySelections('')).toEqual([{ provider: 'notion', connectionId: 'conn_notes' }])
  })
  it('persists names without changing upstream identity or default selection', async () => {
    const { manager, store } = setup()
    await manager.command({ op: 'rename', id: 'conn_idoubi', name: ' Work ' })
    const result = await manager.command({ op: 'list' }) as { connections: ConnanyConnection[] }
    expect(result.connections.find(c => c.id === 'conn_idoubi')).toMatchObject({ display_name: 'Work', identity: { account_name: 'idoubi' } })
    expect(store.getConnanySelections('')[0].connectionId).toBe('conn_mike')
    await expect(manager.command({ op: 'rename', id: 'foreign', name: 'Mine' })).rejects.toThrow('unavailable')
    await expect(manager.command({ op: 'rename', id: 'conn_idoubi', name: ' ' })).rejects.toThrow('Invalid account name')
  })
  it('keeps authorization links out of renderer results and browser errors', async () => {
    const { manager, request, open } = setup()
    request.mockImplementation(async () => Response.json({ code: 0, data: { id: 'cs_a', provider: 'github', connect_url: 'http://localhost:3100/connect/private-link' } }))
    expect(await manager.command({ op: 'connect', provider: 'github' })).not.toHaveProperty('connect_url')
    open.mockRejectedValue(new Error('Failed to open http://localhost:3100/connect/private-link'))
    await expect(manager.command({ op: 'connect', provider: 'github' })).rejects.toThrow('Could not open the authorization browser')
  })
})
