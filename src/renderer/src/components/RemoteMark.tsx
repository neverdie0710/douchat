import { Server } from 'lucide-react'
import type { LocalAgent } from '../../../shared/types'
import { t } from '../preferences'

/** Remote agents known to this window, by local agent id → SSH host alias.
 * Updated whenever the agent list is detected, so labels stay in sync. */
let remoteHosts = new Map<string, string>()

export function setRemoteAgents(agents: LocalAgent[]): void {
  remoteHosts = new Map(agents.filter(agent => agent.remote).map(agent => [agent.id, agent.remote!.host]))
}

export function remoteHost(localAgentId?: string): string | undefined {
  return localAgentId ? remoteHosts.get(localAgentId) : undefined
}

/** Small server glyph overlaid on an agent icon. */
export function RemoteMark({ host }: { host?: string }) {
  const label = host ? `${t('Remote')} · ${host}` : t('Remote')
  return <span className="remote-agent-mark" title={label} aria-label={label}><Server size={10} strokeWidth={2} /></span>
}
