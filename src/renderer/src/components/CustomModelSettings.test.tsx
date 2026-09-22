// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
vi.mock('./NativeDialog', () => ({ NativeDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('../preferences', () => ({ t: (s: string) => s, tr: (s: string, values: Record<string, string | number>) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll('{'+key+'}', String(value)), s) }))
import { CustomModelSettings } from './CustomModelSettings'
it('edits a saved provider, tests with the stored key, and saves multiple model IDs', async () => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  const config = { providers: [{ id: 'mine', name: 'Mine', kind: 'openai', apiBase: 'https://example.com/v1', models: ['one'], hasKey: true }], defaultModel: 'mine/one' }
  const testCustomModel = vi.fn(async () => ({ ok: true }))
  const saveCustomModels = vi.fn(async () => config)
  Object.defineProperty(window, 'douchat', { configurable: true, value: { getCustomModels: vi.fn(async () => config), testCustomModel, saveCustomModels } })
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<CustomModelSettings />))
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Edit Mine"]')!.click())
    expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe('')
    const add = [...container.querySelectorAll('button')].find(b => b.textContent === 'Add model')!
    async function addModel(value: string) {
      await act(async () => add.click())
      const inputs = container.querySelectorAll<HTMLInputElement>('.custom-model-input-row input[aria-label^="Model ID"]')
      const input = inputs[inputs.length - 1]
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Remove model 1"]')!.disabled).toBe(true)
    await addModel('org/two')
    await addModel('one')
    await addModel('remove-me')
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Remove model 4"]')!.click())
    await addModel('')
    expect(container.querySelectorAll('.custom-model-input-row')).toHaveLength(4)
    const test = [...container.querySelectorAll('button')].find(b => b.textContent === 'Test connection')!
    await act(async () => test.click())
    expect(testCustomModel).toHaveBeenCalledWith(expect.objectContaining({ model: 'one', provider: expect.objectContaining({ id: 'mine', apiKey: undefined, models: ['one', 'org/two'] }) }))
    expect(container.textContent).toContain('Connection successful')
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(saveCustomModels).toHaveBeenCalledWith([expect.objectContaining({ id: 'mine', apiKey: undefined, models: ['one', 'org/two'] })], 'mine/one')
    expect(container.querySelector('form')).toBeNull()
  } finally { await act(async () => root.unmount()); container.remove() }
})
