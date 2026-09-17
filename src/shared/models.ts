import type { ModelOption } from './types'

/** Curated defaults for first-party provider credentials. A configured
 * OpenAI-compatible endpoint replaces this list with its live catalog. */
export const CLOUD_MODEL_OPTIONS: ModelOption[] = [
  { provider: 'openai', model: 'gpt-5.6-terra', label: 'OpenAI · GPT-5.6 Terra' },
  { provider: 'openai', model: 'gpt-5.6-sol', label: 'OpenAI · GPT-5.6 Sol' },
  { provider: 'anthropic', model: 'claude-sonnet-5', label: 'Anthropic · Claude Sonnet 5' },
  { provider: 'google-vertex', model: 'gemini-3.5-flash', label: 'Google Vertex AI · Gemini 3.5 Flash' },
  { provider: 'google', model: 'gemini-3.5-flash', label: 'Google · Gemini 3.5 Flash' }
]
