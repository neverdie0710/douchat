import { describe, expect, it } from 'vitest'
import { clampThinking, localThinkingArguments, thinkingLevel, withLocalThinking } from './thinkingLevels'
import { localAgentArgs } from '../main/localAgentRuntime'

describe('thinking levels', () => {
  it('validates against the whitelist and treats default as unset', () => {
    expect(thinkingLevel('high')).toBe('high')
    expect(thinkingLevel('default')).toBeUndefined()
    expect(thinkingLevel(undefined)).toBeUndefined()
    expect(() => thinkingLevel('--yolo')).toThrow('Invalid thinking level')
  })

  it('clamps to the nearest supported level, preferring deeper', () => {
    expect(clampThinking('off', ['minimal', 'low'])).toBe('minimal')
    expect(clampThinking('max', ['low', 'medium', 'xhigh'])).toBe('xhigh')
    expect(clampThinking('minimal', ['low', 'high'])).toBe('low')
    expect(clampThinking('low', [])).toBeUndefined()
  })

  it('maps levels to local CLI options', () => {
    expect(localThinkingArguments('codex', 'high')).toEqual(['-c', 'model_reasoning_effort="high"'])
    expect(localThinkingArguments('codex', 'max')).toEqual(['-c', 'model_reasoning_effort="xhigh"'])
    expect(localThinkingArguments('claude', 'minimal')).toEqual(['--effort', 'low'])
    expect(localThinkingArguments('gemini', 'high')).toEqual([])
    expect(localThinkingArguments('codex', undefined)).toEqual([])
  })

  it('keeps prompts after the inserted options', () => {
    const codex = withLocalThinking('codex', localAgentArgs('codex', 'hi', '/tmp/out'), 'medium')
    expect(codex.slice(-3)).toEqual(['-c', 'model_reasoning_effort="medium"', '-'])
    expect(codex.at(-1)).toBe('-')
    expect(codex).toContain('model_reasoning_effort="medium"')
    const claude = withLocalThinking('claude', localAgentArgs('claude', 'hi', '/tmp/out'), 'high')
    expect(claude.slice(-4)).toEqual(['--effort', 'high', '--', 'hi'])
  })
})
