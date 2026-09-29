import { createProvider, type ApiKeyAuth, type Api, type Model, type Provider } from '@earendil-works/pi-ai'
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
  /** First-party Cloud Chat guarantees a vision-capable default even when its
   * public catalog keeps the capability list transport-focused. */
  assumeImageInput?: boolean
  onUnauthorized?: () => void | Promise<void>
}

/** Apply an explicitly known budget; omit invented limits for opaque gateway routes. */
export function gatewayOutputPayload(payload: unknown, limit?: number, field = 'max_tokens'): Record<string, unknown> {
  const result = { ...(payload as Record<string, unknown>) }
  delete result.max_tokens
  delete result.max_completion_tokens
  if (limit) result[field] = limit
  return result
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
  max_output_tokens?: unknown
  maxOutputTokens?: unknown
  capabilities?: unknown
}

/** Only chat models can back a bot; the same endpoint also lists image,
 * video, audio and music models. */
type GatewayModel = Model<'openai-completions'> & { gatewayOutputLimit?: number }

function chatModels(payload: unknown, baseUrl: string, assumeImageInput = false): GatewayModel[] {
  const data = (payload as { data?: unknown })?.data
  if (!Array.isArray(data)) return []
  return data.flatMap((entry: GatewayModelEntry) => {
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    const capabilities = Array.isArray(entry.capabilities) ? entry.capabilities : []
    const declaresModelKind = typeof entry.model_type === 'string' || capabilities.length > 0
    // A standard OpenAI-compatible catalog commonly exposes only `id`. When a
    // richer catalog declares a kind, continue excluding its image/audio/etc.
    const chat = entry.model_type === 'chat' || capabilities.includes('chat.completions') || !declaresModelKind
    if (!id || !chat) return []
    const name = typeof entry.display_name === 'string' && entry.display_name.trim() ? entry.display_name.trim() : id
    const supportsImages = assumeImageInput
      || /vision|image|omni|4o|glm-4v/i.test(id)
      || capabilities.some((capability) => typeof capability === 'string' && /vision|image|multimodal/i.test(capability))
    const rawLimit = entry.max_output_tokens ?? entry.maxOutputTokens
    const outputLimit = typeof rawLimit === 'number' && Number.isSafeInteger(rawLimit) && rawLimit > 0 ? rawLimit : undefined
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
        input: supportsImages ? ['text' as const, 'image' as const] : ['text' as const],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: outputLimit ?? 8_192,
        gatewayOutputLimit: outputLimit,
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
  return chatModels(await response.json(), baseUrl, config.assumeImageInput)
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
  // Unknown model limits belong to the gateway, not a guessed desktop cap.
  // pi-ai otherwise supplies its own default, which can exhaust reasoning before text.
  const outputOptions = (model: Model<'openai-completions'>, options: Parameters<typeof stream>[2]) => ({
    ...options,
    onPayload: async (payload: unknown, selected: Model<Api>) => {
      const transformed = await options?.onPayload?.(payload, selected)
      const limit = options?.maxTokens ?? (models.find(item => item.id === model.id) as GatewayModel | undefined)?.gatewayOutputLimit
      return gatewayOutputPayload(transformed ?? payload, limit, model.compat?.maxTokensField)
    }
  })
  const watchedStream: typeof stream = (model, context, options) =>
    stream(model, context, { ...outputOptions(model, options), fetch: monitoredFetch(options?.fetch || globalThis.fetch) })
  const watchedStreamSimple: typeof streamSimple = (model, context, options) =>
    streamSimple(model, context, { ...outputOptions(model, options), fetch: monitoredFetch(options?.fetch || globalThis.fetch) })
  return createProvider({
    id: GATEWAY_PROVIDER_ID,
    name: config.providerName || GATEWAY_PROVIDER_NAME,
    baseUrl,
    auth: { apiKey: configuredApiKeyAuth(config) },
    models,
    api: { stream: watchedStream, streamSimple: watchedStreamSimple }
  }) as Provider
}
