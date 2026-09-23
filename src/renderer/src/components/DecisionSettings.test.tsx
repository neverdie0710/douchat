// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, it, vi } from 'vitest'
vi.hoisted(() => { Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }) })
import { setPreferences } from '../preferences'
beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() })
  setPreferences({ language: 'zh-CN' })
})
import { DecisionSettings } from './DecisionSettings'
import { CLOUD_DECISION_PROVIDER_ID, type DecisionSettings as Settings } from '../../../shared/groupDecision'

const cloudModel = { id: 'current-cloud-model', name: 'Cloud Decision', protocol: 'jev', creditsPerRequest: 3 }
const defaults: Settings = { mode: 'leader', providerId: '', model: '' }
async function mount(settings = defaults, models: () => Promise<unknown[]> = async () => [cloudModel]) {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  const save = vi.fn(async value => value)
  const test = vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true }))
  Object.defineProperty(window, 'douchat', { configurable: true, value: {
    getDecisionSettings: vi.fn(async () => settings), getCloudDecisionModels: vi.fn(models), saveDecisionSettings: save, testDecisionSettings: test
  } })
  const element = document.createElement('div'); document.body.append(element)
  const root = createRoot(element)
  await act(async () => root.render(<DecisionSettings />))
  return { element, save, test, cleanup: async () => { await act(async () => root.unmount()); element.remove() } }
}

it('tests cloud connectivity once, disables controls while pending, and keeps the mode on success', async () => {
  const { element, test, save, cleanup } = await mount({ ...defaults, mode: 'model', providerId: CLOUD_DECISION_PROVIDER_ID })
  try {
    let finish!: (result: { ok: boolean }) => void
    test.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    expect(element.textContent).toContain('测试成功会按一次决策调用消耗额度')
    await act(async () => element.querySelector<HTMLButtonElement>('button.secondary-button')!.click())
    expect(element.querySelector('fieldset')!.disabled).toBe(true)
    expect(element.textContent).toContain('正在测试')
    expect(test).toHaveBeenCalledExactlyOnceWith({ ...defaults, mode: 'model', providerId: CLOUD_DECISION_PROVIDER_ID })
    await act(async () => finish({ ok: true }))
    expect(element.querySelector('fieldset')!.disabled).toBe(false)
    expect(element.querySelector('select')!.value).toBe('model')
    expect(element.textContent).toContain('决策服务连接成功')
    expect(save).not.toHaveBeenCalled()
  } finally { await cleanup() }
})

it.each(['Douchat credits 不足，请充值后重试。', 'Decision service unavailable (HTTP 502).', 'request timed out'])('persists default mode and shows the test error: %s', async error => {
  const { element, test, save, cleanup } = await mount({ ...defaults, mode: 'model', providerId: CLOUD_DECISION_PROVIDER_ID, healthCheckIntervalSeconds: 120 })
  try {
    if (error === 'request timed out') test.mockRejectedValueOnce(new Error(error))
    else test.mockResolvedValueOnce({ ok: false, error })
    await act(async () => element.querySelector<HTMLButtonElement>('button.secondary-button')!.click())
    expect(element.querySelector('select')!.value).toBe('leader')
    expect(save).toHaveBeenCalledExactlyOnceWith({ ...defaults, healthCheckIntervalSeconds: 120 })
    expect(element.querySelector('[role="alert"]')!.textContent).toContain(error)
    expect(element.textContent).toContain('已自动切换为默认决策方式并保存')
    expect(element.querySelector('button.secondary-button')).toBeNull()
  } finally { await cleanup() }
})

it('reports a failed fallback save without claiming the default was persisted', async () => {
  const { element, test, save, cleanup } = await mount({ ...defaults, mode: 'model', providerId: CLOUD_DECISION_PROVIDER_ID })
  try {
    test.mockResolvedValueOnce({ ok: false, error: 'offline' })
    save.mockRejectedValueOnce(new Error('disk full'))
    await act(async () => element.querySelector<HTMLButtonElement>('button.secondary-button')!.click())
    expect(element.querySelector('select')!.value).toBe('leader')
    expect(element.textContent).toContain('保存失败，请重新保存')
    expect(element.textContent).toContain('disk full')
    expect(element.textContent).not.toContain('并保存')
    await act(async () => element.querySelector<HTMLButtonElement>('button.primary-button')!.click())
    expect(save).toHaveBeenLastCalledWith(defaults)
    expect(element.textContent).toContain('群决策设置已保存')
  } finally { await cleanup() }
})

it('offers one mode switch, no provider/model controls, and saves cloud preference without pinning a model', async () => {
  const { element, save, cleanup } = await mount()
  try {
    const mode = element.querySelector('select')!
    expect([...mode.options].map(option => option.text)).toEqual(['默认', '决策模型'])
    await act(async () => { mode.value = 'model'; mode.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(element.querySelectorAll('select')).toHaveLength(1)
    expect(element.querySelectorAll('input')).toHaveLength(1)
    expect(element.querySelector('input')?.type).toBe('number')
    expect(element.querySelectorAll('button')).toHaveLength(2)
    expect(element.textContent).toContain('将使用 Douchat 云端决策模型进行调度，会消耗额度')
    expect(element.textContent).toContain('3 credits')
    expect(element.textContent).not.toContain('Cloud Decision')
    await act(async () => element.querySelector<HTMLButtonElement>('button.primary-button')!.click())
    expect(save).toHaveBeenCalledWith({ mode: 'model', providerId: CLOUD_DECISION_PROVIDER_ID, model: '' })
  } finally { await cleanup() }
})

it.each(['empty', 'failed', 'unsupported'])('hides the cloud mode for an %s catalog, including a previously selected cloud model', async result => {
  const { element, save, cleanup } = await mount({ mode: 'model', providerId: CLOUD_DECISION_PROVIDER_ID, model: 'old-model' }, async () => {
    if (result === 'failed') throw new Error('offline')
    return result === 'unsupported' ? [{ ...cloudModel, protocol: 'chat' }] : []
  })
  try {
    expect([...element.querySelector('select')!.options].map(option => option.text)).toEqual(['默认'])
    expect(element.textContent).not.toContain('会消耗额度')
    await act(async () => element.querySelector<HTMLButtonElement>('button.primary-button')!.click())
    expect(save).toHaveBeenCalledWith(defaults)
  } finally { await cleanup() }
})

it('does not automatically enroll a legacy custom provider in paid cloud decisions', async () => {
  const { element, save, cleanup } = await mount({ mode: 'model', providerId: 'openrouter', model: 'typesafe/jev-1.13', healthCheckIntervalSeconds: 120 })
  try {
    expect(element.querySelector('select')?.value).toBe('leader')
    expect(element.querySelector('input')?.value).toBe('120')
    expect(save).not.toHaveBeenCalled()
  } finally { await cleanup() }
})

it('keeps the cloud preference when the administrator changes the model', async () => {
  const { element, save, cleanup } = await mount({ mode: 'model', providerId: CLOUD_DECISION_PROVIDER_ID, model: 'retired-model' })
  try {
    expect(element.querySelector('select')?.value).toBe('model')
    await act(async () => element.querySelector<HTMLButtonElement>('button.primary-button')!.click())
    expect(save).toHaveBeenCalledWith({ mode: 'model', providerId: CLOUD_DECISION_PROVIDER_ID, model: '' })
  } finally { await cleanup() }
})


it('updates all scheduling copy and saved confirmation when switching languages', async () => {
  const { element, cleanup } = await mount({ mode: 'model', providerId: CLOUD_DECISION_PROVIDER_ID, model: '' })
  try {
    await act(async () => element.querySelector<HTMLButtonElement>('button.primary-button')!.click())
    expect(element.textContent).toContain('群决策设置已保存')
    await act(async () => setPreferences({ language: 'en' }))
    expect(element.textContent).not.toMatch(/\p{Script=Han}/u)
    expect(element.querySelector('section')?.getAttribute('aria-label')).toBe('Group decision service')
    expect(element.textContent).toContain('Each successful call costs 3 credits.')
    expect(element.textContent).toContain('Group decision settings saved. They apply to the next task.')
    await act(async () => setPreferences({ language: 'zh-CN' }))
    expect(element.textContent).toContain('群决策设置已保存')
  } finally { await cleanup() }
})
