import { expect, it, vi } from 'vitest'
import { Type } from '@earendil-works/pi-ai'
import { openLocalSkillBridge } from './localSkillBridge'
it('scopes local calls to the turn token and closes the endpoint after the turn', async () => {
  const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }], details: {} }))
  const stop = new AbortController()
  const bridge = await openLocalSkillBridge([{ name: 'search_skills', label: 'Search', description: '', parameters: Type.Object({}), execute }], stop.signal)
  const url = /Endpoint: (.+)/.exec(bridge.prompt)![1]
  const authorization = /Authorization: (.+)/.exec(bridge.prompt)![1]
  try {
    expect((await fetch(url, { method: 'POST', body: '{}' })).status).toBe(403)
    expect((await fetch(url, { method: 'POST', headers: { authorization, origin: 'https://example.com' }, body: '{}' })).status).toBe(403)
    expect(execute).not.toHaveBeenCalled()
    const response = await fetch(url, { method: 'POST', headers: { authorization }, body: JSON.stringify({ tool: 'search_skills', arguments: {} }) })
    expect(response.status).toBe(200)
    expect(execute).toHaveBeenCalledOnce()
    stop.abort()
    await expect(fetch(url, { method: 'POST', headers: { authorization } })).rejects.toThrow()
  } finally { bridge.close() }
})
