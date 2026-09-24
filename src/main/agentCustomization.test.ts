import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { DouchatStore } from './store'
import { agentCustomizationPrompt } from '../shared/agentCustomization'
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
    store.updateAgent(agent.id, { systemFiles: { 'SOUL.md': 'PERSONALITY_SENTINEL' }, skills: [{ id: 'review', name: 'Review', content: 'SKILL_SENTINEL', enabled: true }] })
    const internals = runtime as unknown as { systemPrompt: (config: typeof agent, context: 'direct', routineAllowed: boolean) => string }
    const hostedPrompt = internals.systemPrompt(store.agent(agent.id)!, 'direct', false)
    expect(hostedPrompt).toContain('PERSONALITY_SENTINEL'); expect(hostedPrompt).toContain('SKILL_SENTINEL')
    vi.mocked(runLocalAgent).mockResolvedValue({ text: 'Ready', images: [] })
    await runtime.sendMessage(`direct-${agent.id}`, 'Hello')
    expect(vi.mocked(runLocalAgent).mock.calls.at(-1)![1]).toContain('PERSONALITY_SENTINEL')
    expect(vi.mocked(runLocalAgent).mock.calls.at(-1)![1]).toContain('SKILL_SENTINEL')
    store.updateAgent(agent.id, { systemFiles: { 'SOUL.md': 'UPDATED_PERSONALITY' }, skills: [] })
    runtime.disposeAgent(agent.id)
    await runtime.sendMessage(`direct-${agent.id}`, 'Hello again')
    const nextPrompt = vi.mocked(runLocalAgent).mock.calls.at(-1)![1]
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
