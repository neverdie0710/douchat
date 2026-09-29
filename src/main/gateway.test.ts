import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultProviderAuthContext } from '@earendil-works/pi-ai'
import { fetchGatewayModels, gatewayProvider, gatewayOutputPayload, type GatewayConfig } from './gateway'

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
  it('does not send the SDK’s invented 8192-token cap for an opaque gateway model', () => {
    const payload = { model: 'douchat-default', max_tokens: 8192, max_completion_tokens: 8192, messages: [], tools: [{ name: 'create_file' }] }
    expect(gatewayOutputPayload(payload)).toEqual({ model: 'douchat-default', messages: [], tools: [{ name: 'create_file' }] })
    expect(gatewayOutputPayload(payload, 32768)).toMatchObject({ max_tokens: 32768 })
    expect(gatewayOutputPayload(payload, 4096, 'max_completion_tokens')).toMatchObject({ max_completion_tokens: 4096 })
  })

  it('retains the gateway’s published output limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ id: 'published-model', max_output_tokens: 32768 }] })))
    const models = await fetchGatewayModels({ baseUrl: 'https://fixture.invalid/v1', apiKey: 'test' })
    expect(models[0]).toMatchObject({ maxTokens: 32768, gatewayOutputLimit: 32768 })
  })

  it('uses the current desktop token to load the /v1 model catalog', async () => {
    let token = 'dch_first'
    const request = vi.fn(async () => Response.json(modelList))
    vi.stubGlobal('fetch', request)
    const config: GatewayConfig = {
      baseUrl: 'http://localhost:3004/v1',
      resolveApiKey: () => token,
      authName: 'Douchat account',
      authSource: 'desktop session',
      assumeImageInput: true
    }

    const models = await fetchGatewayModels(config)
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({ id: 'douchat-default', provider: 'gateway' })
    expect(models[0].input).toEqual(['text', 'image'])
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

  it('recognizes explicit multimodal capabilities on custom endpoints', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      data: [{ id: 'custom-chat', model_type: 'chat', capabilities: ['chat.completions', 'multimodal'] }]
    })))

    const models = await fetchGatewayModels({ baseUrl: 'http://localhost:3004/v1', apiKey: 'test' })

    expect(models[0].input).toEqual(['text', 'image'])
  })

  it('accepts a standard OpenAI model catalog without Douchat metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      object: 'list',
      data: [{ id: 'gpt-compatible', object: 'model', owned_by: 'gateway' }]
    })))

    const models = await fetchGatewayModels({ baseUrl: 'http://localhost:3004/v1', apiKey: 'test' })

    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({ id: 'gpt-compatible', provider: 'gateway', input: ['text'] })
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
