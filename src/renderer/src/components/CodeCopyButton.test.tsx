// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { CodeCopyButton } from './CodeCopyButton'
vi.mock('../preferences', () => ({ t: (text: string) => text }))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const container = document.createElement('div')
const root = createRoot(container)
afterEach(() => vi.useRealTimers())
it('copies the raw code through the desktop bridge and shows success or failure', async () => {
  vi.useFakeTimers()
  const copyText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(window, 'douchat', { configurable: true, value: { copyText } })
  const code = '<div>hello</div>\n  indented\n'
  await act(async () => root.render(<CodeCopyButton code={code} />))
  await act(async () => container.querySelector('button')!.click())
  expect(copyText).toHaveBeenCalledWith(code)
  expect(container.textContent).toBe('Copied')
  expect(container.querySelector('button')!.dataset.copyState).toBe('copied')
  await act(async () => vi.advanceTimersByTime(2500))
  expect(container.querySelector('button')!.getAttribute('aria-label')).toBe('Copy code')
  copyText.mockRejectedValueOnce(new Error('Clipboard unavailable'))
  await act(async () => container.querySelector('button')!.click())
  expect(container.textContent).toBe('Could not copy code')
  expect(container.querySelector('button')!.dataset.copyState).toBe('failed')
  await act(async () => root.unmount())
})
