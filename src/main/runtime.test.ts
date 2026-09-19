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
  images?: { type: 'image'; data: string; mimeType: string }[]
}

interface DecisionPayload {
  leadMember: { id: string } | null
  members: { id: string }[]
  messages: { id: string; role: string }[]
  completedTurns: { memberId: string }[]
}

interface MessageAgentToolLike {
  execute: (
    toolCallId: string,
    params: { agent: string; message: string }
  ) => Promise<{ content: Array<{ type: string; text: string }> }>
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
  const store = new DouchatStore(join(directory, 'state.json'), { seedDemo: true })
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
    const store = new DouchatStore(join(directory, 'state.json'), { seedDemo: true })
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

  it('retries Cloud model discovery when a signed-in chat is still offline', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'douchat-runtime-retry-'))
    directories.push(directory)
    const store = new DouchatStore(join(directory, 'state.json'), { seedDemo: true })
    const request = vi.fn()
      .mockResolvedValueOnce(Response.json({ object: 'list', data: [] }))
      .mockResolvedValueOnce(Response.json({ object: 'list', data: [{ id: 'cloud-default', object: 'model' }] }))
    vi.stubGlobal('fetch', request)
    const runtime = new DouchatRuntime(store, idleComputer, () => undefined, {
      baseUrl: 'http://localhost:3004/v1',
      resolveAccessToken: () => 'dch_current'
    })

    await runtime.connect()
    expect(runtime.snapshot().runtime.mode).toBe('offline')

    const reconnectable = runtime as unknown as {
      canRunLive: (agent: NonNullable<ReturnType<DouchatStore['agent']>>) => Promise<boolean>
    }
    expect(await reconnectable.canRunLive(store.agent('dobi')!)).toBe(true)
    expect(runtime.snapshot().runtime.mode).toBe('live')
    expect(request).toHaveBeenCalledTimes(2)
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

  it('keeps the incoming private content with the reply source', async () => {
    const { store, runtime } = createRuntime()
    ;(runtime as unknown as { runReply: (options: ReplyOptions) => Promise<{ text: string }> }).runReply = async ({ config }) => (
      config.id === 'dobi'
        ? { text: '[[a2a:lin]]今晚七点半，老地方见。[[/a2a]]' }
        : { text: '好，我会准时到。\n<!-- message_break -->\n七点见。' }
    )

    await runtime.sendMessage('direct-dobi', '邀请 Lin')

    const replies = store.topicMessages('direct-lin', store.activeTopicId('direct-lin'))
    const receivedReplies = replies.filter((message) => message.source?.id === 'dobi')
    expect(receivedReplies[0]).toMatchObject({
      authorId: 'lin',
      text: '好，我会准时到。',
      source: {
        kind: 'bot',
        id: 'dobi',
        content: '今晚七点半，老地方见。'
      }
    })
    const sent = store.topicMessages('direct-dobi', store.activeTopicId('direct-dobi'))
      .find((message) => message.deliveries?.length)
    expect(sent?.deliveries?.[0].replies?.[0]).toMatchObject({
      senderId: 'lin',
      senderName: 'Lin',
      content: '好，我会准时到。'
    })
    expect(sent?.deliveries?.[0].replies).toHaveLength(2)
    expect(new Set(sent?.deliveries?.[0].replies?.map((reply) => reply.replyGroupId))).toEqual(
      new Set([receivedReplies[0]?.replyGroupId])
    )
  })

  it('keeps inline agent handoffs out of the direct-chat transcript', async () => {
    const { store, runtime } = createRuntime()
    const topicId = store.activeTopicId('direct-dobi')
    const internals = runtime as unknown as {
      activeConversation: Map<string, string>
      activeTopic: Map<string, string>
      messageAgentTool: (config: { id: string; name: string }) => MessageAgentToolLike
      runReply: (options: ReplyOptions) => Promise<{ text: string }>
    }
    internals.activeConversation.set('dobi', 'direct-dobi')
    internals.activeTopic.set('dobi', topicId)
    internals.runReply = async ({ config }) => ({ text: `${config.name} internal answer.` })

    const before = store.topicMessages('direct-dobi', topicId)
    const result = await internals.messageAgentTool(store.agent('dobi')!).execute('handoff-1', {
      agent: 'lin',
      message: 'Check this detail.'
    })

    expect(result.content[0]?.text).toBe('Lin replied: Lin internal answer.')
    expect(store.topicMessages('direct-dobi', topicId)).toEqual(before)
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

  it('persists a pasted image and passes its bytes to the model', async () => {
    const { store, runtime } = createRuntime()
    let received: ReplyOptions | undefined
    ;(runtime as unknown as { runReply: (options: ReplyOptions) => Promise<{ text: string }> }).runReply = async (options) => {
      received = options
      return { text: 'I can see it.' }
    }
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])

    await runtime.sendMessage('direct-dobi', '', [{ name: 'clipboard.png', mimeType: 'image/png', data: bytes }])

    const messages = store.topicMessages('direct-dobi', store.activeTopicId('direct-dobi'))
    const user = [...messages].reverse().find((message) => message.authorId === 'user')
    expect(user).toMatchObject({ text: '', attachments: [{ name: 'clipboard.png', mimeType: 'image/png', size: 8 }] })
    expect(await store.attachmentDataUrl(user!.attachments![0].id)).toBe(`data:image/png;base64,${Buffer.from(bytes).toString('base64')}`)
    expect(received?.prompt).toContain('The human sent an image')
    expect(received?.images).toEqual([{ type: 'image', data: Buffer.from(bytes).toString('base64'), mimeType: 'image/png' }])
  })

  it('rejects pasted image batches beyond the safe limit before writing a message', async () => {
    const { store, runtime } = createRuntime()
    const before = store.topicMessages('direct-dobi', store.activeTopicId('direct-dobi')).length
    const image = { name: 'clipboard.png', mimeType: 'image/png' as const, data: Uint8Array.from([1]) }

    await expect(runtime.sendMessage('direct-dobi', '', Array.from({ length: 5 }, () => image))).rejects.toThrow(
      'You can paste up to 4 images at a time.'
    )
    expect(store.topicMessages('direct-dobi', store.activeTopicId('direct-dobi'))).toHaveLength(before)
  })
})
