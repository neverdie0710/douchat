import { expect, it, vi, afterEach } from 'vitest'
import { checkLocalAgentUpdates, compareAgentVersions, latestAgentVersion } from './localAgentUpdates'
import type { LocalAgent } from '../shared/types'

afterEach(() => vi.unstubAllGlobals())
it.each([
  ['codex-cli 0.9.0', '0.10.0', -1], ['2.1.278', '2.1.278', 0],
  ['v2.0.0', '1.9.0', 1], ['1.0.0-beta.2', '1.0.0-beta.10', -1],
  ['1.0.0-beta', '1.0.0', -1], ['1.0.0+local', 'v1.0.0', 0],
  ['unknown', '1.0.0', undefined]
])('compares %s against %s', (a, b, expected) => {
  expect(compareAgentVersions(a, b)).toBe(expected)
})
const agent = (id: string, version?: string): LocalAgent => ({ id, version, name: id, command: id, installed: true, discovered: true, chatSupported: true, status: 'ready', authentication: 'unchecked' })
it('distinguishes updates, current versions and failed checks without losing detection', async () => {
  const latest = vi.fn(async (id: string) => { if (id === 'grok') throw new Error('offline'); return '2.0.0' })
  const result = await checkLocalAgentUpdates([agent('codex', '1.0.0'), agent('claude', '2.0.0'), agent('grok', '1.0.0'), agent('hermes'), { ...agent('custom'), custom: true }, { ...agent('missing'), installed: false }], latest)
  expect(result.map(item => item.updateStatus)).toEqual(['available', 'current', 'unknown', 'unknown', undefined, undefined])
  expect(latest).toHaveBeenCalledTimes(4)
  expect(result[2].installed).toBe(true)
})
it('does not guess ordering of Cursor commits from the same day', async () => {
  const [result] = await checkLocalAgentUpdates([agent('cursor', '2026.09.18-abc123')], async () => '2026.09.18-def456')
  expect(result.updateStatus).toBe('unknown')
})
it('reads package metadata and handles HTTP errors', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ version: '1.2.3' })))
    .mockResolvedValueOnce(new Response('', { status: 503 }))
  vi.stubGlobal('fetch', fetcher)
  expect(await latestAgentVersion('codex')).toBe('1.2.3')
  expect(await latestAgentVersion('claude')).toBeUndefined()
  expect(fetcher.mock.calls[0][0]).toBe('https://registry.npmjs.org/%40openai%2Fcodex/latest')
})
