// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { AgentArchivePanel } from './AgentArchivePanel'
import type { AgentConfig } from '../../../shared/types'
vi.mock('../preferences', () => ({ usePreferences: () => ({ language: 'en' }), resolveInterfaceLanguage: () => 'en' }))
it('previews the overwrite and only imports after confirmation; failures remain retryable', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const preview = { name: 'Source', systemFiles: { 'SOUL.md': 'Imported' }, skills: [] }
  const parse = vi.fn().mockResolvedValue(preview)
  Object.defineProperty(window, 'douchat', { configurable: true, value: { parseAgentArchive: parse } })
  const onImport = vi.fn().mockRejectedValueOnce(new Error('Save failed')).mockResolvedValue(undefined)
  const busy = vi.fn()
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<AgentArchivePanel agent={{ id: 'target', name: 'Target' } as AgentConfig} onImport={onImport} onBusyChange={busy} />))
    const file = new File(['zip'], 'agent.zip')
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(3) })
    const input = container.querySelector('input')!
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    expect(container.textContent).toContain('Import preview')
    expect(container.textContent).toContain('Missing items will be cleared')
    expect(onImport).not.toHaveBeenCalled()
    const confirm = () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Confirm replacement')!
    await act(async () => confirm().click())
    expect(container.textContent).toContain('Save failed')
    await act(async () => confirm().click())
    expect(onImport).toHaveBeenLastCalledWith({ systemFiles: preview.systemFiles, skills: [] })
    expect(container.textContent).not.toContain('Import preview')
    expect(container.textContent).toContain('Configuration imported')
    expect(busy.mock.calls.map(call => call[0])).toEqual([true, false])
  } finally { await act(async () => root.unmount()); container.remove() }
})

it('requires choosing a profile before previewing and confirming a multi-agent archive', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const selected = { name: 'Work', systemFiles: { 'SOUL.md': 'Work soul' }, skills: [] }
  const parse = vi.fn().mockResolvedValueOnce({ name: '', systemFiles: {}, skills: [], candidates: [
    { root: 'profiles/work/', name: 'Work' }, { root: 'profiles/home/', name: 'Home' }
  ] }).mockResolvedValueOnce(selected)
  Object.defineProperty(window, 'douchat', { configurable: true, value: { parseAgentArchive: parse } })
  const onImport = vi.fn().mockResolvedValue(undefined)
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<AgentArchivePanel agent={{ id: 'target', name: 'Target' } as AgentConfig} onImport={onImport} onBusyChange={vi.fn()} />))
    const file = new File(['tar'], 'profiles.tar.gz')
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(3) })
    const input = container.querySelector('input')!
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    expect(container.textContent).not.toContain('Confirm replacement')
    const select = container.querySelector('select')!
    await act(async () => { select.value = 'profiles/work/'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(parse).toHaveBeenLastCalledWith(new Uint8Array(3), 'profiles/work/')
    expect(onImport).not.toHaveBeenCalled()
    const confirm = [...container.querySelectorAll('button')].find(button => button.textContent === 'Confirm replacement')!
    await act(async () => confirm.click())
    expect(onImport).toHaveBeenCalledExactlyOnceWith({ systemFiles: selected.systemFiles, skills: [] })
  } finally { await act(async () => root.unmount()); container.remove() }
})

it('shows export success inside its card only after saving, and clears it on cancellation or failure', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const save = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('Disk full'))
  Object.defineProperty(window, 'douchat', { configurable: true, value: { exportAgentArchive: save } })
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<AgentArchivePanel agent={{ id: 'target', name: 'Target' } as AgentConfig} onImport={vi.fn()} onBusyChange={vi.fn()} />))
    const card = container.querySelector('.agent-settings-delete')!
    const button = card.querySelector('button')!
    await act(async () => button.click())
    expect(save).toHaveBeenCalledWith('target')
    expect(card.querySelector('[role="status"]')?.textContent).toBe('Configuration exported.')
    await act(async () => button.click())
    expect(container.querySelector('[role="status"]')).toBeNull()
    await act(async () => button.click())
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Disk full')
  } finally { await act(async () => root.unmount()); container.remove() }
})
