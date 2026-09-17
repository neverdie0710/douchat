import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComputerProvider } from './computer'
import { runLocalAgent } from './localAgentRuntime'
import { DouchatRuntime } from './runtime'
import { DouchatStore } from './store'
vi.mock('./localAgentRuntime', () => ({ runLocalAgent: vi.fn() }))
const directories: string[] = []
afterEach(() => { vi.resetAllMocks(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'douchat-local-test-'))
  directories.push(directory)
  const store = new DouchatStore(join(directory, 'state.json'))
  const computer: ComputerProvider = { snapshots: () => [], start: vi.fn(), stop: vi.fn(), show: vi.fn(), createTools: () => [], dispose: vi.fn() }
  const runtime = new DouchatRuntime(store, computer, () => {})
  const agent = store.createAgent({ name: 'Local researcher', role: 'Researcher', instructions: 'Find evidence', color: '#14B8A6', localAgentId: 'codex', provider: 'local', model: 'default' })
  return { store, runtime, agent, conversationId: `direct-${agent.id}` }
}
describe('local contact routing', () => {
  it('calls the local CLI without endpoint auth and isolates topic history', async () => {
    const { store, runtime, conversationId } = setup()
    vi.mocked(runLocalAgent).mockResolvedValue({ text: 'Local reply', images: [] })
    await runtime.sendMessage(conversationId, 'Remember first topic')
    expect(runLocalAgent).toHaveBeenCalledOnce()
    expect(store.topicMessages(conversationId, store.activeTopicId(conversationId)).at(-1)?.text).toBe('Local reply')
    store.createTopic(conversationId)
    await runtime.sendMessage(conversationId, 'Second topic')
    const prompt = vi.mocked(runLocalAgent).mock.calls[1][1]
    expect(prompt).toContain('Second topic')
    expect(prompt).not.toContain('Remember first topic')
  })
  it('surfaces login errors without inventing a reply', async () => {
    const { store, runtime, conversationId } = setup()
    vi.mocked(runLocalAgent).mockRejectedValue(new Error('Sign in to Codex first'))
    await runtime.sendMessage(conversationId, 'Hello')
    const messages = store.topicMessages(conversationId, store.activeTopicId(conversationId))
    expect(messages.some((message) => message.error?.includes('Sign in') || message.text.includes('Sign in'))).toBe(true)
  })
  it('forwards Stop to the running local process', async () => {
    const { runtime, conversationId } = setup()
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    vi.mocked(runLocalAgent).mockImplementation(async (_config, _prompt, signal) => {
      started()
      return new Promise<never>((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('Stopped')), { once: true }))
    })
    const turn = runtime.sendMessage(conversationId, 'Wait')
    await ready
    runtime.stopConversation(conversationId)
    await turn
    expect(vi.mocked(runLocalAgent).mock.calls[0][2]?.aborted).toBe(true)
  })
})
