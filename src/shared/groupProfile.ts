import type { AgentConfig } from './types'
import { agentPermissions } from './agentPermissions'

/** Public routing metadata, never an executable system prompt or private memory. */
export interface GroupRoutingProfile {
  declared: { source: string; text: string }[]
  skills: { name: string; description: string }[]
  permissions: ReturnType<typeof agentPermissions>['sensitive']
  /** Actual hosted tool names; omitted when a local adapter cannot enumerate them. */
  tools?: string[]
  runtime: 'local' | 'hosted'
  activeTasks?: number
  omittedSkills?: number
}

// Only deliberately labelled capability/routing sections are shared. Unlabelled
// persona prose and TOOLS.md credentials/paths remain with their owning agent.
const headings = /^(?:group routing|routing|capabilities|specialties|specialities|expertise|responsibilities|constraints|role|群聊调度|调度信息|能力|专长|职责|限制|角色)$/i
function routingSections(text: string): string {
  let level = 0
  const result: string[] = []
  let fence: { character: string; length: number } | undefined
  for (const line of text.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(line)
    if (marker) {
      if (!fence) fence = { character: marker[1][0], length: marker[1].length }
      else if (marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined
      continue
    }
    if (fence) continue
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading) {
      if (headings.test(heading[2])) { level = heading[1].length; result.push(heading[2]); continue }
      if (heading[1].length <= level) level = 0
    }
    if (level) result.push(line)
  }
  return result.join('\n').trim().slice(0, 1200)
}
function skillDescription(content: string): string {
  // Read only the bounded frontmatter, including YAML folded/literal descriptions.
  const frontmatter = /^---\s*\n([\s\S]*?)\n---/.exec(content.slice(0, 8192))?.[1]
  if (!frontmatter) return ''
  const lines = frontmatter.split('\n')
  const index = lines.findIndex(line => /^description:/.test(line))
  if (index < 0) return ''
  const value = lines[index].replace(/^description:\s*/, '').trim()
  if (/^[|>][-+]?\s*$/.test(value)) {
    const parts: string[] = []
    for (const line of lines.slice(index + 1)) {
      if (line.trim() && !/^\s/.test(line)) break
      parts.push(line.trim())
    }
    return parts.join(' ').trim().slice(0, 300)
  }
  return value.replace(/^["']|["']$/g, '').slice(0, 300)
}
export function groupRoutingProfile(agent: Pick<AgentConfig, 'systemFiles' | 'skills' | 'permissions' | 'localAgentId'>, task = ''): GroupRoutingProfile {
  const declared: GroupRoutingProfile['declared'] = []
  let declarationBudget = 2600
  for (const source of ['IDENTITY.md', 'SOUL.md', 'AGENTS.md', 'TOOLS.md'] as const) {
    const text = routingSections(agent.systemFiles?.[source] ?? '').slice(0, declarationBudget)
    if (text) { declared.push({ source, text }); declarationBudget -= text.length }
  }
  const words = [...new Set([...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(task.normalize('NFKC').toLowerCase())]
    .filter(word => word.isWordLike).map(word => word.segment))]
  const candidates = (agent.skills ?? []).filter(skill => skill.enabled && skill.content.trim()).map(skill => ({
    name: skill.name.slice(0, 100), description: skillDescription(skill.content)
  }))
  const relevance = (skill: { name: string; description: string }) => {
    const text = `${skill.name} ${skill.description}`.normalize('NFKC').toLowerCase()
    return words.filter(word => text.includes(word)).length
  }
  // Only presentation order is ranked here; the decision model still elects and
  // assigns. Late-listed relevant skills must survive the shared context budget.
  candidates.sort((a, b) => relevance(b) - relevance(a))
  let skillBudget = 1400
  const skills: GroupRoutingProfile['skills'] = []
  for (const skill of candidates) {
    if (skill.name.length > skillBudget) continue
    const description = skill.description.slice(0, Math.max(0, skillBudget - skill.name.length))
    skills.push({ name: skill.name, description })
    skillBudget -= skill.name.length + description.length
  }
  return { declared, skills,
    ...(skills.length < candidates.length ? { omittedSkills: candidates.length - skills.length } : {}),
    permissions: agentPermissions(agent.permissions).sensitive,
    runtime: agent.localAgentId ? 'local' : 'hosted'
  }
}
