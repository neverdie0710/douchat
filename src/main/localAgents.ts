import type { LocalAgent } from '../shared/types'
import { resolveExecutable } from './shellPath'

// Keep the local CLI catalog aligned with Termany; installation and chat
// support are separate so an executable is never mistaken for an adapter.
export const localAgentCatalog = [
  ['claude', 'Claude Code', 'claude'],
  ['codex', 'Codex', 'codex'],
  ['gemini', 'Gemini', 'gemini'],
  ['grok', 'Grok Build', 'grok'],
  ['openclaw', 'OpenClaw', 'openclaw'],
  ['fastclaw', 'FastClaw', 'fastclaw'],
  ['hermes', 'Hermes', 'hermes'],
  ['opencode', 'OpenCode', 'opencode'],
  ['cursor', 'Cursor', 'cursor-agent'],
  ['kimi', 'Kimi', 'kimi'],
  ['omp', 'OMP', 'omp']
] as const

export async function detectLocalAgents(): Promise<LocalAgent[]> {
  return Promise.all(localAgentCatalog.map(async ([id, name, command]) => {
    const path = await resolveExecutable(command)
    return { id, name, command, installed: Boolean(path), path,
      chatSupported: ['claude', 'codex', 'gemini', 'opencode', 'cursor', 'kimi'].includes(id) }
  }))
}

export async function validateLocalAgent(id: string): Promise<LocalAgent> {
  const agent = (await detectLocalAgents()).find((item) => item.id === id)
  if (!agent) throw new Error('Unknown local agent')
  if (!agent.installed) throw new Error(`${agent.name} is not installed. Refresh Agents in Settings after installing it.`)
  if (!agent.chatSupported) throw new Error(`${agent.name} is detected, but its chat adapter is not available yet.`)
  return agent
}
