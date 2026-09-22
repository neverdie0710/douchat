// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ChatErrorBoundary } from './ChatErrorBoundary'
it('isolates a broken conversation and recovers when selecting another chat', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const container = document.createElement('div')
  const root = createRoot(container)
  const Broken = (): React.ReactNode => { throw new Error('Invalid external message') }
  try {
    await act(async () => root.render(<><nav>Chats</nav><ChatErrorBoundary key="broken"><Broken /></ChatErrorBoundary></>))
    expect(container.querySelector('nav')?.textContent).toBe('Chats')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('这个聊天暂时无法显示')
    await act(async () => root.render(<><nav>Chats</nav><ChatErrorBoundary key="healthy"><p>Messages</p></ChatErrorBoundary></>))
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('Messages')
  } finally { await act(async () => root.unmount()); log.mockRestore() }
})

it('keeps message source and surrounding chat usable when a lazy module fails', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const container = document.createElement('div')
  const root = createRoot(container)
  const Broken = (): React.ReactNode => { throw new Error('Failed to fetch dynamically imported module: http://localhost/highlighted-body.js') }
  try {
    await act(async () => root.render(<><ChatErrorBoundary fallbackText={'```js\nconst x = 1\n```'}><Broken /></ChatErrorBoundary><textarea /></>))
    expect(container.querySelector('.message-plain-fallback')?.textContent).toContain('const x = 1')
    expect(container.querySelector('textarea')).not.toBeNull()
    expect(container.querySelector('.system-message.is-error')).not.toBeNull()
    expect(container.querySelector('pre')).toBeNull()
    expect(container.textContent).toContain('重新加载窗口')
    await act(async () => (container.querySelector('.system-toggle') as HTMLButtonElement).click())
    expect(container.querySelector('pre')?.textContent).toContain('highlighted-body.js')
  } finally { await act(async () => root.unmount()); log.mockRestore() }
})
