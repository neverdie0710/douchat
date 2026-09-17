import { createProvider, type ApiKeyAuth, type Model, type Provider } from '@earendil-works/pi-ai'
import { stream, streamSimple } from '@earendil-works/pi-ai/api/openai-completions'

export const GATEWAY_PROVIDER_ID = 'gateway'
export const GATEWAY_PROVIDER_NAME = 'Gateway'
const API_KEY_ENV = ['GATEWAY_API_KEY']
const BASE_URL_ENV = ['GATEWAY_BASE_URL', 'GATEWAY_API_BASE_URL']

export interface GatewayConfig {
  baseUrl: string
  /** Static credentials are retained only for the optional custom-endpoint path. */
  apiKey?: string
  /** First-party Cloud Chat resolves the encrypted desktop token per request. */
  resolveApiKey?: () => string | undefined | Promise<string | undefined>
  authName?: string
  authSource?: string
  providerName?: string
  onUnauthorized?: () => void | Promise<void>
}

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

/** Settings saved in the app win; `.env` stays available for scripted setups. */
export function gatewayEnvConfig(): GatewayConfig {
  return {
    baseUrl: normalizeBaseUrl(BASE_URL_ENV.map((name) => process.env[name]?.trim()).find(Boolean) ?? ''),
    apiKey: API_KEY_ENV.map((name) => process.env[name]?.trim()).find(Boolean) ?? ''
  }
}

/** Both halves are needed: a base URL alone cannot answer. */
export function isGatewayConfig(config: GatewayConfig | undefined): boolean {
  return Boolean(config?.baseUrl && (config.apiKey || config.resolveApiKey))
}

async function gatewayApiKey(config: GatewayConfig): Promise<string> {
  const dynamic = await config.resolveApiKey?.()
  return dynamic?.trim() || config.apiKey?.trim() || ''
}

async function notifyUnauthorized(config: GatewayConfig, response: Response): Promise<void> {
  if (response.status === 401) await config.onUnauthorized?.()
}

interface GatewayModelEntry {
  id?: unknown
  display_name?: unknown
  model_type?: unknown
  capabilities?: unknown
}

/** Only chat models can back a bot; the same endpoint also lists image,
 * video, audio and music models. */
function chatModels(payload: unknown, baseUrl: string): Model<'openai-completions'>[] {
  const data = (payload as { data?: unknown })?.data
  if (!Array.isArray(data)) return []
  return data.flatMap((entry: GatewayModelEntry) => {
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    const capabilities = Array.isArray(entry.capabilities) ? entry.capabilities : []
    const chat = entry.model_type === 'chat' || capabilities.includes('chat.completions')
    if (!id || !chat) return []
    const name = typeof entry.display_name === 'string' && entry.display_name.trim() ? entry.display_name.trim() : id
    return [
      {
        id,
        name,
        api: 'openai-completions' as const,
        baseUrl,
        provider: GATEWAY_PROVIDER_ID,
        // The endpoint publishes no pricing or window; keep the numbers honest
        // rather than inventing per-model limits.
        reasoning: /think|reason|-r\d|glm|deepseek/i.test(id),
        input: /vision|image|omni|4o|glm-4v/i.test(id) ? ['text' as const, 'image' as const] : ['text' as const],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 8_192,
        compat: { maxTokensField: 'max_tokens' as const }
      }
    ]
  })
}

export async function fetchGatewayModels(
  config: GatewayConfig,
  signal?: AbortSignal
): Promise<Model<'openai-completions'>[]> {
  const { baseUrl } = config
  const apiKey = await gatewayApiKey(config)
  if (!baseUrl || !apiKey) return []
  const response = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal
  })
  await notifyUnauthorized(config, response)
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new Error(payload?.error?.message || `The gateway rejected the model list (${response.status})`)
  }
  return chatModels(await response.json(), baseUrl)
}

/** Resolve on every request so sign-out immediately makes the provider unusable. */
function configuredApiKeyAuth(config: GatewayConfig): ApiKeyAuth {
  return {
    name: config.authName || 'Gateway API key',
    resolve: async () => {
      const apiKey = await gatewayApiKey(config)
      return apiKey ? { auth: { apiKey }, source: config.authSource || 'endpoint settings' } : undefined
    }
  }
}

export function gatewayProvider(models: Model<'openai-completions'>[], config: GatewayConfig): Provider {
  const { baseUrl } = config
  const monitoredFetch = (delegate: typeof globalThis.fetch): typeof globalThis.fetch => async (input, init) => {
    const response = await delegate(input, init)
    await notifyUnauthorized(config, response)
    return response
  }
  const watchedStream: typeof stream = (model, context, options) =>
    stream(model, context, { ...options, fetch: monitoredFetch(options?.fetch || globalThis.fetch) })
  const watchedStreamSimple: typeof streamSimple = (model, context, options) =>
    streamSimple(model, context, { ...options, fetch: monitoredFetch(options?.fetch || globalThis.fetch) })
  return createProvider({
    id: GATEWAY_PROVIDER_ID,
    name: config.providerName || GATEWAY_PROVIDER_NAME,
    baseUrl,
    auth: { apiKey: configuredApiKeyAuth(config) },
    models,
    api: { stream: watchedStream, streamSimple: watchedStreamSimple }
  }) as Provider
}
