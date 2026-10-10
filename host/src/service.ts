import { execFileSync, spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, platform, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { HOST_HOME } from './state'

/**
 * Keeps `douchat-host run` alive without root: a systemd user unit on Linux,
 * a LaunchAgent on macOS, or a detached process when neither is available.
 */
export type ServiceKind = 'systemd' | 'launchd' | 'background'

export const HOST_BIN = join(HOST_HOME, 'bin', 'douchat-host')
export const LOG_FILE = join(HOST_HOME, 'logs', 'host.log')
export const PID_FILE = join(HOST_HOME, 'host.pid')
const SERVICE_FILE = join(HOST_HOME, 'service.json')
const UNIT_NAME = 'douchat-host.service'
const UNIT_FILE = join(homedir(), '.config', 'systemd', 'user', UNIT_NAME)
const LAUNCHD_LABEL = 'ai.douchat.host'
const PLIST_FILE = join(homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`)
const LOG_LIMIT = 10 * 1024 * 1024

const quiet = (command: string, args: string[]): boolean => {
  try { execFileSync(command, args, { stdio: 'ignore', timeout: 15_000 }); return true } catch { return false }
}
const output = (command: string, args: string[]): string => {
  try { return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 }).trim() } catch { return '' }
}
const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** systemd unit values: quote, and escape what systemd would expand. */
const unitValue = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%').replace(/\$/g, '$$$$')}"`
const launchdDomain = () => `gui/${process.getuid?.() ?? userInfo().uid}`

export function detectService(): ServiceKind {
  if (process.env.DOUCHAT_HOST_SERVICE === 'background') return 'background'
  if (platform() === 'darwin') return 'launchd'
  if (platform() === 'linux' && quiet('systemctl', ['--user', 'show-environment'])) return 'systemd'
  return 'background'
}

export function installedService(): ServiceKind | undefined {
  try { return (JSON.parse(readFileSync(SERVICE_FILE, 'utf8')) as { kind?: ServiceKind }).kind } catch { return undefined }
}

function writeFile(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, content, { mode: 0o600 })
  renameSync(temp, file)
}

function systemdUnit(): string {
  return [
    '[Unit]',
    'Description=Douchat host relay',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    `ExecStart=${unitValue(HOST_BIN)} run`,
    `Environment=DOUCHAT_HOST_HOME=${unitValue(HOST_HOME)}`,
    // A removed host exits 0 and stays stopped; crashes and network loss restart.
    'Restart=on-failure',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=default.target',
    ''
  ].join('\n')
}

function launchdPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key><array><string>${xml(HOST_BIN)}</string><string>run</string></array>
  <key>EnvironmentVariables</key><dict><key>DOUCHAT_HOST_HOME</key><string>${xml(HOST_HOME)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(LOG_FILE)}</string>
  <key>StandardErrorPath</key><string>${xml(LOG_FILE)}</string>
</dict>
</plist>
`
}

/** Registers the service and starts it. Returns notes worth showing the user. */
export function installService(kind = detectService()): string[] {
  const notes: string[] = []
  mkdirSync(dirname(LOG_FILE), { recursive: true, mode: 0o700 })
  const previous = installedService()
  if (previous && previous !== kind) removeService()
  if (kind === 'systemd') {
    writeFile(UNIT_FILE, systemdUnit())
    if (!quiet('systemctl', ['--user', 'daemon-reload'])) throw new Error('systemctl --user daemon-reload failed.')
    if (!quiet('systemctl', ['--user', 'enable', UNIT_NAME])) throw new Error(`systemctl --user enable ${UNIT_NAME} failed.`)
    if (!quiet('systemctl', ['--user', 'restart', UNIT_NAME])) throw new Error(`systemctl --user restart ${UNIT_NAME} failed. See: journalctl --user -u douchat-host`)
    // Without lingering, user services stop when the last session logs out.
    const user = userInfo().username
    if (output('loginctl', ['show-user', user, '-p', 'Linger']) !== 'Linger=yes' && !quiet('loginctl', ['enable-linger', user]))
      notes.push(`douchat-host stops when you log out. To keep it running, ask an administrator to run: sudo loginctl enable-linger ${user}`)
  } else if (kind === 'launchd') {
    writeFile(PLIST_FILE, launchdPlist())
    quiet('launchctl', ['bootout', `${launchdDomain()}/${LAUNCHD_LABEL}`])
    if (!quiet('launchctl', ['bootstrap', launchdDomain(), PLIST_FILE])) {
      if (!quiet('launchctl', ['load', '-w', PLIST_FILE])) throw new Error('launchctl could not load the douchat-host service.')
    }
    notes.push('On macOS, douchat-host runs while you are logged in to this Mac.')
  } else {
    stopBackground()
    startBackground()
    notes.push('No service manager was found, so douchat-host runs in the background and will not start again after a reboot. Run "douchat-host service start" after rebooting.')
  }
  writeFile(SERVICE_FILE, JSON.stringify({ kind }) + '\n')
  return notes
}

export function startService(): void {
  const kind = installedService()
  if (kind === 'systemd') { if (!quiet('systemctl', ['--user', 'start', UNIT_NAME])) throw new Error('Could not start the service.') }
  else if (kind === 'launchd') { if (!quiet('launchctl', ['kickstart', `${launchdDomain()}/${LAUNCHD_LABEL}`])) installService('launchd') }
  else startBackground()
}

export function stopService(): void {
  const kind = installedService()
  if (kind === 'systemd') quiet('systemctl', ['--user', 'stop', UNIT_NAME])
  else if (kind === 'launchd') quiet('launchctl', ['bootout', `${launchdDomain()}/${LAUNCHD_LABEL}`])
  stopBackground()
}

export function restartService(): void {
  const kind = installedService()
  if (kind === 'systemd') { if (!quiet('systemctl', ['--user', 'restart', UNIT_NAME])) throw new Error('Could not restart the service.') }
  else if (kind === 'launchd') installService('launchd')
  else if (kind === 'background') { stopBackground(); startBackground() }
}

export function removeService(): void {
  const kind = installedService()
  stopService()
  if (kind === 'systemd') {
    quiet('systemctl', ['--user', 'disable', UNIT_NAME])
    rmSync(UNIT_FILE, { force: true })
    quiet('systemctl', ['--user', 'daemon-reload'])
  } else if (kind === 'launchd') rmSync(PLIST_FILE, { force: true })
  rmSync(SERVICE_FILE, { force: true })
}

export function runningPid(): number | undefined {
  try {
    const pid = Number(readFileSync(PID_FILE, 'utf8').trim())
    if (!pid) return undefined
    process.kill(pid, 0)
    return pid
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM' ? Number(readFileSync(PID_FILE, 'utf8').trim()) : undefined
  }
}

export function serviceStatus(): string {
  const kind = installedService()
  const pid = runningPid()
  const state = pid ? `running (pid ${pid})` : 'not running'
  if (kind === 'systemd') return `systemd user service, ${output('systemctl', ['--user', 'is-active', UNIT_NAME]) || 'unknown'}; ${state}. Logs: journalctl --user -u douchat-host`
  if (kind === 'launchd') return `launchd agent ${LAUNCHD_LABEL}; ${state}. Logs: ${LOG_FILE}`
  if (kind === 'background') return `background process; ${state}. Logs: ${LOG_FILE}`
  return `no service installed; ${state}`
}

function startBackground(): void {
  if (runningPid()) return
  if (!existsSync(HOST_BIN)) throw new Error(`${HOST_BIN} is missing. Run the install command again.`)
  rotateLog()
  const log = openSync(LOG_FILE, 'a', 0o600)
  try {
    spawn(HOST_BIN, ['run'], { detached: true, stdio: ['ignore', log, log], env: { ...process.env, DOUCHAT_HOST_HOME: HOST_HOME } }).unref()
  } finally { closeSync(log) }
}

function stopBackground(): void {
  const pid = runningPid()
  if (!pid) return
  try { process.kill(pid, 'SIGTERM') } catch { return }
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try { process.kill(pid, 0) } catch { return }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200)
  }
  try { process.kill(pid, 'SIGKILL') } catch { /* gone */ }
}

/** Keeps one previous log file; launchd and background modes append to LOG_FILE. */
export function rotateLog(): void {
  try { if (statSync(LOG_FILE).size > LOG_LIMIT) renameSync(LOG_FILE, `${LOG_FILE}.1`) } catch { /* no log yet */ }
}
