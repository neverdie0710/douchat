import { BrowserWindow, screen, shell } from 'electron'

const dialogs = new Map<string, { owner: BrowserWindow; child: BrowserWindow }>()

export function resizeNativeDialog(sender: Electron.WebContents, name: string, height: number, width = 820): boolean {
  const entry = dialogs.get(name)
  if (!entry || entry.owner.webContents !== sender || entry.child.isDestroyed() || !Number.isFinite(height) || !Number.isFinite(width)) return false
  const parent = entry.owner.getBounds()
  const area = screen.getDisplayMatching(parent).workArea
  const chrome = entry.child.getBounds().height - entry.child.getContentBounds().height
  const h = Math.max(120, Math.min(Math.ceil(height) + chrome, area.height - 40))
  const w = Math.max(320, Math.min(Math.ceil(width), area.width - 40))
  entry.child.setBounds({ width: w, height: h, x: Math.round(Math.max(area.x, Math.min(parent.x + (parent.width - w) / 2, area.x + area.width - w))), y: Math.round(Math.max(area.y, Math.min(parent.y + (parent.height - h) / 2, area.y + area.height - h))) })
  if (!entry.child.isVisible()) entry.child.show()
  return true
}

export function configureNativeDialogWindows(window: BrowserWindow): void {
  const contents = window.webContents
  contents.setWindowOpenHandler(({ url, frameName }) => {
    if (url === 'about:blank' && /^douchat-dialog-[a-f0-9-]+$/.test(frameName)) {
      return { action: 'allow', overrideBrowserWindowOptions: {
        title: '', parent: window, frame: false, show: false,
        autoHideMenuBar: true, backgroundColor: '#f8f9fb',
        minWidth: 360, minHeight: 120, resizable: false,
        minimizable: false, maximizable: false, fullscreenable: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
      } }
    }
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('did-create-window', (child, details) => {
    if (!details.frameName.startsWith('douchat-dialog-')) return
    dialogs.set(details.frameName, { owner: window, child })
    child.on('closed', () => {
      // StrictMode/HMR can replace a window before its predecessor finishes closing.
      if (dialogs.get(details.frameName)?.child === child) dialogs.delete(details.frameName)
    })
    child.setTitle('')
    child.setMenu(null)
    const parentBounds = window.getBounds()
    const bounds = child.getBounds()
    const area = screen.getDisplayMatching(parentBounds).workArea
    const width = Math.min(bounds.width, area.width)
    const height = Math.min(bounds.height, area.height)
    child.setBounds({ width, height,
      x: Math.round(Math.max(area.x, Math.min(parentBounds.x + (parentBounds.width - width) / 2, area.x + area.width - width))),
      y: Math.round(Math.max(area.y, Math.min(parentBounds.y + (parentBounds.height - height) / 2, area.y + area.height - height)))
    })
    child.webContents.on('page-title-updated', (event) => { event.preventDefault(); child.setTitle('') })
    child.webContents.on('will-navigate', (event) => event.preventDefault())
  })
}
