// @vitest-environment jsdom
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { NativeDialog } from './NativeDialog'

it('renders only in a native child, preserves React updates and closes with its owner', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const childDocument = document.implementation.createHTMLDocument('child')
  const events = new EventTarget()
  const child = { document: childDocument, close: vi.fn(), addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) }
  const open = vi.spyOn(window, 'open').mockReturnValue(child as unknown as Window)
  const parent = document.createElement('div')
  const root = createRoot(parent)
  const close = vi.fn()
  function Form() {
    const [count, setCount] = useState(0)
    return <NativeDialog onClose={close}><button onClick={() => setCount(count + 1)}>{count}</button></NativeDialog>
  }
  try {
    await act(async () => root.render(<Form />))
    expect(open).toHaveBeenCalledWith('about:blank', expect.stringMatching(/^douchat-dialog-/), 'width=560,height=400')
    expect(parent.querySelector('button')).toBeNull()
    expect(childDocument.title).toBe('')
    expect(childDocument.documentElement.classList.contains('native-dialog-window')).toBe(true)
    await act(async () => childDocument.querySelector('button')!.click())
    expect(childDocument.querySelector('button')?.textContent).toBe('1')
    const outside = new Event('pointerdown', { bubbles: true, cancelable: true })
    document.dispatchEvent(outside)
    expect(outside.defaultPrevented).toBe(true)
    expect(child.close).toHaveBeenCalledOnce()
    expect(document.documentElement.classList.contains('has-native-dialog')).toBe(false)
    expect(close).toHaveBeenCalledOnce()
    events.dispatchEvent(new Event('beforeunload'))
    expect(close).toHaveBeenCalledOnce()
    await act(async () => root.unmount())
    expect(child.close).toHaveBeenCalledOnce()
  } finally { open.mockRestore(); vi.unstubAllGlobals() }
})

it('remeasures after child styles load using the child window observer', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const childDocument = document.implementation.createHTMLDocument('child')
  let notifyResize!: () => void
  const observe = vi.fn()
  const disconnect = vi.fn()
  Object.defineProperty(childDocument, 'defaultView', { value: {
    ResizeObserver: class { constructor(callback: () => void) { notifyResize = callback } observe = observe; disconnect = disconnect }
  } })
  const child = { document: childDocument, close: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }
  const open = vi.spyOn(window, 'open').mockReturnValue(child as unknown as Window)
  const oldApi = window.douchat
  const report = vi.fn()
  const resize = vi.fn(async () => true)
  Object.defineProperty(window.screen, 'availHeight', { configurable: true, value: 1000 })
  Object.defineProperty(window, 'douchat', { configurable: true, value: { reportDiagnostic: report, resizeDialog: resize } })
  let height = 800
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ height } as DOMRect))
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(<NativeDialog onClose={() => {}}><section>Content</section></NativeDialog>))
    expect(observe).toHaveBeenCalledOnce()
    height = 440
    await act(async () => childDocument.dispatchEvent(new Event('load')))
    expect(resize).toHaveBeenLastCalledWith(expect.any(String), 560, 440)
    height = 520
    await act(async () => notifyResize())
    expect(resize).toHaveBeenLastCalledWith(expect.any(String), 560, 520)
    resize.mockRejectedValueOnce(new Error('temporary resize failure'))
    height = 600
    await act(async () => notifyResize())
    expect(childDocument.querySelector('section')?.textContent).toBe('Content')
    expect(child.close).not.toHaveBeenCalled()
    expect(report).toHaveBeenLastCalledWith('native-dialog.resize-failed', expect.stringContaining('temporary resize failure'))
    const style = document.createElement('style')
    style.textContent = '.tab-test { color: red; }'
    await act(async () => document.head.appendChild(style))
    const original = Array.from(childDocument.querySelectorAll('style')).find((item) => item.textContent === style.textContent)
    const nextStyle = document.createElement('style')
    nextStyle.textContent = '.next-tab { color: blue; }'
    await act(async () => document.head.appendChild(nextStyle))
    expect(original?.isConnected).toBe(true)
    expect(Array.from(childDocument.querySelectorAll('style')).find((item) => item.textContent === style.textContent)).toBe(original)
    await act(async () => { style.remove(); nextStyle.remove() })
    await act(async () => root.unmount())
    expect(disconnect).toHaveBeenCalledOnce()
  } finally {
    bounds.mockRestore(); open.mockRestore()
    Object.defineProperty(window, 'douchat', { configurable: true, value: oldApi })
  }
})
