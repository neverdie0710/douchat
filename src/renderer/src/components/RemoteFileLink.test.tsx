// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('../preferences', () => ({ t: (value: string) => value }))
import { MessageMarkdown } from './MessageMarkdown'

let root: Root
let container: HTMLDivElement
const openLocalFile = vi.fn()
const copyText = vi.fn()
let availability: 'online' | 'offline' = 'offline'
const link = '[report.pdf](douchat-file:///Users/me/Downloads/report.pdf)'

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  openLocalFile.mockReset().mockResolvedValue(undefined)
  copyText.mockReset().mockResolvedValue(undefined)
  window.douchat = { platform: 'web', desktopAvailability: () => availability, openLocalFile, copyText } as unknown as typeof window.douchat
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

const chip = () => container.querySelector<HTMLButtonElement>('.message-local-file')!
const button = (label: string) => Array.from(container.querySelectorAll('button')).find((item) => item.textContent === label)
async function render(): Promise<void> {
  await act(async () => root.render(<MessageMarkdown text={link} />))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
}

it('says a file is on the computer instead of calling it missing, and offers its path', async () => {
  availability = 'offline'
  await render()
  expect(chip().className).toContain('is-remote')
  expect(chip().className).not.toContain('is-failed')
  await act(async () => chip().click())
  expect(container.textContent).toContain('Open the Douchat desktop app to view it on your computer.')
  expect(container.textContent).toContain('/Users/me/Downloads/report.pdf')
  expect(button('Open on computer')).toBeUndefined()
  await act(async () => button('Copy path')!.click())
  expect(copyText).toHaveBeenCalledWith('/Users/me/Downloads/report.pdf')
  expect(openLocalFile).not.toHaveBeenCalled()
})

it('opens the file on the computer while its desktop is online, and marks one that is gone', async () => {
  availability = 'online'
  await render()
  await act(async () => chip().click())
  await act(async () => button('Open on computer')!.click())
  expect(openLocalFile).toHaveBeenCalledWith('/Users/me/Downloads/report.pdf', undefined)
  expect(container.textContent).toContain('Opened on your computer.')
  openLocalFile.mockRejectedValueOnce(new Error('ENOENT: no such file or directory'))
  await act(async () => button('Open on computer')!.click())
  expect(chip().className).toContain('is-failed')
  expect(container.textContent).toContain('This file is no longer available at its saved location.')
})
