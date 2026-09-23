import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentConfig } from '../shared/types'

let root: string | undefined
export function configureLocalWorkspaces(userData?: string): void { root = userData ? join(userData, 'local-workspaces') : undefined }
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
export function localWorkspace(config: AgentConfig, sessionKey?: string) {
  if (!root) return undefined
  if (!config.ownerId) throw new Error('A local workspace requires an account.')
  const key = sessionKey || `agent:${config.id}`
  const id = hash(JSON.stringify([config.ownerId, config.id, key]))
  const records = join(root, 'sessions')
  mkdirSync(records, { recursive: true, mode: 0o700 })
  const file = join(records, id + '.json')
  const fingerprint = hash(JSON.stringify([config.localAgentId, config.instructions, config.role, config.name, config.model]))
  const old = read(file)
  const record: RecordData = { owner: config.ownerId, agent: config.id, sessionKey: key,
    generation: old?.generation && /^[a-f0-9-]{36}$/.test(old.generation) ? old.generation : randomUUID(), fingerprint,
    ...(old?.fingerprint === fingerprint && old.thread ? { thread: old.thread } : {}) }
  save(file, record)
  const directory = join(root, 'files', hash(config.ownerId), hash(config.id), id, record.generation)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  return { directory, thread: record.thread, remember(thread?: string) {
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
