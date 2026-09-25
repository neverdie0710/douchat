import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createProvider, type Provider, type Model } from '@earendil-works/pi-ai'
import * as openai from '@earendil-works/pi-ai/api/openai-completions'
import * as anthropic from '@earendil-works/pi-ai/api/anthropic-messages'
import { CUSTOM_PROVIDER_PREFIX, customEndpoint, type CustomProviderInput, type CustomModelConfig, type CustomModelTest } from '../shared/customModels'
interface SecretCodec { encrypt(value: string): string; decrypt(value: string): string }
interface Stored { providers: Array<Omit<CustomProviderInput, 'apiKey'> & { secret: string }>; defaultModel: string }
export interface CustomProviderRecord extends CustomProviderInput { apiKey: string }
export function validateCustomProvider(input: CustomProviderInput): CustomProviderInput {
  if (!input || typeof input.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(input.id)) throw new Error("Invalid provider ID.")
  if (input.kind !== 'openai' && input.kind !== 'anthropic') throw new Error("Select an API type.")
  if (typeof input.name !== 'string' || !input.name.trim()) throw new Error("Enter a provider name.")
  if (typeof input.apiBase !== 'string' || (input.apiKey !== undefined && typeof input.apiKey !== 'string')) throw new Error("Invalid configuration format.")
  const endpoint = new URL(customEndpoint(input.apiBase, input.kind))
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("The API URL must use HTTP or HTTPS and contain no password, query parameters or fragment.")
  const models = Array.isArray(input.models) ? [...new Set(input.models.filter((m): m is string => typeof m === 'string').map(m => m.trim()).filter(Boolean))] : []
  if (!models.length || models.length > 100 || models.some(m => m.length > 200)) throw new Error("Enter valid model names, one per line.")
  const modelLabels = Object.fromEntries(models.map(model => [model, typeof input.modelLabels?.[model] === 'string' ? input.modelLabels[model].trim().slice(0, 200) : '']).filter(([, label]) => label))
  const reasoningModels = Array.isArray(input.reasoningModels) ? models.filter(model => input.reasoningModels!.includes(model)) : []
  return { id: input.id, name: input.name.trim(), kind: input.kind, apiBase: input.apiBase.trim(), apiKey: input.apiKey?.trim(), models, ...(Object.keys(modelLabels).length ? { modelLabels } : {}), ...(reasoningModels.length ? { reasoningModels } : {}) }
}
export class CustomModelStore {
  constructor(private directory: string, private codec: SecretCodec) {}
  private file(account: string): string {
    if (!account) throw new Error("Sign in first.")
    return join(this.directory, `${createHash('sha256').update(account).digest('hex')}.json`)
  }
  private read(account: string): Stored {
    const file = this.file(account)
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { providers: [], defaultModel: '' }
  }
  list(account: string): CustomModelConfig {
    const data = this.read(account)
    return { defaultModel: data.defaultModel, providers: data.providers.map(({ secret, ...provider }) => ({ ...provider, hasKey: Boolean(secret) })) }
  }
  records(account: string): CustomProviderRecord[] { return this.read(account).providers.map(({ secret, ...p }) => ({ ...p, apiKey: this.codec.decrypt(secret) })) }
  save(account: string, inputs: CustomProviderInput[], defaultModel: string): CustomModelConfig {
    if (!Array.isArray(inputs) || inputs.length > 30 || typeof defaultModel !== 'string') throw new Error("Invalid model configuration.")
    const old = this.read(account)
    const providers = inputs.map(validateCustomProvider).map(({ apiKey, ...p }) => {
      const previous = old.providers.find(item => item.id === p.id)
      // Never forward a stored key to a changed endpoint without explicit re-entry.
      if (!apiKey && previous && (customEndpoint(previous.apiBase, previous.kind) !== customEndpoint(p.apiBase, p.kind))) throw new Error("The API URL changed. Enter the API key again.")
      const secret = apiKey ? this.codec.encrypt(apiKey) : previous?.secret
      if (!secret) throw new Error("Enter an API key.")
      return { ...p, secret }
    })
    if (new Set(providers.map(p => p.id)).size !== providers.length) throw new Error("Duplicate provider IDs.")
    const choices = providers.flatMap(p => p.models.map(m => `${p.id}/${m}`))
    const next = { providers, defaultModel: choices.includes(defaultModel) ? defaultModel : choices[0] ?? '' }
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const file = this.file(account)
    writeFileSync(file + '.tmp', JSON.stringify(next), { mode: 0o600 })
    renameSync(file + '.tmp', file)
    return this.list(account)
  }
  async test(account: string, input: CustomModelTest): Promise<{ ok: boolean; error?: string; model?: string }> {
    const p = validateCustomProvider(input.provider)
    if (!p.models.includes(input.model)) throw new Error("Select a model from the configuration.")
    const saved = this.read(account).providers.find(item => item.id === p.id)
    const canReuse = saved && customEndpoint(saved.apiBase, saved.kind) === customEndpoint(p.apiBase, p.kind)
    const key = p.apiKey || (canReuse ? this.codec.decrypt(saved.secret) : '')
    if (!key) return { ok: false, error: '请输入 API 密钥；地址修改后需要重新输入。' }
    try {
      const res = await fetch(customEndpoint(p.apiBase, p.kind), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: p.kind === 'anthropic' ? { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: input.model, max_tokens: 16, messages: [{ role: 'user', content: 'Hi' }] })
      })
      if (!res.ok) return { ok: false, error: `连接失败（HTTP ${res.status}），请检查地址、密钥和模型权限。` }
      const data = await res.json() as { content?: unknown[]; choices?: unknown[]; model?: string }
      if (!(p.kind === 'anthropic' ? Array.isArray(data.content) : Array.isArray(data.choices) && data.choices.length)) return { ok: false, error: '响应格式与所选 API 类型不匹配。' }
      return { ok: true, model: input.model }
    } catch { return { ok: false, error: '连接失败或超时，请检查网络和 API 地址。' } }
  }
}
export function customModelProvider(p: CustomProviderRecord): Provider {
  const id = CUSTOM_PROVIDER_PREFIX + p.id
  const endpoint = customEndpoint(p.apiBase, p.kind)
  const baseUrl = endpoint.slice(0, -(p.kind === 'anthropic' ? '/v1/messages'.length : '/chat/completions'.length))
  const models = p.models.map(model => ({ id: model, name: model, provider: id, baseUrl,
    api: p.kind === 'anthropic' ? 'anthropic-messages' : 'openai-completions', reasoning: Boolean(p.reasoningModels?.includes(model)), input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: p.reasoningModels?.includes(model) ? 32000 : 8192,
    compat: { maxTokensField: 'max_tokens' }
  })) as Model<any>[]
  return createProvider({ id, name: p.name, baseUrl, models,
    auth: { apiKey: { name: p.name, resolve: async () => ({ auth: { apiKey: p.apiKey }, source: 'custom model settings' }) } },
    api: p.kind === 'anthropic' ? anthropic : openai
  }) as Provider
}
