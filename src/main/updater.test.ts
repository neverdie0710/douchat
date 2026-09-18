import { describe, expect, it, vi } from 'vitest'
import { DesktopUpdater, safeUpdateError, type UpdateDriver } from './updater'

function fakeDriver(): UpdateDriver & {
  emit: (event: string, value?: unknown) => void
  check: ReturnType<typeof vi.fn>
  download: ReturnType<typeof vi.fn>
  quit: ReturnType<typeof vi.fn>
} {
  const listeners = new Map<string, Array<(value?: unknown) => void>>()
  const check = vi.fn(async () => undefined)
  const download = vi.fn(async () => undefined)
  const quit = vi.fn()
  return {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    disableWebInstaller: false,
    on(event, listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    },
    emit(event, value) {
      for (const listener of listeners.get(event) ?? []) listener(value)
    },
    checkForUpdates: check,
    downloadUpdate: download,
    quitAndInstall: quit,
    check,
    download,
    quit
  }
}

describe('DesktopUpdater', () => {
  it('does not contact the release feed in an unpackaged development build', async () => {
    const driver = fakeDriver()
    const updater = new DesktopUpdater(driver, '0.1.0', false, () => 0, () => {})

    expect(await updater.checkForUpdates()).toEqual({ status: 'disabled', currentVersion: '0.1.0' })
    expect(driver.check).not.toHaveBeenCalled()
  })

  it('checks, downloads and installs an available update with one action', async () => {
    const driver = fakeDriver()
    const states: string[] = []
    const updater = new DesktopUpdater(driver, '0.1.0', true, () => 0, (state) => states.push(state.status))

    const checking = updater.checkForUpdates()
    driver.emit('update-available', { version: '0.2.0', releaseNotes: 'Faster startup' })
    await checking
    driver.download.mockImplementationOnce(async () => {
      driver.emit('download-progress', { percent: 42, transferred: 42, total: 100 })
      driver.emit('update-downloaded', { version: '0.2.0' })
    })

    await updater.installUpdate()

    expect(driver.autoDownload).toBe(false)
    expect(driver.autoInstallOnAppQuit).toBe(true)
    expect(driver.disableWebInstaller).toBe(true)
    expect(driver.download).toHaveBeenCalledOnce()
    expect(driver.quit).toHaveBeenCalledWith(false, true)
    expect(updater.state()).toMatchObject({ status: 'installing', availableVersion: '0.2.0', percent: 100 })
    expect(states).toContain('downloading')
  })

  it('keeps a downloaded update ready while agent work is active', async () => {
    const driver = fakeDriver()
    let busy = 2
    const updater = new DesktopUpdater(driver, '0.1.0', true, () => busy, () => {})
    driver.emit('update-available', { version: '0.2.0' })
    driver.download.mockImplementationOnce(async () => driver.emit('update-downloaded', { version: '0.2.0' }))

    expect(await updater.installUpdate()).toMatchObject({ status: 'downloaded', busyTasks: 2 })
    expect(driver.quit).not.toHaveBeenCalled()

    busy = 0
    expect(await updater.installUpdate()).toMatchObject({ status: 'installing' })
    expect(driver.download).toHaveBeenCalledOnce()
    expect(driver.quit).toHaveBeenCalledOnce()
  })
})

it('redacts credentials from update failures before they reach the renderer', () => {
  expect(safeUpdateError(new Error('GET https://example.test/latest.yml?token=secret-value failed')))
    .toBe('GET https://example.test/latest.yml?token=<redacted> failed')
  expect(safeUpdateError('Authorization: Bearer top-secret'))
    .toBe('Authorization: Bearer <redacted>')
})
