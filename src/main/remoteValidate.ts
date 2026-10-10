import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, posix } from 'node:path'
import { REMOTE_AGENT_ADAPTERS, type RemoteAgentAdapter, type RemoteAgentSpec } from '../shared/types'

/** The single escaping function for dynamic values in remote POSIX scripts.
 * Values that cannot be represented safely on one line are rejected. */
export function shQuote(value: string): string {
  if (typeof value !== 'string') throw new Error('Invalid remote shell value')
  if (/[\0\r\n]/.test(value)) throw new Error('Remote values cannot contain NUL or line breaks')
  return `'${value.replaceAll("'", `'\\''`)}'`
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function assertUuid(value: string | undefined, label = 'identifier'): string {
  if (!value || !UUID.test(value)) throw new Error(`Invalid remote ${label}`)
  return value.toLowerCase()
}

const HOST = /^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,252}|\[[0-9A-Fa-f:.]+\])$/
const USER = /^[A-Za-z_][A-Za-z0-9._-]{0,31}$/
export const COMMAND_NAME = /^[A-Za-z0-9._+][A-Za-z0-9._+-]{0,63}$/
const CONTROL = /[\0-\x1f\x7f]/

function absolutePosixPath(value: string, label: string, max = 1024): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > max || CONTROL.test(value)) throw new Error(`${label} must be an absolute path on the server.`)
  if (value.split('/').includes('..')) throw new Error(`${label} cannot contain "..".`)
  const normalized = posix.normalize(value)
  const trimmed = normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized
  if (trimmed !== (value.length > 1 ? value.replace(/\/$/, '') : value)) throw new Error(`${label} must be a normalized absolute path.`)
  return trimmed
}

/** Arguments that would remove the sandbox or approval boundary Douchat relies on. */
export function dangerousRemoteArgument(adapter: RemoteAgentAdapter, args: string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    const next = args[index + 1] ?? ''
    const [flag, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined]
    const value = inline ?? next
    if (adapter === 'codex') {
      if (['--dangerously-bypass-approvals-and-sandbox', '--yolo', '--full-auto'].includes(flag)) return arg
      if (['-s', '--sandbox', '-a', '--ask-for-approval'].includes(flag)) return arg
      if (/^-s./.test(arg) || /^-a./.test(arg)) return arg
      if ((flag === '-c' || flag === '--config') && /^\s*(?:sandbox_mode|approval_policy|sandbox_permissions)\b/.test(value)) return `${arg} ${inline === undefined ? next : ''}`.trim()
      if (/^-c(?:sandbox_mode|approval_policy)/.test(arg)) return arg
    }
    if (adapter === 'claude') {
      if (['--dangerously-skip-permissions', '--allow-dangerously-skip-permissions'].includes(flag)) return arg
      if (flag === '--permission-mode' && /^bypassPermissions$/i.test(value)) return `${flag} ${value}`
    }
    if (adapter === 'grok' && ['--sandbox', '--permission-mode', '--yolo', '--dangerously-skip-permissions'].includes(flag)) return arg
    if (adapter === 'gemini') {
      if (['--yolo', '-y'].includes(flag)) return arg
      if (flag === '--approval-mode' && /^yolo$/i.test(value)) return `${flag} ${value}`
    }
  }
  return undefined
}

/** Structural validation that needs no I/O. Rejects instead of repairing. */
export function normalizeRemoteSpec(input: unknown): RemoteAgentSpec {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid remote agent settings.')
  const value = input as Record<string, unknown>
  if (value.transport !== 'ssh') throw new Error('Only SSH remote agents are supported.')
  const host = String(value.host ?? '').trim()
  if (!HOST.test(host)) throw new Error('Enter a valid server host name or [IPv6] address.')
  let port: number | undefined
  if (value.port !== undefined && value.port !== null && value.port !== '') {
    port = Number(value.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535.')
  }
  let user: string | undefined
  if (value.user !== undefined && value.user !== null && value.user !== '') {
    user = String(value.user).trim()
    if (!USER.test(user)) throw new Error('Enter a valid SSH user name.')
  }
  let identityFile: string | undefined
  if (value.identityFile !== undefined && value.identityFile !== null && value.identityFile !== '') {
    identityFile = String(value.identityFile)
    if (!isAbsolute(identityFile) || identityFile.length > 1024 || CONTROL.test(identityFile)) throw new Error('Identity file must be an absolute path on this computer.')
  }
  const adapter = String(value.adapter ?? '') as RemoteAgentAdapter
  if (!REMOTE_AGENT_ADAPTERS.includes(adapter)) throw new Error('Choose a supported remote agent type.')
  const executable = String(value.executable ?? '').trim()
  if (!COMMAND_NAME.test(executable)) {
    if (!executable.startsWith('/')) throw new Error('Enter a command name or an absolute path on the server.')
    absolutePosixPath(executable, 'Executable')
  }
  const args = value.args ?? []
  if (!Array.isArray(args) || args.length > 32 || args.some(arg => typeof arg !== 'string' || Buffer.byteLength(arg) > 1024 || /[\0\r\n]/.test(arg))) {
    throw new Error('Enter up to 32 arguments, each on one line and at most 1024 bytes.')
  }
  if (adapter !== 'custom' && args.some(arg => arg.includes('{prompt}'))) throw new Error('{prompt} is only available for custom agents.')
  const dangerous = dangerousRemoteArgument(adapter, args as string[])
  if (dangerous) throw new Error(`This argument disables the agent's safety boundary and is not allowed: ${dangerous}`)
  // remoteCwd from earlier builds is ignored: Douchat assigns the server folder.
  const remotePath = value.remotePath === undefined || value.remotePath === '' ? undefined : validRemotePath(String(value.remotePath))
  const remoteHome = value.remoteHome === undefined || value.remoteHome === '' ? undefined : validRemoteHome(String(value.remoteHome))
  return {
    transport: 'ssh', host, ...(port ? { port } : {}), ...(user ? { user } : {}), ...(identityFile ? { identityFile } : {}),
    adapter, executable, args: [...args as string[]],
    ...(remotePath ? { remotePath } : {}), ...(remoteHome ? { remoteHome } : {})
  }
}

/** Full validation, including the local key file. Run before save and launch. */
export async function validateRemoteSpec(input: unknown): Promise<RemoteAgentSpec> {
  const spec = normalizeRemoteSpec(input)
  if (spec.identityFile) {
    let resolved: string
    try { resolved = await realpath(spec.identityFile) } catch { throw new Error('Identity file was not found.') }
    const info = await lstat(resolved)
    if (!info.isFile()) throw new Error('Identity file must be a regular file.')
    if (CONTROL.test(resolved)) throw new Error('Invalid identity file path.')
    spec.identityFile = resolved
  }
  return spec
}

export function validRemotePath(value: string): string {
  if (value.length > 4096 || CONTROL.test(value) || !value) throw new Error('Invalid remote PATH')
  if (value.split(':').some(part => part && !part.startsWith('/'))) throw new Error('Remote PATH entries must be absolute')
  return value
}
export function validRemoteHome(value: string): string {
  if (value.includes(':')) throw new Error('Invalid remote home directory')
  return absolutePosixPath(value, 'Remote home directory')
}
export function validRemoteExecutable(value: string): string {
  if (!value.startsWith('/')) throw new Error('Remote executable was not found')
  return absolutePosixPath(value, 'Remote executable')
}

/** Output of the fixed probe script: executable, PATH and HOME. The server is
 * untrusted, so every value is checked. */
export function parseRemoteProbe(output: string): { executable: string; remotePath: string; remoteHome: string } {
  const lines = output.replace(/\r/g, '').replace(/\n$/, '').split('\n')
  if (lines.length < 3) throw new Error('The server returned an invalid probe response')
  const [executable, remotePath, remoteHome] = lines.slice(-3)
  if (!executable) throw new Error('The agent executable was not found in the server login PATH')
  return { executable: validRemoteExecutable(executable), remotePath: validRemotePath(remotePath), remoteHome: validRemoteHome(remoteHome) }
}

/** Short, stable host label for approvals and UI badges. */
export function remoteHostLabel(spec: Pick<RemoteAgentSpec, 'host' | 'user' | 'port'>): string {
  return `${spec.user ? `${spec.user}@` : ''}${spec.host}${spec.port && spec.port !== 22 ? `:${spec.port}` : ''}`
}
