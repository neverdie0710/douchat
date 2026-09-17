import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultProviderAuthContext } from '@earendil-works/pi-ai'
import { fetchGatewayModels, gatewayProvider, type GatewayConfig } from './gateway'

const modelList = {
  object: 'list',
  data: [
    {
      id: 'douchat-default',
      object: 'model',
      display_name: 'Douchat Cloud',
      model_type: 'chat',
      capabilities: ['chat.completions', 'streaming', 'tools']
    }
  ]
}

afterEach(() => vi.unstubAllGlobals())

describe('Douchat Cloud gateway', () => {
  it('uses the current desktop token to load the /v1 model catalog', async () => {
    let token = 'dch_first'
    const request = vi.fn(async () => Response.json(modelList))
    vi.stubGlobal('fetch', request)
    const config: GatewayConfig = {
      baseUrl: 'http://localhost:3004/v1',
      resolveApiKey: () => token,
      authName: 'Douchat account',
      authSource: 'desktop session'
    }

    const models = await fetchGatewayModels(config)
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({ id: 'douchat-default', provider: 'gateway' })
    expect(request).toHaveBeenCalledWith('http://localhost:3004/v1/models', {
      headers: { Authorization: 'Bearer dch_first' },
      signal: undefined
    })

    const provider = gatewayProvider(models, config)
    token = 'dch_second'
    const resolved = await provider.auth.apiKey?.resolve({
      ctx: defaultProviderAuthContext(),
      signal: new AbortController().signal
    })
    expect(resolved).toEqual({ auth: { apiKey: 'dch_second' }, source: 'desktop session' })
  })

  it('invalidates the desktop session when the model API returns 401', async () => {
    const onUnauthorized = vi.fn(async () => undefined)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: { message: 'Invalid or expired Douchat access token.' }
    }, { status: 401 })))

    await expect(fetchGatewayModels({
      baseUrl: 'https://douchat.ai/v1',
      resolveApiKey: () => 'dch_expired',
      onUnauthorized
    })).rejects.toThrow('Invalid or expired Douchat access token.')
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })
})
