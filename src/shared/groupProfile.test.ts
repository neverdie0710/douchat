import { expect, it } from 'vitest'
import { groupRoutingProfile } from './groupProfile'

it('shares only labelled public capability sections and enabled skill metadata', () => {
  const profile = groupRoutingProfile({ systemFiles: {
    'SOUL.md': 'PERSONAL_PROSE\n## Capabilities\nChinese technical writing\n## Constraints\nNo production deployments\n## Private diary\nPRIVATE_DIARY',
    'IDENTITY.md': '## Role\nEditor', 'TOOLS.md': 'TOKEN_OUTSIDE_SECTION\n## 群聊调度\nCan review SQL\n## Credentials\nSECRET_KEY',
    'USER.md': 'PRIVATE_USER', 'MEMORY.md': 'PRIVATE_MEMORY', 'BOOTSTRAP.md': 'PRIVATE_BOOTSTRAP'
  }, skills: [{ id: 'a', name: 'Audit', enabled: true, content: '---\ndescription: Review schemas\n---\nPRIVATE_SKILL_BODY' },
    { id: 'b', name: 'Disabled', enabled: false, content: 'DISABLED_BODY' }] })
  const text = JSON.stringify(profile)
  expect(text).toContain('Chinese technical writing'); expect(text).toContain('No production deployments'); expect(text).toContain('Can review SQL')
  expect(profile.skills).toEqual([{ name: 'Audit', description: 'Review schemas' }])
  for (const secret of ['PERSONAL_PROSE', 'PRIVATE_', 'SECRET_KEY', 'TOKEN_OUTSIDE_SECTION', 'DISABLED_BODY']) expect(text).not.toContain(secret)
})

it('bounds shared excerpts and never interprets headings inside code blocks', () => {
  const profile = groupRoutingProfile({ systemFiles: { 'SOUL.md': '```\n## Capabilities\nNOT_A_PROFILE\n```\n## Role\n' + 'x'.repeat(10000) } })
  expect(profile.declared[0].text.length).toBeLessThanOrEqual(1200)
  expect(JSON.stringify(profile)).not.toContain('NOT_A_PROFILE')
})

it('understands multiline skill metadata and retains relevant late-listed skills within a fixed budget', () => {
  const skills = Array.from({ length: 49 }, (_, index) => ({ id: `skill${index}`, name: `Generic ${index}`, enabled: true,
    content: '---\ndescription: ' + 'General purpose '.repeat(30) + '\n---\nPRIVATE_IMPLEMENTATION' }))
  skills.push({ id: 'sql', name: 'SQL performance', enabled: true,
    content: '---\ndescription: >-\n  Inspect SQL query plans\n  and optimize indexes.\nversion: 1\n---\nPRIVATE_IMPLEMENTATION' })
  const profile = groupRoutingProfile({ skills }, 'SQL query plans')
  expect(profile.skills[0]).toEqual({ name: 'SQL performance', description: 'Inspect SQL query plans and optimize indexes.' })
  expect(profile.skills.reduce((sum, skill) => sum + skill.name.length + skill.description.length, 0)).toBeLessThanOrEqual(1400)
  expect(profile.omittedSkills).toBeGreaterThan(0)
  expect(JSON.stringify(profile)).not.toContain('PRIVATE_IMPLEMENTATION')
})

it('does not treat shorter or mismatched code fences as the end of an example', () => {
  const profile = groupRoutingProfile({ systemFiles: { 'TOOLS.md': '````markdown\n```\n## Capabilities\nSECRET_EXAMPLE\n~~~\n## Role\nSTILL_IN_EXAMPLE\n````\n## Capabilities\nActual public capability' } })
  expect(JSON.stringify(profile)).not.toContain('SECRET_EXAMPLE')
  expect(JSON.stringify(profile)).not.toContain('STILL_IN_EXAMPLE')
  expect(profile.declared[0].text).toContain('Actual public capability')
})
