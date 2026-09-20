import { describe, expect, it } from 'vitest'
import { supportedInterfaceLanguage } from './language'

describe('supported interface language', () => {
  it('maps Chinese system locales to the shipped Chinese interface', () => {
    expect(supportedInterfaceLanguage('zh-CN')).toBe('zh-CN')
    expect(supportedInterfaceLanguage('zh-Hans')).toBe('zh-CN')
    expect(supportedInterfaceLanguage('zh-Hant-TW')).toBe('zh-CN')
  })

  it('falls back to English for other or invalid locales', () => {
    expect(supportedInterfaceLanguage('en-US')).toBe('en')
    expect(supportedInterfaceLanguage('ja-JP')).toBe('en')
    expect(supportedInterfaceLanguage(undefined)).toBe('en')
  })
})
