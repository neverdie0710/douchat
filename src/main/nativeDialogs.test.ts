import { expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { configureNativeDialogWindows, resizeNativeDialog } from './nativeDialogs'
const { external } = vi.hoisted(() => ({ external: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: class {}, shell: { openExternal: external }, screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) } }))

it('allows only internal blank dialog windows and enforces frameless fixed windows and safe web preferences', () => {
  let open!: (details: { url: string; frameName: string }) => any
  const owner = { webContents: { setWindowOpenHandler: (handler: typeof open) => { open = handler }, on: vi.fn() } }
  configureNativeDialogWindows(owner as unknown as BrowserWindow)
  const result = open({ url: 'about:blank', frameName: 'douchat-dialog-abc-123' })
  expect(result.action).toBe('allow')
  expect(result.overrideBrowserWindowOptions).toMatchObject({ title: '', parent: owner, frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } })
  expect(open({ url: 'about:blank', frameName: 'other' }).action).toBe('deny')
  expect(open({ url: 'file:///private/file', frameName: 'douchat-dialog-abc' }).action).toBe('deny')
  expect(open({ url: 'https://douchat.ai', frameName: '_blank' }).action).toBe('deny')
  expect(external).toHaveBeenCalledWith('https://douchat.ai')
})

it('centers the child over its owner and keeps it inside the display', () => {
  let created!: (child: any, details: { frameName: string }) => void
  const owner = {
    getBounds: () => ({ x: 1100, y: 650, width: 600, height: 400 }),
    webContents: { setWindowOpenHandler: vi.fn(), on: (_name: string, handler: typeof created) => { created = handler } }
  }
  configureNativeDialogWindows(owner as unknown as BrowserWindow)
  const child = { isDestroyed: () => false, isVisible: () => false, show: vi.fn(), getContentBounds: () => ({ width: 560, height: 500 }), on: vi.fn(), setTitle: vi.fn(), setMenu: vi.fn(), getBounds: () => ({ width: 560, height: 500 }), setBounds: vi.fn(), webContents: { on: vi.fn() } }
  created(child, { frameName: 'douchat-dialog-abc' })
  expect(child.setBounds).toHaveBeenCalledWith({ x: 880, y: 400, width: 560, height: 500 })
  expect(resizeNativeDialog(owner.webContents as any, 'douchat-dialog-abc', 440, 640)).toBe(true)
  expect(child.setBounds).toHaveBeenLastCalledWith({ x: 800, y: 460, width: 640, height: 440 })
  expect(child.show).toHaveBeenCalledOnce()
  expect(resizeNativeDialog({} as any, 'douchat-dialog-abc', 900, 900)).toBe(false)
})

it('keeps the replacement registered when an older window with the same name closes', () => {
  let created!: (child: any, details: { frameName: string }) => void
  const owner = {
    getBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 }),
    webContents: { setWindowOpenHandler: vi.fn(), on: (_name: string, handler: typeof created) => { created = handler } }
  }
  configureNativeDialogWindows(owner as unknown as BrowserWindow)
  const makeChild = () => ({ isDestroyed: () => false, isVisible: () => true, show: vi.fn(), getContentBounds: () => ({ width: 560, height: 326 }), on: vi.fn(), setTitle: vi.fn(), setMenu: vi.fn(), getBounds: () => ({ width: 560, height: 326 }), setBounds: vi.fn(), webContents: { on: vi.fn() } })
  const old = makeChild(), replacement = makeChild()
  const details = { frameName: 'douchat-dialog-replacement' }
  created(old, details)
  created(replacement, details)
  old.on.mock.calls.find(([event]) => event === 'closed')![1]()
  expect(resizeNativeDialog(owner.webContents as any, details.frameName, 640, 560)).toBe(true)
  expect(replacement.setBounds).toHaveBeenLastCalledWith({ x: 220, y: 80, width: 560, height: 640 })
  replacement.on.mock.calls.find(([event]) => event === 'closed')![1]()
  expect(resizeNativeDialog(owner.webContents as any, details.frameName, 640, 560)).toBe(false)
})
