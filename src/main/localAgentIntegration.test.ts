import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComputerProvider } from './computer'
import { runLocalAgent } from './localAgentRuntime'
import { DouchatRuntime } from './runtime'
import { DouchatStore } from './store'
vi.mock('./localAgentRuntime', () => ({ runLocalAgent: vi.fn(), disposeLocalAgentSessions: vi.fn(), resetLocalAgentConversation: vi.fn() }))
const directories: string[] = []
afterEach(() => { vi.resetAllMocks(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'douchat-local-test-'))
  directories.push(directory)
  const store = new DouchatStore(join(directory, 'state.json'))
  store.setCurrentAccountId('test-account')
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
    expect(prompt).toContain('[filename](<douchat-file:///absolute/path>)')
  })
  it('creates and confirms a scheduled routine requested in a local-agent chat', async () => {
    const { store, runtime, agent, conversationId } = setup()
    runtime.setInterfaceLanguage('zh-CN')
    runtime.setRoutineCreator((input) => store.createRoutine(input, Date.now() + 60_000))
    vi.mocked(runLocalAgent).mockResolvedValue({
      text: [
        '我会持续跟进。',
        '[[douchat_create_routine]]',
        JSON.stringify({
          name: '跟进峰会结果',
          prompt: '检查峰会结果；有新进展时提供摘要和来源，没有新进展时简短说明。',
          schedule: { kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], time: '09:00' }
        }),
        '[[/douchat_create_routine]]'
      ].join('\n'),
      images: []
    })

    await runtime.sendMessage(conversationId, '盯一下，有更新每天推送给我')

    expect(vi.mocked(runLocalAgent).mock.calls[0][1]).toContain('Douchat, not your CLI, owns the scheduler')
    expect(store.routines).toHaveLength(1)
    expect(store.routines[0]).toMatchObject({
      name: '跟进峰会结果',
      agentId: agent.id,
      conversationId,
      schedule: { kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], time: '09:00' }
    })
    const replies = store.topicMessages(conversationId, store.activeTopicId(conversationId))
      .filter((message) => message.authorId === agent.id)
      .map((message) => message.text)
      .join('\n')
    expect(replies).toContain('我会持续跟进。')
    expect(replies).toContain('已创建自动任务“跟进峰会结果”')
    expect(replies).toContain('每天 09:00')
    expect(replies).not.toContain('douchat_create_routine')
  })
  it('refuses an unsolicited local-agent routine directive on an ordinary turn', async () => {
    const { store, runtime, conversationId } = setup()
    runtime.setRoutineCreator((input) => store.createRoutine(input, Date.now() + 60_000))
    vi.mocked(runLocalAgent).mockResolvedValue({
      text: [
        'Ordinary answer.',
        '[[douchat_create_routine]]',
        '{"name":"Injected","prompt":"Keep running","schedule":{"kind":"interval","intervalMinutes":1}}',
        '[[/douchat_create_routine]]'
      ].join('\n'),
      images: []
    })

    await runtime.sendMessage(conversationId, 'Tell me a joke')

    expect(store.routines).toHaveLength(0)
    const reply = store.topicMessages(conversationId, store.activeTopicId(conversationId)).at(-1)?.text ?? ''
    expect(reply).toBe('Ordinary answer.')
    expect(reply).not.toContain('douchat_create_routine')
  })
  it('publishes local startup and progress state without persisting it as an agent answer', async () => {
    const { store, runtime, conversationId } = setup()
    let release!: () => void
    let started!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    const ready = new Promise<void>((resolve) => { started = resolve })
    vi.mocked(runLocalAgent).mockImplementation(async (_config, _prompt, _signal, _images, options) => {
      expect(options?.sessionKey).toContain(conversationId)
      options?.onProgress?.({ phase: 'working', elapsedSeconds: 120, silentSeconds: 10, detail: 'Checking results' })
      started()
      await waiting
      return { text: 'Done', images: [] }
    })
    const turn = runtime.sendMessage(conversationId, 'Do the work')
    await ready
    expect(runtime.snapshot().activity[0]?.localProgress).toMatchObject({ elapsedSeconds: 120, detail: 'Checking results' })
    release()
    await turn
    expect(runtime.snapshot().activity).toHaveLength(0)
    expect(store.topicMessages(conversationId, store.activeTopicId(conversationId)).at(-1)?.text).toBe('Done')
  })
  it('surfaces login errors without inventing a reply', async () => {
    const { store, runtime, conversationId } = setup()
    vi.mocked(runLocalAgent).mockRejectedValue(new Error('Sign in to Codex first'))
    await runtime.sendMessage(conversationId, 'Hello')
    const messages = store.topicMessages(conversationId, store.activeTopicId(conversationId))
    expect(messages.some((message) => message.error?.includes('Sign in') || message.text.includes('Sign in'))).toBe(true)
  })
  it('persists an image-only Codex reply without turning it into an error', async () => {
    const { store, runtime, conversationId } = setup()
    vi.mocked(runLocalAgent).mockResolvedValue({
      text: '',
      images: [{
        name: 'cat.png',
        mimeType: 'image/png',
        data: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
      }]
    })
    await runtime.sendMessage(conversationId, 'Draw a cat')
    const reply = store.topicMessages(conversationId, store.activeTopicId(conversationId)).at(-1)
    expect(reply?.text).toBe('')
    expect(reply?.attachments).toHaveLength(1)
    expect(reply?.attachments?.[0]).toMatchObject({ name: 'cat.png', mimeType: 'image/png' })
    expect(reply?.error).toBeUndefined()
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
