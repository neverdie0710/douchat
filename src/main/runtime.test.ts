import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComputerProvider } from './computer'
import { DouchatRuntime } from './runtime'
import { DouchatStore } from './store'

const directories: string[] = []

const idleComputer: ComputerProvider = {
  snapshots: () => [],
  start: async () => {
    throw new Error('not used')
  },
  stop: async () => undefined,
  show: async () => undefined,
  createTools: () => [],
  dispose: () => undefined
}

interface ReplyOptions {
  config: { id: string; name: string }
  context: 'direct' | 'group' | 'controller'
  prompt: string
}

interface DecisionPayload {
  leadMember: { id: string } | null
  members: { id: string }[]
  messages: { id: string; role: string }[]
  completedTurns: { memberId: string }[]
}

/**
 * The suite covers orchestration — dispatch, mention routing, bubble splitting
 * — not a provider, so every bot answers from a scripted model rather than the
 * network. The controller reads the real dispatch prompt and returns a valid
 * decision: the lead first, then one specialist, then stop.
 */
function stubModel(runtime: DouchatRuntime): void {
  const internals = runtime as unknown as {
    liveAuth: Map<string, boolean>
    runReply: (options: ReplyOptions) => Promise<{ text: string }>
  }
  for (const provider of ['openai', 'anthropic', 'google', 'openrouter', 'deepseek']) {
    internals.liveAuth.set(provider, true)
  }
  internals.runReply = async ({ config, context, prompt }: ReplyOptions) => {
    if (context !== 'controller') {
      return { text: `${config.name} here.\n<!-- message_break -->\nOn it.` }
    }
    const payload = JSON.parse(prompt.slice(prompt.indexOf('{'))) as DecisionPayload
    const stop = { mode: 'none', memberIds: [], triggerMessageIds: [] }
    const latestUser = [...payload.messages].reverse().find((message) => message.role === 'user')
    if (!latestUser) return { text: JSON.stringify(stop) }
    const answered = new Set(payload.completedTurns.map((turn) => turn.memberId))
    const next = answered.size
      ? payload.members.find((member) => !answered.has(member.id))
      : payload.members.find((member) => member.id === payload.leadMember?.id)
    if (!next || answered.size >= 2) return { text: JSON.stringify(stop) }
    return { text: JSON.stringify({ mode: 'single', memberIds: [next.id], triggerMessageIds: [latestUser.id] }) }
  }
}

function createRuntime(): { store: DouchatStore; runtime: DouchatRuntime } {
  const directory = mkdtempSync(join(tmpdir(), 'douchat-runtime-'))
  directories.push(directory)
  const store = new DouchatStore(join(directory, 'state.json'))
  const runtime = new DouchatRuntime(store, idleComputer, () => undefined)
  stubModel(runtime)
  return { store, runtime }
}

afterEach(() => {
  vi.unstubAllGlobals()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('DouchatRuntime', () => {
  it('loads Cloud models with the desktop token and removes them on sign-out', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'douchat-runtime-cloud-'))
    directories.push(directory)
    const store = new DouchatStore(join(directory, 'state.json'))
    let token: string | undefined = 'dch_current'
    const request = vi.fn(async () => Response.json({
      object: 'list',
      data: [{
        id: 'douchat-default',
        display_name: 'Douchat Cloud',
        model_type: 'chat',
        capabilities: ['chat.completions', 'streaming', 'tools']
      }]
    }))
    vi.stubGlobal('fetch', request)
    const runtime = new DouchatRuntime(store, idleComputer, () => undefined, {
      baseUrl: 'http://localhost:3004/v1',
      resolveAccessToken: () => token
    })

    expect(runtime.defaultCloudAgentModel()).toEqual({ provider: 'gateway', model: 'default' })
    await runtime.connect()
    expect(runtime.snapshot().models).toEqual([
      { provider: 'gateway', model: 'douchat-default', label: 'Douchat Cloud · douchat-default' }
    ])
    expect(runtime.defaultCloudAgentModel()).toEqual({ provider: 'gateway', model: 'douchat-default' })
    expect(runtime.snapshot().endpoint).toMatchObject({ source: 'account', hasApiKey: true })

    token = undefined
    await runtime.connect()
    expect(runtime.snapshot().models).toEqual([])
    expect(runtime.defaultCloudAgentModel()).toEqual({ provider: 'gateway', model: 'default' })
    expect(runtime.snapshot().endpoint).toMatchObject({ source: 'account', hasApiKey: false })
    expect(request).toHaveBeenCalledOnce()
  })

  it('runs a group turn with the lead first and splits replies into bubbles', async () => {
    const { store, runtime } = createRuntime()
    const topicId = store.activeTopicId('crew')
    const before = store.topicMessages('crew', topicId).length

    await runtime.sendMessage('crew', 'plan the launch')

    const added = store.topicMessages('crew', topicId).slice(before)
    expect(added[0]).toMatchObject({ authorId: 'user', text: 'plan the launch' })
    const speakers = added.filter((message) => message.authorId !== 'user').map((message) => message.authorId)
    expect(speakers[0]).toBe('dobi')
    expect(new Set(speakers)).toEqual(new Set(['dobi', 'lin']))
    // One model turn becomes several conversational bubbles that share a turn id.
    const dobiBubbles = added.filter((message) => message.authorId === 'dobi')
    expect(dobiBubbles.length).toBeGreaterThan(1)
    expect(new Set(dobiBubbles.map((message) => message.replyGroupId)).size).toBe(1)
  })

  it('routes an @mention to that member only', async () => {
    const { store, runtime } = createRuntime()
    const topicId = store.activeTopicId('crew')
    const before = store.topicMessages('crew', topicId).length

    await runtime.sendMessage('crew', '@Lin take the build pass')

    const added = store.topicMessages('crew', topicId).slice(before)
    expect(added[0].recipients).toEqual([{ id: 'lin', name: 'Lin' }])
    expect(new Set(added.filter((message) => message.authorId !== 'user').map((message) => message.authorId))).toEqual(
      new Set(['lin'])
    )
  })

  it('opens an empty topic with one proactive greeting', async () => {
    const { store, runtime } = createRuntime()
    store.clearConversation('direct-dobi', store.activeTopicId('direct-dobi'))

    await runtime.greet('direct-dobi')

    const messages = store.topicMessages('direct-dobi', store.activeTopicId('direct-dobi'))
    expect(messages).toHaveLength(1)
    expect(messages[0].authorId).toBe('dobi')

    // A topic that already has a transcript is never greeted again.
    await runtime.greet('direct-dobi')
    expect(store.topicMessages('direct-dobi', store.activeTopicId('direct-dobi'))).toHaveLength(1)
  })

  it('keeps each topic transcript separate', async () => {
    const { store, runtime } = createRuntime()
    const first = store.activeTopicId('direct-lin')
    await runtime.sendMessage('direct-lin', 'first task')
    const second = store.createTopic('direct-lin')!
    await runtime.sendMessage('direct-lin', 'second task')

    expect(store.topicMessages('direct-lin', first).some((message) => message.text === 'second task')).toBe(false)
    expect(store.topicMessages('direct-lin', second.id)[0].text).toBe('second task')
  })
})
