import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { agentPermissions } from '../shared/agentPermissions'
import { migrateSharingToPermissions } from './sharingMigration'
import { DouchatStore } from './store'

const directories: string[] = []
afterEach(() => { directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })) })

const OPEN = `conn_${'a'.repeat(32)}`
const CLOSED = `conn_${'b'.repeat(32)}`

function setup() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'douchat-sharing-migration-')))
  directories.push(directory)
  const store = new DouchatStore(join(directory, 'state.json'))
  store.setCurrentAccountId('me')
  const make = (name: string, localAgentId?: string) => store.createAgent({ name, role: 'Engineer', instructions: '', color: '#14B8A6', provider: localAgentId ? 'local' : 'gateway', model: 'default', ...(localAgentId ? { localAgentId } : {}) })
  const binding = (connectionId: string, allowSharing?: boolean) => ({ connectionId, adapter: 'codex', executable: 'codex', args: [], ...(allowSharing === undefined ? {} : { allowSharing }) })
  return { directory, store, make, binding }
}

it('denies requests from others to remote agents that were not shared, and leaves the rest alone', async () => {
  const { directory, store, make, binding } = setup()
  await writeFile(join(directory, 'connections.json'), JSON.stringify({ version: 1, connections: [{ id: OPEN, allowSharing: true }, { id: CLOSED, allowSharing: false }] }))
  await writeFile(join(directory, 'local-agents.json'), JSON.stringify([
    { id: 'custom:shared', remoteAgent: binding(OPEN, true) },
    { id: 'custom:optedout', remoteAgent: binding(OPEN, false) },
    { id: 'custom:silent', remoteAgent: binding(OPEN) },
    { id: 'custom:closedconn', remoteAgent: binding(CLOSED, true) },
    { id: 'custom:legacyopen', remote: { host: 'x', allowSharing: true } },
    { id: 'custom:legacyclosed', remote: { host: 'x' } },
    { id: 'custom:local', command: '/usr/bin/agent', args: [] }
  ]))
  const agents = Object.fromEntries(['shared', 'optedout', 'silent', 'closedconn', 'legacyopen', 'legacyclosed', 'local'].map(name => [name, make(name, `custom:${name}`)]))
  const cloud = make('cloud')
  const permissionsOf = (id: string) => agentPermissions(store.agent(id)?.permissions)

  expect(await migrateSharingToPermissions(directory, store)).toBe(4)
  for (const name of ['optedout', 'silent', 'closedconn', 'legacyclosed']) {
    expect(permissionsOf(agents[name].id)).toMatchObject({ groupHumans: 'deny', groupAgents: 'deny' })
  }
  for (const name of ['shared', 'legacyopen', 'local']) {
    expect(permissionsOf(agents[name].id)).toMatchObject({ groupHumans: 'allow', groupAgents: 'allow' })
  }
  expect(permissionsOf(cloud.id)).toMatchObject({ groupHumans: 'allow', groupAgents: 'allow' })
  // Other permission choices are kept.
  expect(permissionsOf(agents.silent.id).sensitive.localExecution).toBe('ask')

  // Runs once: later changes by the owner are never overwritten.
  store.updateAgent(agents.silent.id, { permissions: { ...permissionsOf(agents.silent.id), groupHumans: 'allow' } })
  expect(await migrateSharingToPermissions(directory, store)).toBe(0)
  expect(permissionsOf(agents.silent.id).groupHumans).toBe('allow')
  expect(await readFile(join(directory, 'sharing-migration.done'), 'utf8')).toMatch(/narrowed 4/)
})

it('is a no-op without a registry and stops on an unreadable one', async () => {
  const { directory, store } = setup()
  expect(await migrateSharingToPermissions(directory, store)).toBe(0)

  const other = setup()
  await writeFile(join(other.directory, 'local-agents.json'), '{not json')
  await expect(migrateSharingToPermissions(other.directory, other.store)).rejects.toThrow(/could not be read/)
  await expect(readFile(join(other.directory, 'sharing-migration.done'))).rejects.toThrow()
})
