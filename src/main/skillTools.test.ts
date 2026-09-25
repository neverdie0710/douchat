import { describe, expect, it } from 'vitest'
import { createSkillTools } from './skillTools'
import { skillResourcePrompt } from '../shared/skillResources'
import type { AgentSkill } from '../shared/agentCustomization'

const encoded = (path: string, content: string) => ({ path, data: Buffer.from(content).toString('base64') })
const initial = (): AgentSkill[] => [{ id: 'growth', name: 'Growth', content: '# Routing', enabled: true, files: [encoded('references/value.md', '价值\n参考\n原文'), encoded('scripts/run.py', 'print("hello")'), { path: 'image.png', data: 'AP8=' }] }]
function setup() {
  let skills = initial()
  const [list, read] = createSkillTools(() => skills)
  const call = async (tool: typeof read, args: object) => {
    const part = (await tool.execute('call', args)).content[0]
    if (part.type !== 'text') throw new Error('Expected text tool result')
    return JSON.parse(part.text)
  }
  return { list: (args = {}) => call(list, args), read: (args: object) => call(read, args), replace: (value: AgentSkill[]) => { skills = value } }
}
describe('skill package tools', () => {
  it('discovers enabled skills and reads Markdown or script source with resumable ranges', async () => {
    const tools = setup()
    expect((await tools.list()).skills[0].id).toBe('growth')
    expect((await tools.list({ skillId: 'growth' })).files).toEqual(['SKILL.md', 'references/value.md', 'scripts/run.py', 'image.png'])
    expect((await tools.read({ skillId: 'growth', path: 'SKILL.md' })).content).toBe('# Routing')
    const first = await tools.read({ skillId: 'growth', path: 'references/value.md', limit: 3 })
    const rest = await tools.read({ skillId: 'growth', path: 'references/value.md', offset: first.nextOffset })
    expect(first.content + rest.content).toBe('价值\n参考\n原文')
    expect(rest.nextOffset).toBeNull()
    expect((await tools.read({ skillId: 'growth', path: 'scripts/run.py' })).content).toBe('print("hello")')
  })
  it('rejects traversal, other skills, missing/binary files and invalid ranges', async () => {
    const tools = setup()
    for (const path of ['../secret', '/etc/passwd', 'references/../value.md', 'references\\value.md', 'missing.md', 'image.png']) {
      await expect(tools.read({ skillId: 'growth', path })).rejects.toThrow()
    }
    await expect(tools.read({ skillId: 'another-agent-skill', path: 'SKILL.md' })).rejects.toThrow('not found')
    await expect(tools.read({ skillId: 'growth', path: 'SKILL.md', offset: -1 })).rejects.toThrow('range')
    await expect(tools.read({ skillId: 'growth', path: 'SKILL.md', limit: 20001 })).rejects.toThrow('range')
  })
  it('checks current configuration on every read, including disabling and replacement', async () => {
    const tools = setup()
    tools.replace([{ ...initial()[0], enabled: false }])
    expect((await tools.list()).skills).toEqual([])
    await expect(tools.read({ skillId: 'growth', path: 'SKILL.md' })).rejects.toThrow('not found')
    tools.replace([{ ...initial()[0], content: 'Updated' }])
    expect((await tools.read({ skillId: 'growth', path: 'SKILL.md' })).content).toBe('Updated')
    tools.replace([])
    await expect(tools.list({ skillId: 'growth' })).rejects.toThrow('not found')
  })
  it('paginates file discovery and rejects malformed or oversized text', async () => {
    const tools = setup()
    tools.replace([{ ...initial()[0], files: Array.from({ length: 105 }, (_, n) => encoded(`references/${n}.md`, 'text')) }])
    const first = await tools.list({ skillId: 'growth' })
    expect(first.files).toHaveLength(100)
    expect((await tools.list({ skillId: 'growth', offset: first.nextOffset })).files).toHaveLength(6)
    tools.replace([{ ...initial()[0], files: [{ path: 'invalid.md', data: '/w==' }, encoded('large.md', 'a'.repeat(2_000_001))] }])
    await expect(tools.read({ skillId: 'growth', path: 'invalid.md' })).rejects.toThrow('UTF-8')
    await expect(tools.read({ skillId: 'growth', path: 'large.md' })).rejects.toThrow('2 MB')
  })
  it('honors cancellation and current-account failures', async () => {
    const signal = AbortSignal.abort()
    const tools = createSkillTools(() => { throw new Error('account changed') })
    await expect(tools[1].execute('call', { skillId: 'growth', path: 'SKILL.md' })).rejects.toThrow('account changed')
    await expect(tools[0].execute('call', {}, signal)).rejects.toThrow()
  })
  it('provides distinct hosted and native reading guidance only for enabled skills', () => {
    expect(skillResourcePrompt({ skills: [] }, false)).toBe('')
    expect(skillResourcePrompt({ skills: initial() }, false)).toContain('read_skill_file with that ID')
    expect(skillResourcePrompt({ skills: initial() }, true)).toContain('native file-reading tools')
    expect(skillResourcePrompt({ skills: initial() }, false)).toContain('BEFORE')
  })
})
