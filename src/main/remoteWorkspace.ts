import { posix } from 'node:path'
import type { RemoteAgentSpec, RemoteDirectoryListing } from '../shared/types'
import { remoteCheck, sshIdentityArgs } from './remoteTransport'
import { REMOTE_BOOTSTRAP, assertRemoteWorkspacePath, encodePayload, listDirectoriesScript, resolveDirectoryScript } from './remoteScript'
import { shQuote } from './remoteValidate'

/** System locations on Linux and macOS servers; the folder and everything below it is refused. */
const SYSTEM_ROOTS = ['/etc', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/var', '/proc', '/sys', '/dev', '/boot', '/run', '/snap',
  '/System', '/Library', '/private', '/Applications', '/opt/homebrew']
/** Douchat's and ssh's own data on the server: refused, together with every folder that contains them. */
const PRIVATE_FOLDERS = ['.ssh', '.douchat-remote', '.douchat-host']

const inside = (child: string, parent: string): boolean => child === parent || child.startsWith(parent === '/' ? '/' : `${parent}/`)

/** Step 1: structure only. The server is not asked anything yet. */
export function checkRemoteFolderSyntax(path: unknown): string {
  if (typeof path !== 'string') throw new Error('Choose a folder on the server.')
  try { assertRemoteWorkspacePath(path) } catch { throw new Error('Choose an absolute, normalized folder path on the server.') }
  if (posix.normalize(path) !== path) throw new Error('Choose an absolute, normalized folder path on the server.')
  return path
}

/** Step 2 rules, applied to the canonical path the server returned.
 * `homes` are the server's home folder as reported and as resolved by `pwd -P`.
 * On macOS servers the file system usually ignores case, so names are compared
 * case-insensitively there. */
export function checkRemoteFolderPolicy(path: string, homes: string | string[], caseInsensitive = false): string {
  checkRemoteFolderSyntax(path)
  const fold = (value: string): string => caseInsensitive ? value.toLowerCase() : value
  const target = fold(path)
  const homeList = [...new Set((Array.isArray(homes) ? homes : [homes]).map(fold))]
  if (path === '/') throw new Error('The server root cannot be used as a workspace.')
  for (const home of homeList) {
    if (target === home) throw new Error('The home folder on the server cannot be used directly. Choose a project folder inside it.')
    for (const name of PRIVATE_FOLDERS) {
      const folder = posix.join(home, fold(name))
      if (inside(target, folder) || inside(folder, target)) throw new Error('This folder holds SSH or Douchat data on the server and cannot be used as a workspace.')
    }
  }
  // A home folder that lives under a system location (/var/home on Fedora
  // Atomic) is still the user's own; everything else there is refused.
  const inHome = homeList.some(home => inside(target, home))
  if (!inHome && SYSTEM_ROOTS.some(root => inside(target, fold(root)))) throw new Error('System folders on the server cannot be used as a workspace.')
  return path
}

/** A child folder name from the browser; never a path. */
export function checkFolderName(name: unknown): string {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || name.includes('/') || name.length > 255 || /[\0-\x1f\x7f]/.test(name)) throw new Error('Invalid folder name.')
  return name
}

type Exec = typeof remoteCheck

/** One level of folders. `name` descends into a child of `parent`; the
 * renderer never sends a joined path. The server's answer is untrusted. */
export async function listRemoteDirectories(spec: RemoteAgentSpec & { remoteHome: string }, parent?: string, name?: string, signal?: AbortSignal, exec: Exec = remoteCheck): Promise<RemoteDirectoryListing> {
  const base = parent === undefined ? spec.remoteHome : checkRemoteFolderSyntax(parent)
  const target = name === undefined ? base : posix.join(base, checkFolderName(name))
  const output = await exec(spec, listDirectoriesScript(target), { signal, timeoutMs: 20_000, maxStdout: 256 * 1024 })
  const [first, ...rest] = output.toString('utf8').split('\n')
  const path = checkRemoteFolderSyntax(first)
  const directories = rest.filter(item => { try { return checkFolderName(item) === item && !item.startsWith('.') } catch { return false } }).slice(0, 500)
  return { path, directories: [...new Set(directories)].sort((a, b) => a.localeCompare(b)) }
}

/** Resolve a chosen folder on the server and check it. The saved value is the
 * real path, so a later symlink swap is detected at launch instead of followed.
 * `name`, when given, is a child of `parent`; main joins them. */
export async function resolveRemoteWorkspace(spec: RemoteAgentSpec & { remoteHome: string }, parent: unknown, name?: unknown, signal?: AbortSignal, exec: Exec = remoteCheck): Promise<string> {
  const base = checkRemoteFolderSyntax(parent)
  const requested = name === undefined ? base : posix.join(base, checkFolderName(name))
  const [system, home, resolved] = (await exec(spec, resolveDirectoryScript(requested), { signal, timeoutMs: 20_000, maxStdout: 4096 })).toString('utf8').split('\n')
  const homes = [checkRemoteFolderSyntax(home), spec.remoteHome]
  const caseInsensitive = system.trim() === 'Darwin'
  // Refuse obviously private requests before trusting what the server resolved, then check the real path.
  checkRemoteFolderPolicy(requested, homes, caseInsensitive)
  return checkRemoteFolderPolicy(checkRemoteFolderSyntax(resolved), homes, caseInsensitive)
}

/** ssh argv for an interactive shell in a folder on the server. Host, user,
 * port and key were validated when the agent was saved; the folder only
 * travels inside the base64 payload. */
export function remoteTerminalArgs(spec: RemoteAgentSpec, path?: string): string[] {
  const script = `${path === undefined ? '' : `cd -- ${shQuote(checkRemoteFolderSyntax(path))} || exit 1\n`}exec "\${SHELL:-/bin/sh}" -l\n`
  return ['-t', ...sshIdentityArgs(spec), '--', spec.host, REMOTE_BOOTSTRAP, encodePayload(script)]
}
