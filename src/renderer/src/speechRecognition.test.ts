import { describe, expect, it } from 'vitest'
import {
  speechRecognitionConstructor,
  speechRecognitionErrorMessage,
  speechRecognitionLanguage,
  type SpeechRecognitionConstructor
} from './speechRecognition'

describe('speech recognition helpers', () => {
  it('uses the standard constructor before the Chromium-prefixed one', () => {
    const standard = class {} as unknown as SpeechRecognitionConstructor
    const chromium = class {} as unknown as SpeechRecognitionConstructor
    expect(speechRecognitionConstructor({ SpeechRecognition: standard, webkitSpeechRecognition: chromium })).toBe(standard)
    expect(speechRecognitionConstructor({ webkitSpeechRecognition: chromium })).toBe(chromium)
  })

  it('selects a concrete recognition locale from the interface language', () => {
    expect(speechRecognitionLanguage('zh-CN')).toBe('zh-CN')
    expect(speechRecognitionLanguage('zh-Hans')).toBe('zh-CN')
    expect(speechRecognitionLanguage('en')).toBe('en-US')
  })

  it('turns browser failures into useful translation keys', () => {
    expect(speechRecognitionErrorMessage('not-allowed')).toContain('System Settings')
    expect(speechRecognitionErrorMessage('not-allowed', true)).toContain('recognition service')
    expect(speechRecognitionErrorMessage('service-not-allowed')).toContain('recognition service')
    expect(speechRecognitionErrorMessage('network', true)).toContain('recognition service')
    expect(speechRecognitionErrorMessage('no-speech')).toContain('No speech')
    expect(speechRecognitionErrorMessage('network')).toContain('network')
    expect(speechRecognitionErrorMessage('unknown')).toContain('unexpectedly')
  })
})
