import { describe, expect, it } from 'vitest'
import { isImeCommitEnter, type ImeKeyEvent } from './ime'

const key = (input: Partial<ImeKeyEvent>): ImeKeyEvent => ({
  key: '', code: '', keyCode: 0, isComposing: false, ...input
})

describe('IME enter handling', () => {
  it('treats Enter during composition as text confirmation instead of submission', () => {
    expect(isImeCommitEnter(key({ key: 'Enter', code: 'Enter', isComposing: true }), false)).toBe(true)
    expect(isImeCommitEnter(key({ key: 'Enter', code: 'Enter' }), true)).toBe(true)
    expect(isImeCommitEnter(key({ key: 'Process', code: 'Enter', keyCode: 229 }), true)).toBe(true)
  })

  it('keeps ordinary Enter available for form submission', () => {
    expect(isImeCommitEnter(key({ key: 'Enter', code: 'Enter', keyCode: 13 }), false)).toBe(false)
    expect(isImeCommitEnter(key({ key: 'a', code: 'KeyA', isComposing: true }), true)).toBe(false)
  })
})
