// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SkillUploadDialog } from './SkillUploadDialog'
vi.mock('../preferences', () => ({ usePreferences: () => ({ language: 'en' }), resolveInterfaceLanguage: () => 'en' }))
let container: HTMLDivElement, root: Root
const parse = vi.fn(), upload = vi.fn(), close = vi.fn()
beforeEach(async () => {
  vi.resetAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
  Object.defineProperty(window, 'douchat', { configurable: true, value: { parseSkillArchive: parse } })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root.render(<SkillUploadDialog remaining={1} onUpload={upload} onClose={close} />))
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
async function drop(name = 'skills.zip') {
  const file = new File(['zip'], name)
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer })
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } })
  await act(async () => document.querySelector('.skill-upload-dropzone')!.dispatchEvent(event))
}
async function submit() { await act(async () => document.querySelector<HTMLButtonElement>('footer .primary-button')!.click()) }
it('accepts drag and drop and defers import until Upload', async () => {
  parse.mockResolvedValue([{ id: 'one' }])
  await drop()
  expect(document.querySelector('.skill-upload-dropzone')?.textContent).toContain('skills.zip')
  expect(parse).not.toHaveBeenCalled()
  await submit()
  expect(upload).toHaveBeenCalledWith([{ id: 'one' }])
  expect(close).toHaveBeenCalledOnce()
})
it('rejects standalone markdown and keeps cancellation free of changes', async () => {
  await drop('SKILL.md')
  expect(document.querySelector('[role=alert]')?.textContent).toContain('.zip')
  expect(document.querySelector<HTMLButtonElement>('footer .primary-button')!.disabled).toBe(true)
  await act(async () => document.querySelector<HTMLButtonElement>('footer .secondary-button')!.click())
  expect(close).toHaveBeenCalledOnce()
  expect(parse).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled()
})
it('keeps the dialog open on parse failure or exceeding remaining slots', async () => {
  await drop()
  parse.mockRejectedValueOnce(new Error('Invalid ZIP'))
  await submit()
  expect(document.querySelector('[role=alert]')?.textContent).toContain('Invalid ZIP')
  parse.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }])
  await submit()
  expect(document.querySelector('[role=alert]')?.textContent).toContain('only 1 slots remain')
  expect(upload).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
})
it('blocks repeated submissions while parsing', async () => {
  let finish!: (value: unknown[]) => void
  parse.mockReturnValue(new Promise(resolve => { finish = resolve }))
  await drop(); await submit(); await submit()
  expect(parse).toHaveBeenCalledOnce()
  expect(document.querySelector<HTMLButtonElement>('footer .secondary-button')!.disabled).toBe(true)
  await act(async () => finish([{ id: 'a' }]))
  expect(upload).toHaveBeenCalledOnce()
})
