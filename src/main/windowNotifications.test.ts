import { describe, expect, it, vi } from 'vitest'
import { notifyWindows } from './windowNotifications'
const window = () => ({ isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } })
describe('window notifications', () => {
  it('skips destroyed windows and web contents while notifying live windows', () => {
    const closed = { isDestroyed: () => true, get webContents(): ReturnType<typeof window>['webContents'] { throw new Error('Object has been destroyed') } }
    const deadPage = window()
    deadPage.webContents.isDestroyed = () => true
    const live = window()
    notifyWindows([closed, deadPage, live], 'douchat:snapshot', { activity: [] })
    expect(deadPage.webContents.send).not.toHaveBeenCalled()
    expect(live.webContents.send).toHaveBeenCalledWith('douchat:snapshot', { activity: [] })
  })
  it('does not fail a task or skip other windows if a renderer disappears during send', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const closing = window()
      closing.webContents.send.mockImplementation(() => { throw new Error('Object has been destroyed') })
      const live = window()
      expect(() => notifyWindows([closing, live], 'douchat:snapshot', {})).not.toThrow()
      expect(live.webContents.send).toHaveBeenCalledOnce()
      expect(warning).toHaveBeenCalledOnce()
    } finally { warning.mockRestore() }
  })
})
