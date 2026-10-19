import { describe, expect, it } from 'vitest'
import { customDefaultThinking } from './customModels'

describe('customDefaultThinking', () => {
  it('keeps thinking on by default only for models marked as thinking before', () => {
    const provider = { reasoningModels: ['claude-opus-4-8'] }
    expect(customDefaultThinking(provider, 'claude-opus-4-8')).toBe('low')
    expect(customDefaultThinking(provider, 'autojev/fast')).toBe('off')
    expect(customDefaultThinking(undefined, 'autojev/fast')).toBe('off')
  })
})
