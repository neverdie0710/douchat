import { expect, it, vi } from 'vitest'
import { CloudDecisionClient } from './cloudDecision'
import { GroupDecisionService } from './groupDecision'
import { CLOUD_DECISION_PROVIDER_ID, validateDecisionSettings } from '../shared/groupDecision'

const model = { id: 'cloud-decision', name: 'Cloud Decision', protocol: 'jev', creditsPerRequest: 2 }
it('loads only public model metadata and resolves the current account token for each call', async () => {
  let token = 'test-account-one'
  const request = vi.fn<typeof fetch>(async () => Response.json({ code: 0, data: [{ ...model, apiKey: 'must-not-reach-renderer' }] }))
  const client = new CloudDecisionClient({ baseUrl: 'https://douchat.test/v1', resolveAccessToken: () => token }, request)
  expect(await client.models()).toEqual([model])
  token = 'test-account-two'
  const provider = await client.provider()
  expect(provider.apiKey).toBe('test-account-two')
  expect(provider.cloud).toMatchObject({ protocol: 'jev', endpoint: 'https://douchat.test/v1/decisions/completions' })
  expect(request.mock.calls.at(-1)?.[1]?.headers).toEqual({ Authorization: 'Bearer test-account-two' })
  expect(validateDecisionSettings({ mode: 'model', providerId: CLOUD_DECISION_PROVIDER_ID, model: model.id }).providerId).toBe(CLOUD_DECISION_PROVIDER_ID)
})

it('rejects revoked sessions, unavailable models and an account switch during catalog loading', async () => {
  const unauthorized = vi.fn()
  const client = new CloudDecisionClient({ baseUrl: 'https://douchat.test/v1', resolveAccessToken: () => 'token', onUnauthorized: unauthorized }, async () => Response.json({ code: -1, message: 'Unauthorized' }, { status: 401 }))
  await expect(client.models()).rejects.toThrow('Unauthorized')
  expect(unauthorized).toHaveBeenCalledOnce()
  const empty = new CloudDecisionClient({ baseUrl: 'https://douchat.test/v1', resolveAccessToken: () => 'token' }, async () => Response.json({ code: 0, data: [] }))
  await expect(empty.provider()).rejects.toThrow('unavailable')
  let token = 'first'
  const switched = new CloudDecisionClient({ baseUrl: 'https://douchat.test/v1', resolveAccessToken: () => token }, async () => { token = 'second'; return Response.json({ code: 0, data: [model] }) })
  await expect(switched.provider()).rejects.toThrow('sign-in session changed')
})

it('uses Jev for the currently published cloud model and sends only System One parameters', async () => {
  const client = new CloudDecisionClient({ baseUrl: 'https://douchat.test/v1', resolveAccessToken: () => 'desktop-token' }, async () => Response.json({ code: 0, data: [model] }))
  const provider = await client.provider()
  const request = vi.fn<typeof fetch>(async () => Response.json({ code: 0, data: { model: model.id, answers: { test: { type: 'noul', noul: 1 } }, usage: { input_tokens: 10, output_tokens: 1 } } }))
  await new GroupDecisionService(request).test({ mode: 'model', providerId: CLOUD_DECISION_PROVIDER_ID, model: 'stale-model' }, provider, new AbortController().signal)
  expect(request.mock.calls[0][0]).toBe('https://douchat.test/v1/decisions/completions')
  const init = request.mock.calls[0][1]!
  expect(init.redirect).toBe('error')
  expect(init.headers).toMatchObject({ Authorization: 'Bearer desktop-token', 'Idempotency-Key': expect.any(String) })
  const payload = JSON.parse(init.body as string)
  expect(Object.keys(payload).sort()).toEqual(['model', 'questions', 'state'])
  expect(payload.model).toBe(model.id)
  expect(payload.questions.test.type).toBe('noul')
})

it('ignores non-Jev cloud models', async () => {
  const client = new CloudDecisionClient({ baseUrl: 'https://douchat.test/v1', resolveAccessToken: () => 'token' }, async () => Response.json({ code: 0, data: [{ ...model, protocol: 'chat' }] }))
  expect(await client.models()).toEqual([])
})

it.each([
  [402, 'Douchat credits 不足，请充值后重试。'],
  [502, 'Decision service unavailable.'],
] as const)('preserves cloud test failures for HTTP %s', async (status, message) => {
  const client = new CloudDecisionClient({ baseUrl: 'https://douchat.test/v1', resolveAccessToken: () => 'token' }, async () => Response.json({ code: 0, data: [model] }))
  const provider = await client.provider()
  const request = vi.fn<typeof fetch>(async () => Response.json({ code: -1, message }, { status }))
  await expect(new GroupDecisionService(request).test({ mode: 'model', providerId: CLOUD_DECISION_PROVIDER_ID, model: '' }, provider, new AbortController().signal)).rejects.toThrow(message)
  expect(request).toHaveBeenCalledOnce()
})
