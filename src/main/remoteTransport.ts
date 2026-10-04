import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, chmod, lstat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { RemoteAgentSpec } from '../shared/types'
import { REMOTE_BOOTSTRAP, encodePayload, probeScript } from './remoteScript'
import { parseRemoteProbe, validateRemoteSpec } from './remoteValidate'
import { killLocalProcess, spawnOwnedProcess, type LaunchSpec } from './localAgentConnection'
import { loginShellSshAuthSock } from './shellPath'
export type { LaunchSpec } from './localAgentConnection'

let controlDirectory: string | undefined
export function configureRemoteTransport(userDataPath?: string): void {
  controlDirectory = userDataPath && process.platform !== 'win32' ? join(userDataPath, 'ssh') : undefined
}

/** macOS sun_path is 104 bytes including NUL (Linux 108); use the smaller limit everywhere. */
export const UNIX_SOCKET_PATH_MAX = 103
/** `ControlMaster=auto` first listens on `<ControlPath>.<16 random chars>`, then renames it. */
export const CONTROL_TEMP_SUFFIX = 17
export const CONTROL_NAME_LENGTH = 16

/** Fingerprint of the effective target as ssh resolves it, so aliases that point at the
 * same account share a connection and edits to ~/.ssh/config pick a new socket. */
export function controlFingerprint(resolved: string): string | undefined {
  const values = new Map<string, string>()
  for (const line of resolved.split(/\r?\n/)) {
    const match = /^(\S+)\s+(.*)$/.exec(line.trim())
    if (match && !values.has(match[1].toLowerCase())) values.set(match[1].toLowerCase(), match[2])
  }
  const user = values.get('user'); const hostname = values.get('hostname'); const port = values.get('port')
  if (!user || !hostname || !port || !/^\d+$/.test(port)) return undefined
  const identity = [`${user}@${hostname}:${port}`, values.get('proxyjump') ?? 'none', values.get('proxycommand') ?? 'none']
  return createHash('sha256').update(identity.join('\n')).digest('hex').slice(0, CONTROL_NAME_LENGTH)
}

/** Full socket path, or undefined when even the temporary listener would not fit. */
export function controlSocketPath(directory: string, name: string): string | undefined {
  if (!/^[0-9a-f]{16}$/.test(name)) return undefined
  // ssh splits -o values on whitespace unless quoted, a quote cannot be escaped, and
  // ControlPath expands %tokens and a leading ~.
  if (!isAbsolute(directory) || /["\\%\0-\x1f]/.test(directory)) return undefined
  const path = join(directory, name)
  return Buffer.byteLength(path) + CONTROL_TEMP_SUFFIX <= UNIX_SOCKET_PATH_MAX ? path : undefined
}

async function resolveTarget(spec: RemoteAgentSpec): Promise<string | undefined> {
  const env = await sshLaunchEnvironment()
  return new Promise(resolve => {
    const child = spawn(sshBinary(), [...sshIdentityArgs(spec), '-G', '--', spec.host], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], shell: false })
    let output = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(undefined) }, 5000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (text: string) => { if (output.length < 65_536) output += text })
    child.once('error', () => { clearTimeout(timer); resolve(undefined) })
    child.once('close', code => { clearTimeout(timer); resolve(code === 0 ? output : undefined) })
  })
}

const controls = new Map<string, { at: number; value: Promise<string | undefined> }>()
const CONTROL_TTL = 60_000

/** Multiplexing is only a speed-up: any failure here means `ControlPath=none`. */
async function controlPath(spec: RemoteAgentSpec): Promise<string | undefined> {
  const directory = controlDirectory
  if (!directory) return undefined
  const key = hostKey(spec)
  const cached = controls.get(key)
  if (cached && Date.now() - cached.at < CONTROL_TTL) return cached.value
  const value = (async () => {
    const resolved = await resolveTarget(spec)
    const name = resolved ? controlFingerprint(resolved) : undefined
    const path = name ? controlSocketPath(directory, name) : undefined
    if (!path) return undefined
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await chmod(directory, 0o700)
      const info = await lstat(directory)
      if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid())) return undefined
      return path
    } catch { return undefined }
  })()
  controls.set(key, { at: Date.now(), value })
  return value
}
/** `-o ControlPath=...` value; quoted because Application Support has a space. */
export function controlPathOption(control: string): string { return `ControlPath="${control}"` }

/** Fixed system ssh; never resolved through PATH or a shell. */
export function sshBinary(platform = process.platform): string {
  return platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe') : '/usr/bin/ssh'
}

/** Only the variables ssh itself needs; API keys stay on this computer. */
export function sshEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const name of ['PATH', 'HOME', 'USER', 'LANG', 'SSH_AUTH_SOCK', ...(process.platform === 'win32' ? ['SystemRoot', 'USERPROFILE'] : [])]) {
    if (source[name]) env[name] = source[name]
  }
  return env
}

/** Exit status 0 means the agent at this socket is reachable and holds at least one key. */
function agentHasKeys(socket: string): Promise<boolean> {
  return new Promise(resolve => {
    execFile('/usr/bin/ssh-add', ['-l'], { env: { SSH_AUTH_SOCK: socket }, timeout: 3000, killSignal: 'SIGKILL' }, error => resolve(!error))
  })
}

let terminalAgentSocket: Promise<string | undefined> | undefined
/** A Finder-launched app gets launchd's default agent, while Terminal may export
 * another one from a shell startup file. Prefer the terminal's agent only when it
 * holds keys: `eval "$(ssh-agent)"` in an rc file starts an empty agent per shell. */
async function sshAgentSocket(): Promise<string | undefined> {
  const current = process.env.SSH_AUTH_SOCK
  if (process.platform === 'win32') return current
  const terminal = await loginShellSshAuthSock()
  if (!terminal || terminal === current) return current
  terminalAgentSocket ??= agentHasKeys(terminal).then(usable => usable ? terminal : undefined)
  const chosen = await terminalAgentSocket
  // Recheck later: the agent may be unlocked or loaded after Douchat started.
  if (!chosen) terminalAgentSocket = undefined
  return chosen ?? current
}

/** The ssh environment for an actual launch, using the terminal's agent when needed. */
export async function sshLaunchEnvironment(): Promise<NodeJS.ProcessEnv> {
  const socket = await sshAgentSocket()
  return sshEnvironment({ ...process.env, ...(socket ? { SSH_AUTH_SOCK: socket } : {}) })
}

export function sshIdentityArgs(spec: RemoteAgentSpec): string[] {
  return [
    ...(spec.port ? ['-p', String(spec.port)] : []),
    ...(spec.user ? ['-l', spec.user] : []),
    ...(spec.identityFile ? ['-i', spec.identityFile, '-o', 'IdentitiesOnly=yes'] : [])
  ]
}

const HARDENING = [
  '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
  '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no',
  '-o', 'PermitLocalCommand=no', '-o', 'ConnectTimeout=10',
  '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3'
]

export function sshArgs(spec: RemoteAgentSpec, script: string, control?: string): string[] {
  return [
    '-T', ...HARDENING, '-o', 'ClearAllForwardings=yes',
    ...(control ? ['-o', 'ControlMaster=auto', '-o', controlPathOption(control), '-o', 'ControlPersist=300'] : ['-o', 'ControlPath=none']),
    ...sshIdentityArgs(spec),
    '--', spec.host, REMOTE_BOOTSTRAP, encodePayload(script)
  ]
}

/** Reverse UNIX-socket forward used only by the remote skill bridge. */
export function sshBridgeArgs(spec: RemoteAgentSpec, socketPath: string, port: number): string[] {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid bridge port')
  return [
    '-N', '-T', ...HARDENING,
    '-o', 'ControlPath=none', '-o', 'ExitOnForwardFailure=yes',
    '-o', 'StreamLocalBindMask=0177', '-o', 'StreamLocalBindUnlink=no',
    ...sshIdentityArgs(spec),
    '-R', `${socketPath}:127.0.0.1:${port}`,
    '--', spec.host
  ]
}

const usedHosts = new Map<string, { spec: RemoteAgentSpec; control: string }>()
function hostKey(spec: RemoteAgentSpec): string { return JSON.stringify([spec.host, spec.port ?? null, spec.user ?? null, spec.identityFile ?? null]) }

/** Launch the remote script over ssh. Everything dynamic is in the base64 payload. */
export async function remoteLaunch(spec: RemoteAgentSpec, script: string): Promise<LaunchSpec> {
  const control = await controlPath(spec)
  if (control) usedHosts.set(hostKey(spec), { spec, control })
  return { file: sshBinary(), args: sshArgs(spec, script, control), env: await sshLaunchEnvironment() }
}

export function spawnLaunch(launch: LaunchSpec): ChildProcessWithoutNullStreams {
  return spawnOwnedProcess(launch.file, launch.args, { cwd: launch.cwd, env: launch.env, windowsHide: true, shell: false })
}

export interface RemoteExecResult { code: number | null; stdout: Buffer; stderr: string }
export interface RemoteExecOptions { input?: Uint8Array; signal?: AbortSignal; timeoutMs?: number; maxStdout?: number }

/** The single entry point for short remote operations (prepare, upload, fetch, clean). */
export async function remoteExec(spec: RemoteAgentSpec, script: string, options: RemoteExecOptions = {}): Promise<RemoteExecResult> {
  const launch = await remoteLaunch(spec, script)
  options.signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawnLaunch(launch)
    const chunks: Buffer[] = []
    let size = 0
    let stderr = ''
    let failure: Error | undefined
    const stop = (error: Error): void => { failure ??= error; killLocalProcess(child) }
    const abort = (): void => stop(new Error('Stopped'))
    const timer = setTimeout(() => stop(new Error('The server did not respond in time')), options.timeoutMs ?? 60_000)
    options.signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > (options.maxStdout ?? 1024 * 1024)) { stop(new Error('The server returned more data than allowed')); return }
      chunks.push(chunk)
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (text: string) => { stderr = (stderr + text).slice(-4000) })
    child.once('error', error => stop(error))
    child.once('close', code => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      if (failure) reject(failure)
      else resolve({ code, stdout: Buffer.concat(chunks), stderr })
    })
    child.stdin.on('error', () => { /* close reports the process result. */ })
    child.stdin.end(options.input ? Buffer.from(options.input) : undefined)
  })
}

/** Readable diagnostics for the common ssh failures. */
export function sshFailure(spec: RemoteAgentSpec, stderr: string, code: number | null): Error {
  const host = spec.host
  if (/Host key verification failed|No .*host key is known|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(stderr)) {
    return new Error(`The host key for ${host} is not trusted yet. Run "ssh ${host}" once in Terminal to verify its fingerprint, then try again.`)
  }
  if (/Permission denied|Too many authentication failures/i.test(stderr)) return new Error(`SSH authentication to ${host} failed. Douchat runs /usr/bin/ssh without prompts, so it cannot enter a password or key passphrase. Check with "/usr/bin/ssh -o BatchMode=yes ${host} true" in Terminal; if that fails, load the key into ssh-agent (ssh-add) or set its identity file.`)
  if (/Could not resolve hostname|Name or service not known/i.test(stderr)) return new Error(`Could not resolve ${host}.`)
  if (/Connection refused|Connection timed out|Operation timed out|No route to host/i.test(stderr)) return new Error(`Could not connect to ${host}.`)
  const text = stderr.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').trim().slice(-800)
  return new Error(`${host}: ${text || `Remote command exited with status ${code ?? 'unknown'}`}`)
}

export async function remoteCheck(spec: RemoteAgentSpec, script: string, options: RemoteExecOptions = {}): Promise<Buffer> {
  const result = await remoteExec(spec, script, options)
  if (result.code !== 0) throw sshFailure(spec, result.stderr, result.code)
  return result.stdout
}

/** Linux MAX_ARG_STRLEN is 128 KiB per argument; fail locally, before sending. */
export const MAX_ARGV_PROMPT_BYTES = 120 * 1024
export function assertArgvPrompt(prompt: string): void {
  if (Buffer.byteLength(prompt) > MAX_ARGV_PROMPT_BYTES) {
    throw new Error('This prompt is too long for a remote agent that receives it as a command argument (120 KB). Shorten the conversation or use an agent that reads from stdin.')
  }
}
/** argv and $(cat) cannot carry NUL bytes. */
export function remotePrompt(prompt: string): string { return prompt.replaceAll('\0', '') }

const probes = new Map<string, { at: number; value: Promise<RemoteAgentSpec> }>()
const PROBE_TTL = 10 * 60_000

/** Resolve the executable, login PATH and HOME on the server. Cached for 10 minutes. */
export async function probeRemoteAgent(input: RemoteAgentSpec, signal?: AbortSignal, fresh = false): Promise<RemoteAgentSpec & { remotePath: string; remoteHome: string }> {
  const spec = await validateRemoteSpec(input)
  const key = JSON.stringify(spec)
  const cached = probes.get(key)
  if (!fresh && cached && Date.now() - cached.at < PROBE_TTL) return cached.value as Promise<RemoteAgentSpec & { remotePath: string; remoteHome: string }>
  const value = (async () => {
    const output = (await remoteCheck(spec, probeScript(spec.executable), { signal, timeoutMs: 30_000, maxStdout: 16_384 })).toString('utf8')
    const probe = parseRemoteProbe(output)
    return { ...spec, executable: probe.executable, remotePath: probe.remotePath, remoteHome: probe.remoteHome }
  })()
  probes.set(key, { at: Date.now(), value })
  value.catch(() => { if (probes.get(key)?.value === value) probes.delete(key) })
  return value as Promise<RemoteAgentSpec & { remotePath: string; remoteHome: string }>
}
export function forgetRemoteProbes(): void { probes.clear() }

/** Close multiplexed master connections when agents stop or the app quits. */
export async function closeRemoteConnections(spec?: RemoteAgentSpec): Promise<void> {
  const targets = spec ? [usedHosts.get(hostKey(spec))].filter(Boolean) as { spec: RemoteAgentSpec; control: string }[] : [...usedHosts.values()]
  if (spec) controls.delete(hostKey(spec)); else controls.clear()
  const env = await sshLaunchEnvironment()
  await Promise.all(targets.map(({ spec: target, control }) => new Promise<void>(resolve => {
    usedHosts.delete(hostKey(target))
    const child = spawn(sshBinary(), ['-o', controlPathOption(control), '-O', 'exit', ...sshIdentityArgs(target), '--', target.host], {
      env, windowsHide: true, stdio: 'ignore', shell: false
    })
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 3000)
    child.once('error', () => { clearTimeout(timer); resolve() })
    child.once('close', () => { clearTimeout(timer); resolve() })
  })))
}
