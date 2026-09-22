// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { DialogErrorBoundary } from './DialogErrorBoundary'
vi.mock('../preferences', () => ({ t: (text: string) => text }))
it('keeps the workspace mounted when a dialog throws and allows closing it', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const container = document.createElement('div')
  const root = createRoot(container)
  const close = vi.fn()
  function Broken(): React.ReactNode { throw new Error('dialog failure') }
  try {
    await act(async () => root.render(<><main>Workspace</main><DialogErrorBoundary onClose={close}><Broken /></DialogErrorBoundary></>))
    expect(container.querySelector('main')?.textContent).toBe('Workspace')
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain('dialog failure')
    await act(async () => container.querySelectorAll('button')[1]!.click())
    expect(close).toHaveBeenCalledOnce()
  } finally { await act(async () => root.unmount()); log.mockRestore() }
})

// Component behavior tests use an inline host; NativeDialog has separate window lifecycle tests.
vi.mock('./NativeDialog', async () => {
  const { createElement } = await import('react')
  return { NativeDialog: ({ children, onClose, width, height, ...props }: any) => createElement('div', props, children) }
})
