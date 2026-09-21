// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

function mockSystemLanguage(language: string): void {
  Object.defineProperty(navigator, 'languages', { configurable: true, value: [language] })
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })))
}

describe('interface language preference', () => {
  beforeEach(() => {
    vi.resetModules()
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
      clear: () => { values.clear() }
    })
  })

  it('uses the system language on a fresh install', async () => {
    mockSystemLanguage('zh-CN')
    const { setPreferences, t } = await import('./preferences')

    expect(document.documentElement.lang).toBe('zh-CN')
    expect(t('Settings')).toBe('设置')
    expect(t('Meet Douchat')).toBe('认识 Douchat')
    setPreferences({ appearance: 'dark' })
    expect(JSON.parse(localStorage.getItem('douchat.general') || '{}').language).toBe('system')
  })

  it('stores follow-system as a preference and reacts to a system language change', async () => {
    mockSystemLanguage('zh-CN')
    localStorage.setItem('douchat.general', JSON.stringify({ language: 'system' }))
    const { t } = await import('./preferences')

    expect(document.documentElement.lang).toBe('zh-CN')
    expect(t('Follow system')).toBe('跟随系统')

    Object.defineProperty(navigator, 'languages', { configurable: true, value: ['en-US'] })
    window.dispatchEvent(new Event('languagechange'))

    expect(document.documentElement.lang).toBe('en')
    expect(t('Settings')).toBe('Settings')
  })

  it('preserves an explicit saved language over the system default', async () => {
    mockSystemLanguage('zh-CN')
    localStorage.setItem('douchat.general', JSON.stringify({ language: 'en' }))
    const { t } = await import('./preferences')

    expect(document.documentElement.lang).toBe('en')
    expect(t('Settings')).toBe('Settings')

    Object.defineProperty(navigator, 'languages', { configurable: true, value: ['zh-CN'] })
    window.dispatchEvent(new Event('languagechange'))

    expect(document.documentElement.lang).toBe('en')
    expect(t('Settings')).toBe('Settings')
  })
})
