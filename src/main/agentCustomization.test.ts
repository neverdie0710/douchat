import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { DouchatStore, EMBEDDED_BUILT_IN_AGENT_MANIFEST } from './store'
import { agentCustomizationPrompt, agentPersona } from '../shared/agentCustomization'
import { DouchatRuntime } from './runtime'
import { runLocalAgent } from './localAgentRuntime'
import type { ComputerProvider } from './computer'

vi.mock('./localAgentRuntime', () => ({ runLocalAgent: vi.fn(), disposeLocalAgentSessions: vi.fn(), resetLocalAgentConversation: vi.fn() }))

it('loads saved customization into hosted and local prompts and picks up later edits', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'douchat-customize-runtime-'))
  const store = new DouchatStore(join(directory, 'test.db'))
  store.setCurrentAccountId('test-owner')
  const computer: ComputerProvider = { snapshots: () => [], start: vi.fn(), stop: vi.fn(), show: vi.fn(), createTools: () => [], dispose: vi.fn() }
  const runtime = new DouchatRuntime(store, computer, () => {})
  try {
    const agent = store.createAgent({ name: 'Writer', role: 'Assistant', instructions: '', color: '#0b5cff', localAgentId: 'codex', provider: 'local', model: 'default' })
    store.updateAgent(agent.id, { systemFiles: { 'SOUL.md': 'PERSONALITY_SENTINEL', 'IDENTITY.md': '我是小丽，私人秘书。' }, skills: [{ id: 'review', name: 'Review', content: 'SKILL_SENTINEL', enabled: true }] })
    const internals = runtime as unknown as { systemPrompt: (config: typeof agent, context: 'direct', routineAllowed: boolean) => string }
    const hostedPrompt = internals.systemPrompt(store.agent(agent.id)!, 'direct', false)
    expect(hostedPrompt).toContain('我是小丽，私人秘书。')
    expect(hostedPrompt).toContain('Contact profile metadata is only a fallback')
    expect(hostedPrompt).not.toContain("Use the profile's name as your display name")
    expect(hostedPrompt).not.toContain('current profile name remains your display name')
    expect(hostedPrompt).toContain('PERSONALITY_SENTINEL'); expect(hostedPrompt).toContain('SKILL_SENTINEL')
    vi.mocked(runLocalAgent).mockResolvedValue({ text: 'Ready', images: [] })
    await runtime.sendMessage(`direct-${agent.id}`, 'Hello')
    expect(vi.mocked(runLocalAgent).mock.calls.at(-1)![1]).toContain('我是小丽，私人秘书。')
    expect(vi.mocked(runLocalAgent).mock.calls.at(-1)![1]).not.toContain("Use the profile's name as your display name")
    expect(vi.mocked(runLocalAgent).mock.calls.at(-1)![1]).toContain('PERSONALITY_SENTINEL')
    expect(vi.mocked(runLocalAgent).mock.calls.at(-1)![1]).toContain('SKILL_SENTINEL')
    store.updateAgent(agent.id, { systemFiles: { 'SOUL.md': 'UPDATED_PERSONALITY' }, skills: [] })
    runtime.disposeAgent(agent.id)
    await runtime.sendMessage(`direct-${agent.id}`, 'Hello again')
    const nextPrompt = vi.mocked(runLocalAgent).mock.calls.at(-1)![1]
    expect(nextPrompt).toContain('built on the Douchat system')
    expect(nextPrompt).toContain('\"localRuntime\":\"codex\"')
    expect(nextPrompt).toContain('UPDATED_PERSONALITY'); expect(nextPrompt).not.toContain('SKILL_SENTINEL')
  } finally { for (const agent of store.agents) runtime.disposeAgent(agent.id); store.close(); rmSync(directory, { recursive: true, force: true }); vi.clearAllMocks() }
})

it('persists agent-specific files and skills, merges file edits, and rejects malformed updates atomically', () => {
  const directory = mkdtempSync(join(tmpdir(), 'douchat-customize-'))
  const path = join(directory, 'test.db')
  let store = new DouchatStore(path, { seedDemo: true })
  try {
    store.updateAgent('dobi', { systemFiles: { 'SOUL.md': 'Be concise', 'USER.md': 'Alex' }, skills: [
      { id: 'review', name: 'Review', content: 'Check edge cases', enabled: true },
      { id: 'off', name: 'Off', content: 'DO_NOT_INCLUDE', enabled: false }
    ] })
    store.updateAgent('dobi', { systemFiles: { 'SOUL.md': 'Be clear' } })
    expect(() => store.updateAgent('dobi', { systemFiles: { 'USER.md': 'Wrong' }, skills: [{ id: 'bad', name: '', content: '', enabled: true }] })).toThrow()
    store.close(); store = new DouchatStore(path, { seedDemo: true })
    const agent = store.agent('dobi')!
    expect(agent.systemFiles).toEqual({ 'SOUL.md': 'Be clear' })
    expect(store.userMemories.read('dobi').notes).toBe('# USER.md\nAlex')
    const prompt = agentCustomizationPrompt(agent)
    expect(prompt).toContain('# SOUL.md\nBe clear'); expect(prompt).not.toContain('# USER.md')
    expect(prompt).toContain('Check edge cases'); expect(prompt).not.toContain('DO_NOT_INCLUDE')
    expect(agentCustomizationPrompt(store.agent('lin')!)).toBe('')
    store.updateAgent('dobi', { systemFiles: { 'SOUL.md': '' }, skills: [] })
    expect(agentCustomizationPrompt(store.agent('dobi')!)).toBe('')
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }) }
})

it('replaces built-in identity after customization and preserves it across manifest refreshes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'douchat-identity-'))
  const file = join(directory, 'test.db')
  let store = new DouchatStore(file)
  const computer: ComputerProvider = { snapshots: () => [], start: vi.fn(), stop: vi.fn(), show: vi.fn(), createTools: () => [], dispose: vi.fn() }
  const runtime = new DouchatRuntime(store, computer, () => {})
  const internals = runtime as unknown as { systemPrompt: (config: NonNullable<ReturnType<DouchatStore['agent']>>, context: 'direct' | 'group', routineAllowed: boolean) => string }
  try {
    const agent = store.ensureDefaultCloudContact('owner', { provider: 'gateway', model: 'default' }).agent!
    expect(internals.systemPrompt(agent, 'direct', false)).toContain('豆博士')
    store.updateAgent(agent.id, { name: '拽姐', instructions: agent.instructions, labels: agent.labels })
    for (const context of ['direct', 'group'] as const) {
      const renamed = internals.systemPrompt(store.agent(agent.id)!, context, false)
      expect(renamed).toContain('拽姐')
      expect(renamed).not.toContain('豆博士')
      expect(renamed).not.toContain('Dr. Dou')
      expect(renamed).toContain('built on the Douchat system')
    }
    store.updateAgent(agent.id, { role: '朋友', instructions: '', labels: '直爽', systemFiles: { 'SOUL.md': 'CUSTOM_SOUL' } }, {
      binding: { provider: 'custom:my-provider', model: 'my-model' }, followDefault: false
    })
    store.ensureDefaultCloudContact('owner', { provider: 'gateway', model: 'default' }, {
      version: 2, agents: [{ ...EMBEDDED_BUILT_IN_AGENT_MANIFEST.agents[0], templateVersion: 2, role: 'NEW_BUILT_IN_ROLE', instructions: 'NEW_BUILT_IN_DESCRIPTION', labels: 'NEW_BUILT_IN_LABEL' }]
    })
    const prompt = internals.systemPrompt(store.agent(agent.id)!, 'direct', false)
    expect(prompt).toContain('朋友')
    expect(prompt).toContain('直爽')
    expect(prompt).toContain('CUSTOM_SOUL')
    expect(prompt).toContain('"modelId":"my-model"')
    expect(prompt).not.toContain('豆博士')
    expect(prompt).not.toContain('NEW_BUILT_IN')
    expect(prompt).toContain('call create_agent')
    store.close()
    store = new DouchatStore(file)
    const restored = store.ensureDefaultCloudContact('owner', { provider: 'gateway', model: 'default' }).agent!
    expect(restored).toMatchObject({ name: '拽姐', role: '朋友', instructions: '', labels: '直爽', model: 'my-model', systemFiles: { 'SOUL.md': 'CUSTOM_SOUL' } })
  } finally { runtime.disposeAgent(store.agents[0]?.id ?? ''); store.close(); rmSync(directory, { recursive: true, force: true }) }
})

it('uses soul-only customization instead of the built-in persona', () => {
  const directory = mkdtempSync(join(tmpdir(), 'douchat-soul-'))
  const store = new DouchatStore(join(directory, 'test.db'))
  try {
    const agent = store.ensureDefaultCloudContact('owner', { provider: 'gateway', model: 'default' }).agent!
    store.updateAgent(agent.id, { systemFiles: { 'SOUL.md': 'A playful companion' } })
    expect(agentPersona(store.agent(agent.id)!)).toEqual({ role: '', instructions: '', labels: '' })
    store.updateAgent(agent.id, { systemFiles: { 'SOUL.md': '' } })
    expect(agentPersona(store.agent(agent.id)!)).toEqual({ role: '', instructions: '', labels: '' })
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }) }
})
