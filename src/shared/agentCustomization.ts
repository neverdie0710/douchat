export const agentFileNames = ['SOUL.md', 'IDENTITY.md', 'USER.md', 'TOOLS.md', 'BOOTSTRAP.md', 'HEARTBEAT.md', 'MEMORY.md', 'AGENTS.md'] as const
export type AgentFileName = typeof agentFileNames[number]
export type AgentFiles = Partial<Record<AgentFileName, string>>
export interface AgentSkill { id: string; name: string; content: string; enabled: boolean }

export function validateAgentFiles(value: AgentFiles): AgentFiles {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid agent files')
  const result: AgentFiles = {}
  for (const [name, content] of Object.entries(value)) {
    if (!agentFileNames.includes(name as AgentFileName) || typeof content !== 'string' || content.length > 100_000) throw new Error('Invalid agent file or file exceeds 100,000 characters')
    result[name as AgentFileName] = content
  }
  return result
}

export function validateAgentSkills(value: AgentSkill[]): AgentSkill[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error('An agent can have up to 50 skills')
  const ids = new Set<string>()
  return value.map(skill => {
    if (!skill || typeof skill.id !== 'string' || !skill.id || skill.id.length > 100 || ids.has(skill.id)
      || typeof skill.name !== 'string' || !skill.name.trim() || skill.name.length > 100
      || typeof skill.content !== 'string' || skill.content.length > 100_000 || typeof skill.enabled !== 'boolean') throw new Error('Invalid skill or skill exceeds 100,000 characters')
    ids.add(skill.id)
    return { id: skill.id, name: skill.name.trim(), content: skill.content, enabled: skill.enabled }
  })
}

/** Agent-owned instructions apply to both hosted models and local CLI agents. */
export function agentCustomizationPrompt(agent: { systemFiles?: AgentFiles; skills?: AgentSkill[] }): string {
  const files = agentFileNames.filter(name => name !== 'USER.md' && name !== 'MEMORY.md').flatMap(name => agent.systemFiles?.[name]?.trim() ? [`# ${name}\n${agent.systemFiles[name]}`] : [])
  const skills = (agent.skills ?? []).filter(skill => skill.enabled && skill.content.trim()).map(skill => `# Skill: ${skill.name}\n${skill.content}`)
  return [...files, ...skills].join('\n\n')
}
