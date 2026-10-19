// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
vi.mock('../preferences', () => ({ t: (text: string) => text, tr: (text: string, values: Record<string, string> = {}) => text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '') }))
import { CustomModelSelection } from './CustomModelSelection'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const config = { defaultModel: 'z/org/z', providers: [
  { id: 'z', name: 'Zebra', kind: 'openai' as const, apiBase: '', hasKey: true, models: ['org/z'] },
  { id: 'a', name: 'Alpha', kind: 'openai' as const, apiBase: '', hasKey: true, models: ['beta', 'alpha'], modelLabels: { beta: 'Friendly name' } }
] }
const options = (host: HTMLElement, list: string) => [...host.querySelectorAll(`[aria-label="${list}"] [role="option"]`)]
const texts = (host: HTMLElement, list: string) => options(host, list).map(item => item.querySelector(list === 'Provider' ? 'span' : 'strong')?.textContent)

async function render(element: React.ReactElement) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(element))
  await act(async () => host.querySelector<HTMLButtonElement>('.agent-select-trigger')!.click())
  return { host, done: async () => { await act(async () => root.unmount()); host.remove() } }
}

it('lists Douchat Cloud first, then the user\'s providers, and its models by catalog name', async () => {
  const change = vi.fn()
  const { host, done } = await render(<CustomModelSelection config={config} cloudModels={[{ provider: 'gateway', model: 'douchat-default', label: 'GPT-5.6 Luna' }, { provider: 'gateway', model: 'kimi', label: 'Kimi' }]} providerId="cloud" model="douchat-default" onChange={change} />)
  try {
    expect(texts(host, 'Provider')).toEqual(['Douchat Cloud', 'Default model', 'Zebra', 'Alpha'])
    expect(texts(host, 'Custom model')).toEqual(['GPT-5.6 Luna', 'Kimi'])
    expect(host.querySelector('[aria-label="Custom model"] [aria-selected="true"]')?.textContent).toContain('GPT-5.6 Luna')
    await act(async () => (options(host, 'Custom model')[1] as HTMLButtonElement).click())
    expect(change).toHaveBeenCalledWith('cloud', 'kimi')
  } finally { await done() }
})

it('browses providers without changing the model, keeps the follow-default entry, and closes on a choice', async () => {
  const change = vi.fn()
  const { host, done } = await render(<CustomModelSelection config={config} cloudModels={[]} providerId="cloud" model="douchat-default" onChange={change} />)
  try {
    // The default model is its own provider; the provider holding it lists it once.
    await act(async () => (options(host, 'Provider')[1] as HTMLButtonElement).click())
    expect(texts(host, 'Custom model')).toEqual(['Follow default model'])
    await act(async () => (options(host, 'Provider')[2] as HTMLButtonElement).click())
    expect(texts(host, 'Custom model')).toEqual(['org/z'])
    await act(async () => (options(host, 'Provider')[3] as HTMLButtonElement).click())
    expect(texts(host, 'Custom model')).toEqual(['alpha', 'Friendly name'])
    expect(change).not.toHaveBeenCalled()
    await act(async () => (options(host, 'Custom model')[1] as HTMLButtonElement).click())
    expect(change).toHaveBeenCalledWith('a', 'beta')
    expect(host.querySelector('[aria-label="Provider"]')).toBeNull()
  } finally { await done() }
})

it('shows a saved model that is no longer available', async () => {
  const { host, done } = await render(<CustomModelSelection config={config} cloudModels={[]} providerId="gone" model="my-model" onChange={vi.fn()} />)
  try {
    expect(texts(host, 'Provider')).toEqual(['Douchat Cloud', 'Default model', 'Zebra', 'Alpha', 'gone'])
    expect(host.querySelector('[aria-label="Custom model"]')?.textContent).toContain('my-model (unavailable)')
  } finally { await done() }
})
