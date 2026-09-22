/** Provider editor and endpoint conventions adapted from Termany ModelSettings. */
export type CustomModelKind = 'openai' | 'anthropic'
export interface CustomProviderInput { id: string; name: string; kind: CustomModelKind; apiBase: string; apiKey?: string; models: string[]; modelLabels?: Record<string, string> }
export interface CustomProviderView extends Omit<CustomProviderInput, 'apiKey'> { hasKey: boolean }
export interface CustomModelConfig { providers: CustomProviderView[]; defaultModel: string }
export interface CustomModelTest { provider: CustomProviderInput; model: string }
export const CUSTOM_PROVIDER_PREFIX = 'custom:'
export function customEndpoint(base: string, kind: CustomModelKind): string {
  const value = base.trim().replace(/\/+$/, '') || (kind === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1')
  const endpoint = kind === 'anthropic' ? '/v1/messages' : '/v1/chat/completions'
  return value.endsWith(endpoint) ? value : value.endsWith('/v1') ? value + endpoint.slice(3) : value + endpoint
}
export const CUSTOM_MODEL_PRESETS: Array<{ id: string; name: string; kind: CustomModelKind; apiBase: string; models: string[] }> = [
  { id: 'anthropic', name: 'Anthropic', kind: 'anthropic', apiBase: 'https://api.anthropic.com', models: ['claude-opus-4-8'] },
  { id: 'openai', name: 'OpenAI', kind: 'openai', apiBase: 'https://api.openai.com/v1', models: ['gpt-5.6-sol'] },
  { id: 'openrouter', name: 'OpenRouter', kind: 'openai', apiBase: 'https://openrouter.ai/api', models: ['xiaomi/mimo-v2.5'] },
  { id: 'deepseek', name: 'DeepSeek', kind: 'openai', apiBase: 'https://api.deepseek.com', models: ['deepseek-flash'] },
]
