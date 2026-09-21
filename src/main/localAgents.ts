import type { LocalAgent } from '../shared/types'
import { resolveExecutable } from './shellPath'

// Keep the local CLI catalog aligned with Termany. Every catalog entry has a
// one-shot chat adapter in localAgentRuntime, so any detected executable can
// be selected when creating an agent.
export const localAgentCatalog = [
  ['claude', 'Claude Code', 'claude'],
  ['codex', 'Codex', 'codex'],
  ['gemini', 'Gemini', 'gemini'],
  ['grok', 'Grok Build', 'grok'],
  ['openclaw', 'OpenClaw', 'openclaw'],
  ['hermes', 'Hermes', 'hermes'],
  ['opencode', 'OpenCode', 'opencode'],
  ['cursor', 'Cursor', 'cursor-agent'],
  ['kimi', 'Kimi', 'kimi'],
  ['omp', 'OMP', 'omp'],
  ['fastclaw', 'FastClaw', 'fastclaw']
] as const

export async function detectLocalAgents(): Promise<LocalAgent[]> {
  return Promise.all(localAgentCatalog.map(async ([id, name, command]) => {
    const path = await resolveExecutable(command)
    return { id, name, command, installed: Boolean(path), path, chatSupported: true }
  }))
}

export async function validateLocalAgent(id: string): Promise<LocalAgent> {
  const agent = (await detectLocalAgents()).find((item) => item.id === id)
  if (!agent) throw new Error('Unknown local agent')
  if (!agent.installed) throw new Error(`${agent.name} is not installed. Refresh Agents in Settings after installing it.`)
  return agent
}
