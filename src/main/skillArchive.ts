import { randomUUID } from 'node:crypto'
import { readArchiveFiles } from './archiveFiles'
import { parseDocument } from 'yaml'
import { validateAgentSkills, type AgentSkill } from '../shared/agentCustomization'

/** Parse the complete archive before returning any skills; no files are written. */
export async function parseSkillArchive(data: Uint8Array): Promise<AgentSkill[]> {
  return parseSkillFiles(await readArchiveFiles(data))
}

export function parseSkillFiles(archive: Map<string, Buffer>): AgentSkill[] {
  const archivePaths = [...archive.keys()]
  const files = new Map([...archive].map(([path, data]) => [path.toLowerCase(), data]))
  const manifests = archivePaths.filter(path => path === 'SKILL.md' || path.endsWith('/SKILL.md'))
  if (!manifests.length) throw new Error('No SKILL.md found in ZIP.')
  if (manifests.length > 50) throw new Error('An agent can have up to 50 skills.')
  const roots = manifests.map(path => path.slice(0, -'SKILL.md'.length))
  const skills = manifests.map((manifest, index): AgentSkill => {
    const content = new TextDecoder('utf-8', { fatal: true }).decode(files.get(manifest.toLowerCase())!)
    if (content.length > 100_000) throw new Error(`${manifest}: skill exceeds 100,000 characters.`)
    const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
    if (!frontmatter) throw new Error(`${manifest}: YAML name and description are required.`)
    const document = parseDocument(frontmatter[1])
    if (document.errors.length) throw new Error(`${manifest}: invalid YAML frontmatter.`)
    const metadata = document.toJS({ maxAliasCount: 0 })
    if (!metadata || typeof metadata.name !== 'string' || !metadata.name.trim() || metadata.name.length > 100
      || typeof metadata.description !== 'string' || !metadata.description.trim() || metadata.description.length > 5000) {
      throw new Error(`${manifest}: YAML name (up to 100 characters) and description (up to 5,000 characters) are required.`)
    }
    const root = roots[index]
    const resources = archivePaths.filter(path => path !== manifest && path.startsWith(root)
      && !roots.some(other => other !== root && other.startsWith(root) && path.startsWith(other)))
      .map(path => ({ path: path.slice(root.length), data: files.get(path.toLowerCase())!.toString('base64') }))
    return { id: randomUUID(), name: metadata.name.trim(), description: metadata.description.trim(), content, enabled: true, files: resources }
  })
  return validateAgentSkills(skills)
}
