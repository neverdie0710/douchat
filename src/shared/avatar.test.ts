import { describe, expect, it } from 'vitest'
import { normalizeAgentEmoji } from './avatar'

describe('agent emoji avatars', () => {
  it('accepts exactly one visible emoji grapheme', () => {
    expect(normalizeAgentEmoji(' 🐱 ')).toBe('🐱')
    expect(normalizeAgentEmoji('👩🏽‍💻')).toBe('👩🏽‍💻')
    expect(normalizeAgentEmoji('🇨🇳')).toBe('🇨🇳')
    expect(normalizeAgentEmoji('1️⃣')).toBe('1️⃣')
  })

  it('rejects text and multiple emoji', () => {
    expect(normalizeAgentEmoji('cat')).toBe('')
    expect(normalizeAgentEmoji('🐱🐶')).toBe('')
    expect(normalizeAgentEmoji('')).toBe('')
  })
})
