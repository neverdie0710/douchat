import type { UpdateState } from '../shared/types'

const AUTO_CHECK_INTERVAL = 60 * 60_000
const STARTUP_CHECK_DELAY = 15_000

export interface UpdateDriver {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  disableWebInstaller: boolean
  on: (event: string, listener: (value?: unknown) => void) => unknown
  checkForUpdates: () => Promise<unknown>
  downloadUpdate: () => Promise<unknown>
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void
}

interface UpdateInfoLike {
  version?: unknown
  releaseNotes?: unknown
}

interface ProgressLike {
  percent?: unknown
  transferred?: unknown
  total?: unknown
  bytesPerSecond?: unknown
}

function notesFrom(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (!Array.isArray(value)) return undefined
  const notes = value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const note = 'note' in item && typeof item.note === 'string' ? item.note.trim() : ''
    return note ? [note] : []
  })
  return notes.length ? notes.join('\n\n') : undefined
}

function updateInfo(value: unknown): Pick<UpdateState, 'availableVersion' | 'releaseNotes'> {
  const info = value && typeof value === 'object' ? value as UpdateInfoLike : {}
  return {
    availableVersion: typeof info.version === 'string' ? info.version : undefined,
    releaseNotes: notesFrom(info.releaseNotes)
  }
}

/** Keep credentials and signed download parameters out of renderer-visible errors. */
export function safeUpdateError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause || 'Unknown update error')
  return message
    .replace(/([?&](?:access_token|token|key|signature)=)[^&\s]+/gi, '$1<redacted>')
    .replace(/(authorization:\s*(?:bearer|basic)\s+)[^\s]+/gi, '$1<redacted>')
}

/**
 * Owns the update state machine in the trusted main process. The renderer can
 * request a check or install, but it cannot replace the signed update feed.
 */
export class DesktopUpdater {
  private value: UpdateState
  private startupTimer?: ReturnType<typeof setTimeout>
  private checkTimer?: ReturnType<typeof setInterval>
  private checking = false
  private lastCheckAt?: number

  constructor(
    private readonly driver: UpdateDriver | undefined,
    currentVersion: string,
    private readonly enabled: boolean,
    private readonly busyTaskCount: () => number,
    private readonly onChange: (state: UpdateState) => void
  ) {
    this.value = { status: enabled && driver ? 'idle' : 'disabled', currentVersion }
    if (!enabled || !driver) return

    driver.autoDownload = false
    driver.autoInstallOnAppQuit = true
    // Web installers can execute a second network bootstrap. Full NSIS
    // packages are deterministic and are the only Windows updates we publish.
    driver.disableWebInstaller = true

    driver.on('checking-for-update', () => this.publish({ status: 'checking' }))
    driver.on('update-available', (info) => {
      this.publish({ status: 'available', ...updateInfo(info) })
    })
    driver.on('update-not-available', () => this.publish({ status: 'up-to-date' }))
    driver.on('download-progress', (value) => {
      const progress = value && typeof value === 'object' ? value as ProgressLike : {}
      const percent = typeof progress.percent === 'number'
        ? Math.max(0, Math.min(99, Math.round(progress.percent)))
        : this.value.percent
      this.publish({
        status: 'downloading',
        availableVersion: this.value.availableVersion,
        releaseNotes: this.value.releaseNotes,
        percent,
        transferred: typeof progress.transferred === 'number' ? progress.transferred : undefined,
        total: typeof progress.total === 'number' ? progress.total : undefined,
        bytesPerSecond: typeof progress.bytesPerSecond === 'number' ? progress.bytesPerSecond : undefined
      })
    })
    driver.on('update-downloaded', (info) => {
      const next = updateInfo(info)
      this.publish({
        status: 'downloaded',
        availableVersion: next.availableVersion ?? this.value.availableVersion,
        releaseNotes: next.releaseNotes ?? this.value.releaseNotes,
        percent: 100
      })
    })
    driver.on('error', (cause) => this.fail(cause))
  }

  state(): UpdateState {
    return { ...this.value }
  }

  startAutomaticChecks(): void {
    if (!this.enabled || !this.driver || this.checkTimer) return
    this.startupTimer = setTimeout(() => { void this.checkAutomatically() }, STARTUP_CHECK_DELAY)
    this.startupTimer.unref()
    this.checkTimer = setInterval(() => { void this.checkAutomatically() }, AUTO_CHECK_INTERVAL)
    this.checkTimer.unref()
  }

  stopAutomaticChecks(): void {
    clearTimeout(this.startupTimer)
    clearInterval(this.checkTimer)
    this.startupTimer = undefined
    this.checkTimer = undefined
  }

  /** Wake-ups can happen frequently; only catch up after a full check interval. */
  checkAfterResume(): void {
    if (!this.checkTimer || (this.lastCheckAt !== undefined && Date.now() - this.lastCheckAt < AUTO_CHECK_INTERVAL)) return
    void this.checkAutomatically()
  }

  private async checkAutomatically(): Promise<void> {
    // Keep a discovered update visible until the user chooses to install it.
    // Background polling must never replace the download/install state.
    if (this.value.availableVersion || ['downloading', 'downloaded', 'installing'].includes(this.value.status)) return
    await this.checkForUpdates()
  }

  async checkForUpdates(): Promise<UpdateState> {
    if (!this.enabled || !this.driver) return this.state()
    if (this.checking || ['downloading', 'downloaded', 'installing'].includes(this.value.status)) return this.state()
    this.checking = true
    this.lastCheckAt = Date.now()
    this.publish({ status: 'checking' })
    try {
      await this.driver.checkForUpdates()
    } catch (cause) {
      this.fail(cause)
    } finally {
      this.checking = false
    }
    return this.state()
  }

  /** Download the verified release and restart immediately when work is idle. */
  async installUpdate(): Promise<UpdateState> {
    if (!this.enabled || !this.driver) return this.state()

    if (this.value.status !== 'downloaded') {
      if (this.value.status !== 'available') return this.state()
      this.publish({
        status: 'downloading',
        availableVersion: this.value.availableVersion,
        releaseNotes: this.value.releaseNotes,
        percent: 0
      })
      try {
        await this.driver.downloadUpdate()
      } catch (cause) {
        this.fail(cause)
        return this.state()
      }
      // Event callbacks may have changed the state while downloadUpdate was
      // awaited; take a fresh snapshot so TypeScript does not retain the
      // pre-await "available" narrowing.
      const downloadedState: UpdateState = this.state()
      if (downloadedState.status === 'error') return downloadedState
      if (downloadedState.status !== 'downloaded') {
        this.publish({
          status: 'downloaded',
          availableVersion: downloadedState.availableVersion,
          releaseNotes: downloadedState.releaseNotes,
          percent: 100
        })
      }
    }

    const busyTasks = Math.max(0, this.busyTaskCount())
    if (busyTasks > 0) {
      this.publish({
        status: 'downloaded',
        availableVersion: this.value.availableVersion,
        releaseNotes: this.value.releaseNotes,
        percent: 100,
        busyTasks
      })
      return this.state()
    }

    this.publish({
      status: 'installing',
      availableVersion: this.value.availableVersion,
      releaseNotes: this.value.releaseNotes,
      percent: 100
    })
    this.driver.quitAndInstall(false, true)
    return this.state()
  }

  private fail(cause: unknown): void {
    this.publish({
      status: 'error',
      availableVersion: this.value.availableVersion,
      releaseNotes: this.value.releaseNotes,
      error: safeUpdateError(cause)
    })
  }

  private publish(next: Omit<UpdateState, 'currentVersion'>): void {
    this.value = { currentVersion: this.value.currentVersion, ...next }
    this.onChange(this.state())
  }
}
