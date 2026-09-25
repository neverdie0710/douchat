import { createHash, randomUUID } from 'node:crypto'
import { accessSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, parse, relative, sep } from 'node:path'
import type { AgentConfig } from '../shared/types'

let root: string | undefined
let dataRoot: string | undefined
export function configureLocalWorkspaces(userData?: string): void { dataRoot = userData; root = userData ? join(userData, 'local-workspaces') : undefined }

const inside = (child: string, parent: string): boolean => {
  const path = relative(parent, child)
  return path === '' || (!!path && !path.startsWith('..' + sep) && path !== '..' && !isAbsolute(path))
}
const SYSTEM_ROOTS = process.platform === 'win32'
  ? [process.env.SystemRoot || 'C:\\Windows', process.env.ProgramFiles || 'C:\\Program Files', process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', process.env.ProgramData || 'C:\\ProgramData']
  : ['/System', '/Library', '/Applications', '/usr', '/bin', '/sbin', '/etc', '/var', '/private', '/dev', '/opt/homebrew', '/boot', '/proc', '/sys', '/lib', '/lib64', '/snap']

/** Resolve and check a user-chosen folder. Refuses the filesystem root, the
 * home folder itself, system locations and Douchat's own data directory. */
export function validateWorkspaceFolder(path: unknown, { home = homedir(), systemRoots = SYSTEM_ROOTS }: { home?: string; systemRoots?: string[] } = {}): string {
  if (typeof path !== 'string' || !path.trim() || !isAbsolute(path)) throw new Error('Choose an absolute folder path.')
  let resolved: string
  try { resolved = realpathSync(path) } catch { throw new Error(`Folder not found: ${path}`) }
  if (!statSync(resolved).isDirectory()) throw new Error(`Not a folder: ${resolved}`)
  let realHome = home
  try { realHome = realpathSync(home) } catch { /* Keep the configured value. */ }
  if (resolved === parse(resolved).root) throw new Error('The disk root cannot be used as a workspace.')
  if (resolved === realHome) throw new Error('Your home folder cannot be used directly. Choose a project folder inside it.')
  for (const system of systemRoots) {
    let candidate = system
    try { candidate = realpathSync(system) } catch { /* Missing on this platform. */ }
    if (inside(resolved, candidate) && !inside(resolved, realHome)) throw new Error('System folders cannot be used as a workspace.')
  }
  if (dataRoot) {
    let data = dataRoot
    try { data = realpathSync(dataRoot) } catch { /* Not created yet. */ }
    if (inside(resolved, data) || inside(data, resolved)) throw new Error("Douchat's data folder cannot be used as a workspace.")
  }
  try { accessSync(resolved, constants.R_OK | constants.W_OK) } catch { throw new Error(`Douchat cannot read and write this folder: ${resolved}`) }
  return resolved
}

/** A saved custom folder may later be deleted or moved; never recreate it. */
export function resolveSavedWorkspace(path: string, options?: Parameters<typeof validateWorkspaceFolder>[1]): string {
  try { return validateWorkspaceFolder(path, options) } catch (error) {
    throw new Error(`The workspace folder for this chat is unavailable (${path}). ${error instanceof Error ? error.message : ''} Choose another folder or restore the default in chat details.`)
  }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
interface RecordData { owner: string; agent: string; sessionKey: string; generation: string; fingerprint: string; thread?: string }
function read(file: string): RecordData | undefined {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return
    throw error
  }
}
function save(file: string, value: RecordData): void {
  const temporary = file + '.' + randomUUID() + '.tmp'
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 })
  renameSync(temporary, file)
}
export function localWorkspace(config: AgentConfig, sessionKey?: string, customDirectory?: string) {
  if (!root) return undefined
  if (!config.ownerId) throw new Error('A local workspace requires an account.')
  const key = sessionKey || `agent:${config.id}`
  const id = hash(JSON.stringify([config.ownerId, config.id, key]))
  const records = join(root, 'sessions')
  mkdirSync(records, { recursive: true, mode: 0o700 })
  const file = join(records, id + '.json')
  // The folder is part of the binding: a native thread must not resume against other files.
  const fingerprint = hash(JSON.stringify([config.localAgentId, config.instructions, config.role, config.name, config.model, ...(config.thinkingLevel ? [config.thinkingLevel] : []), ...(customDirectory ? [{ folder: customDirectory }] : [])]))
  const old = read(file)
  const record: RecordData = { owner: config.ownerId, agent: config.id, sessionKey: key,
    generation: old?.generation && /^[a-f0-9-]{36}$/.test(old.generation) ? old.generation : randomUUID(), fingerprint,
    ...(old?.fingerprint === fingerprint && old.thread ? { thread: old.thread } : {}) }
  save(file, record)
  let directory = customDirectory
  if (!directory) {
    const legacyDirectory = join(root, 'files', hash(config.ownerId), hash(config.id), id, record.generation)
    // Cursor flattens the entire workspace path into one directory name for its
    // trust marker (NAME_MAX = 255). The session hash already isolates owner,
    // agent and topic, so the extra owner/agent hashes are redundant here.
    const compactDirectory = join(root, 'cursor', id, record.generation)
    directory = config.localAgentId === 'cursor' || existsSync(compactDirectory) ? compactDirectory : legacyDirectory
    if (directory === compactDirectory && !existsSync(directory) && existsSync(legacyDirectory)) {
      mkdirSync(join(root, 'cursor', id), { recursive: true, mode: 0o700 })
      renameSync(legacyDirectory, directory)
    }
    mkdirSync(directory, { recursive: true, mode: 0o700 })
  }
  return { directory, custom: Boolean(customDirectory), thread: record.thread, remember(thread?: string) {
    // A late completion must never restore a session invalidated by Clear chat.
    const current = read(file)
    if (current?.generation !== record.generation || current.fingerprint !== fingerprint) return
    save(file, { ...record, thread })
  } }
}
export function resetLocalWorkspaces(owner: string, matches: (sessionKey: string, agentId: string) => boolean): void {
  if (!root || !existsSync(join(root, 'sessions'))) return
  for (const name of readdirSync(join(root, 'sessions'))) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue
    const file = join(root, 'sessions', name)
    const record = read(file)
    if (record?.owner === owner && matches(record.sessionKey, record.agent)) {
      save(file, { ...record, generation: randomUUID(), thread: undefined })
    }
  }
}
