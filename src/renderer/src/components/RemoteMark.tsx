import { Server } from 'lucide-react'
import type { LocalAgent } from '../../../shared/types'
import { t } from '../preferences'

/** Remote agents known to this window, by local agent id → SSH host alias.
 * Updated whenever the agent list is detected, so labels stay in sync. */
let remoteHosts = new Map<string, string>()
let remoteAdapters = new Map<string, string>()
let localAgentsLoaded = false

/** `loaded` turns true once the first local agent scan has finished, even if it failed. */
export function setRemoteAgents(agents: LocalAgent[], loaded = true): void {
  localAgentsLoaded = loaded
  remoteHosts = new Map(agents.filter(agent => agent.remote).map(agent => [agent.id, agent.remote!.host]))
  remoteAdapters = new Map(agents.filter(agent => agent.remote).map(agent => [agent.id, agent.remote!.adapter]))
}

/** Whether custom and remote agents can be resolved to their icons yet. */
export function localAgentsReady(): boolean {
  return localAgentsLoaded
}

/** The agent a remote entry runs (codex, claude, …), so it can wear that agent's icon. */
export function remoteAdapter(localAgentId?: string): string | undefined {
  return localAgentId ? remoteAdapters.get(localAgentId) : undefined
}

export function remoteHost(localAgentId?: string): string | undefined {
  return localAgentId ? remoteHosts.get(localAgentId) : undefined
}

/** Small server glyph overlaid on an agent icon. */
export function RemoteMark({ host }: { host?: string }) {
  const label = host ? `${t('Remote')} · ${host}` : t('Remote')
  return <span className="remote-agent-mark" title={label} aria-label={label}><Server size={10} strokeWidth={2} /></span>
}
