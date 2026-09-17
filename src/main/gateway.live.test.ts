import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ComputerProvider } from './computer'
import { DouchatRuntime } from './runtime'
import { DouchatStore } from './store'

/**
 * A real round trip against the configured endpoint. It is skipped unless both
 * gateway variables are exported for the run, so the default suite stays offline:
 *
 *   GATEWAY_BASE_URL=… GATEWAY_API_KEY=… npx vitest run src/main/gateway.live.test.ts
 */
const configured = Boolean(process.env.GATEWAY_BASE_URL && process.env.GATEWAY_API_KEY)

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

function createRuntime(): { store: DouchatStore; runtime: DouchatRuntime } {
  const store = new DouchatStore(join(mkdtempSync(join(tmpdir(), 'douchat-live-')), 'state.json'))
  return { store, runtime: new DouchatRuntime(store, idleComputer, () => undefined) }
}

describe.skipIf(!configured)('gateway (live)', () => {
  it('adopts the endpoint catalog and answers a direct message', async () => {
    const { store, runtime } = createRuntime()
    await runtime.connect()
    const snapshot = runtime.snapshot()
    expect(snapshot.runtime.mode).toBe('live')
    expect(snapshot.models.length).toBeGreaterThan(0)
    // Bots saved against another provider move onto the served catalog.
    expect(store.agent('dobi')?.provider).toBe('gateway')

    await runtime.sendMessage('direct-dobi', 'Say hello in one short sentence.')
    const messages = store.topicMessages('direct-dobi', store.activeTopicId('direct-dobi'))
    expect(messages.some((message) => message.authorId === 'dobi' && message.text.trim())).toBe(true)
  }, 120_000)

  it('connects from in-app settings with no environment variables', async () => {
    const baseUrl = process.env.GATEWAY_BASE_URL!
    const apiKey = process.env.GATEWAY_API_KEY!
    const { store, runtime } = createRuntime()
    delete process.env.GATEWAY_BASE_URL
    delete process.env.GATEWAY_API_KEY
    try {
      await runtime.connect()
      expect(runtime.snapshot().runtime.mode).toBe('offline')

      expect((await runtime.testEndpoint({ baseUrl, apiKey })).ok).toBe(true)
      await runtime.setEndpoint({ baseUrl, apiKey })
      const snapshot = runtime.snapshot()
      expect(snapshot.runtime.mode).toBe('live')
      expect(snapshot.endpoint).toMatchObject({ hasApiKey: true, source: 'settings' })

      await runtime.sendMessage('direct-lin', 'Reply with one short sentence.')
      const messages = store.topicMessages('direct-lin', store.activeTopicId('direct-lin'))
      expect(messages.some((message) => message.authorId === 'lin' && message.text.trim())).toBe(true)
    } finally {
      process.env.GATEWAY_BASE_URL = baseUrl
      process.env.GATEWAY_API_KEY = apiKey
    }
  }, 120_000)

  it('runs a group turn through the dispatch controller', async () => {
    const { store, runtime } = createRuntime()
    await runtime.connect()
    await runtime.sendMessage('crew', 'We need a pricing page for a $19/month tool. Plan it and draft the headline.')
    const topicId = store.activeTopicId('crew')
    const speakers = new Set(
      store
        .topicMessages('crew', topicId)
        .filter((message) => message.authorId !== 'user' && message.kind === 'message')
        .map((message) => message.authorId)
    )
    // The lead always opens the turn; the controller decides who follows.
    expect(speakers.has('dobi')).toBe(true)
  }, 240_000)
})
