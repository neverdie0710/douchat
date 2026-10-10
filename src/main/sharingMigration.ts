import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { agentPermissions } from '../shared/agentPermissions'
import { writeAtomic } from './connectionStore'
import type { DouchatStore } from './store'

interface RawConnection { id?: unknown; allowSharing?: unknown }
interface RawDefinition { id?: unknown; remote?: { allowSharing?: unknown }; remoteAgent?: { connectionId?: unknown; allowSharing?: unknown } }

async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error(`${path.split(/[\\/]/).pop()} could not be read, so sharing settings were not moved to permissions.`)
  }
}

/**
 * Earlier builds had sharing switches on connections and on remote agents
 * (both had to be on). Permissions now decide alone, so a remote agent that was
 * not shared gets "deny" for requests from people and from agents: nobody gains
 * access by the upgrade. Must run before migrateConnections, which no longer
 * carries the old switch over. Idempotent; the marker is written last.
 * Returns the number of agents that were narrowed.
 */
export async function migrateSharingToPermissions(userData: string, store: DouchatStore, write: typeof writeAtomic = writeAtomic): Promise<number> {
  const done = join(userData, 'sharing-migration.done')
  try { await readFile(done); return 0 } catch { /* Not finished yet. */ }
  const definitions = await readJson(join(userData, 'local-agents.json'))
  const connections = (await readJson(join(userData, 'connections.json')) as { connections?: RawConnection[] } | undefined)?.connections
  const sharedConnections = new Set((Array.isArray(connections) ? connections : [])
    .filter(item => item && typeof item.id === 'string' && item.allowSharing === true).map(item => item.id as string))
  const closed = new Set<string>()
  for (const item of Array.isArray(definitions) ? definitions as RawDefinition[] : []) {
    if (!item || typeof item.id !== 'string') continue
    if (item.remoteAgent) {
      const shared = typeof item.remoteAgent.connectionId === 'string' && sharedConnections.has(item.remoteAgent.connectionId) && item.remoteAgent.allowSharing === true
      if (!shared) closed.add(item.id)
    } else if (item.remote && item.remote.allowSharing !== true) closed.add(item.id)
  }
  let narrowed = 0
  for (const agent of store.agents) {
    if (!agent.localAgentId || !closed.has(agent.localAgentId)) continue
    const permissions = agentPermissions(agent.permissions)
    if (permissions.groupHumans === 'deny' && permissions.groupAgents === 'deny') continue
    store.updateAgent(agent.id, { permissions: { ...permissions, groupHumans: 'deny', groupAgents: 'deny' } })
    narrowed++
  }
  await write(done, `${new Date().toISOString()} narrowed ${narrowed}\n`)
  return narrowed
}
