import { executableCommand } from './windowsCommand'
import { changedLocalAgentSettings } from './localAgentSettingsVersion'
import type { CustomLocalAgentInput, ExecutionTarget, LocalAgent, RemoteAgentSpec } from '../shared/types'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { resolveExecutable, executableEnvironment } from './shellPath'
import { normalizeRemoteSpec, remoteHostLabel, validateRemoteSpec } from './remoteValidate'
import { forgetRemoteProbes, probeRemoteAgent } from './remoteTransport'

const execFileAsync = promisify(execFile)
let customRegistryPath: string | undefined

interface CustomLocalAgentDefinition extends CustomLocalAgentInput {
  id: string
  /** Main-only: increased whenever the server identity of a remote agent changes. */
  remoteTargetRevision?: number
}

/** Stable identity of an SSH target. Defaults are normalized, so `host` and
 * `host:22` are the same server; any change of host, port, user or key is a new target. */
export function remoteTargetId(spec: Pick<RemoteAgentSpec, 'host' | 'port' | 'user' | 'identityFile'>): string {
  return `ssh-legacy:${createHash('sha256').update(JSON.stringify([spec.host.toLowerCase(), spec.port ?? 22, spec.user ?? '', spec.identityFile ?? ''])).digest('hex').slice(0, 32)}`
}
function remoteTarget(definition: Pick<CustomLocalAgentDefinition, 'remote' | 'remoteTargetRevision'>): ExecutionTarget | undefined {
  return definition.remote ? { executionTargetId: remoteTargetId(definition.remote), targetRevision: definition.remoteTargetRevision ?? 0 } : undefined
}

const CUSTOM_ID = /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function configureLocalAgentRegistry(userDataPath?: string): void {
  customRegistryPath = userDataPath ? join(userDataPath, 'local-agents.json') : undefined
}

function customDefinition(value: unknown): CustomLocalAgentDefinition | undefined {
  if (!value || typeof value !== 'object') return undefined
  const input = value as Record<string, unknown>
  const id = String(input.id ?? '').trim()
  if (!CUSTOM_ID.test(id) && !localAgentCatalog.some(item => item[0] === id)) return undefined
  const revision = input.remoteTargetRevision
  try {
    return { id, ...validateLocalAgentInput(input as unknown as CustomLocalAgentInput),
      ...(Number.isSafeInteger(revision) && (revision as number) > 0 ? { remoteTargetRevision: revision as number } : {}) }
  } catch { return undefined }
}

async function customDefinitions(): Promise<CustomLocalAgentDefinition[]> {
  if (!customRegistryPath) return []
  try {
    const parsed = JSON.parse(await readFile(customRegistryPath, 'utf8')) as unknown
    if (!Array.isArray(parsed)) { remoteSpecs.clear(); remoteTargets.clear(); return [] }
    const definitions = parsed.map(customDefinition).filter((item): item is CustomLocalAgentDefinition => Boolean(item)).slice(0, 75)
    remoteSpecs.clear(); remoteTargets.clear()
    for (const item of definitions) if (item.remote) { remoteSpecs.set(item.id, item.remote); remoteTargets.set(item.id, remoteTarget(item)!) }
    return definitions
  } catch {
    remoteSpecs.clear(); remoteTargets.clear()
    return []
  }
}

/** Last validated remote settings, for synchronous labelling (group context, UI). */
const remoteSpecs = new Map<string, RemoteAgentSpec>()
const remoteTargets = new Map<string, ExecutionTarget>()
export function cachedRemoteAgentTarget(id: string | undefined): ExecutionTarget | undefined {
  return id ? remoteTargets.get(id) : undefined
}
/** Fresh lookup of a remote agent's settings together with its server identity. */
export async function remoteAgentPlacement(id: string | undefined): Promise<{ spec: RemoteAgentSpec; target: ExecutionTarget } | undefined> {
  if (!id || !CUSTOM_ID.test(id)) return undefined
  const definition = (await customDefinitions()).find(item => item.id === id)
  return definition?.remote ? { spec: definition.remote, target: remoteTarget(definition)! } : undefined
}
export function cachedRemoteAgentSpec(id: string | undefined): RemoteAgentSpec | undefined {
  return id ? remoteSpecs.get(id) : undefined
}
/** Fresh lookup from the registry; undefined for agents running on this computer. */
export async function remoteAgentSpec(id: string | undefined): Promise<RemoteAgentSpec | undefined> {
  if (!id || !CUSTOM_ID.test(id)) return undefined
  return (await customDefinitions()).find(item => item.id === id)?.remote
}

async function writeCustomDefinitions(definitions: CustomLocalAgentDefinition[]): Promise<void> {
  if (!customRegistryPath) throw new Error('Local agent registry is unavailable')
  await mkdir(dirname(customRegistryPath), { recursive: true })
  const temporary = `${customRegistryPath}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(definitions, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, customRegistryPath)
}

export function validateLocalAgentInput(input: CustomLocalAgentInput): CustomLocalAgentInput {
  if (input?.remote !== undefined && input.remote !== null) {
    // Remote agents use structured fields only; `command` mirrors the remote executable.
    const remote = normalizeRemoteSpec(input.remote)
    const name = String(input?.name ?? '').trim()
    if (!name || name.length > 80) throw new Error('Enter a local agent name of 80 characters or fewer.')
    const avatar = input.avatar || undefined
    if (avatar && (typeof avatar !== 'string' || avatar.length > 512_000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar))) throw new Error('Choose a PNG, JPEG or WebP avatar.')
    return { name, command: remote.executable, args: [], avatar, remote }
  }
  const name = String(input?.name ?? '').trim()
  const command = String(input?.command ?? '').trim()
  if (!name || name.length > 80) throw new Error('Enter a local agent name of 80 characters or fewer.')
  if (!command || command.length > 2_048 || /[\0\r\n]/.test(command)) throw new Error('Enter a valid executable command or absolute path.')
  if (!/[\\/]/.test(command) && /\s/.test(command)) throw new Error('A command name cannot contain spaces. Use an absolute path instead.')
  const args = input.args ?? []
  if (!Array.isArray(args) || args.length > 128 || args.some(arg => typeof arg !== 'string' || arg.includes('\0')) || JSON.stringify(args).length > 16384) throw new Error('Enter valid startup arguments.')
  const avatar = input.avatar || undefined
  if (avatar && (typeof avatar !== 'string' || avatar.length > 512_000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar))) throw new Error('Choose a PNG, JPEG or WebP avatar.')
  return { name, command, args, avatar }
}

// Serialize read/modify/write operations so simultaneous settings windows cannot lose edits.
let registryWrite: Promise<unknown> = Promise.resolve()
function mutateRegistry(action: (definitions: CustomLocalAgentDefinition[]) => void): Promise<void> {
  const work = registryWrite.catch(() => {}).then(async () => {
    const definitions = await customDefinitions()
    action(definitions)
    await writeCustomDefinitions(definitions)
  })
  registryWrite = work
  return work
}
async function validatedInput(input: CustomLocalAgentInput): Promise<CustomLocalAgentInput> {
  const value = validateLocalAgentInput(input)
  if (value.remote) {
    // Resolve the identity file in main; renderer checks are only hints. Probe
    // results are never accepted from the renderer: they are re-discovered.
    const { remotePath: _path, remoteHome: _home, ...remote } = await validateRemoteSpec(value.remote)
    value.remote = remote
  }
  return value
}
export async function addCustomLocalAgent(input: CustomLocalAgentInput): Promise<void> {
  const value = await validatedInput(input)
  await mutateRegistry(definitions => {
    if (definitions.filter(item => CUSTOM_ID.test(item.id)).length >= 64) throw new Error('Up to 64 custom local agents can be registered.')
    definitions.push({ id: `custom:${randomUUID()}`, ...value })
  })
}
export async function updateLocalAgent(id: string, input: CustomLocalAgentInput): Promise<void> {
  const value = await validatedInput(input)
  await mutateRegistry(definitions => {
    const index = definitions.findIndex(item => item.id === id)
    if (index < 0 && !localAgentCatalog.some(item => item[0] === id)) throw new Error('Unknown local agent')
    // Built-in entries describe CLIs on this computer; a remote agent is always a custom entry.
    if (value.remote && !CUSTOM_ID.test(id)) throw new Error('Add a remote agent as a new custom agent.')
    if (index >= 0 && Boolean(definitions[index].remote) !== Boolean(value.remote)) throw new Error('The run location of an existing agent cannot be changed. Add a new agent instead.')
    if (index < 0) definitions.push({ id, ...value })
    else {
      // Editing the server makes every folder chosen on the old one stale, even
      // if the old values come back later.
      const previous = definitions[index]
      const revision = (previous.remoteTargetRevision ?? 0) + (previous.remote && value.remote && remoteTargetId(previous.remote) !== remoteTargetId(value.remote) ? 1 : 0)
      definitions[index] = { id, ...value, ...(revision ? { remoteTargetRevision: revision } : {}) }
    }
  })
  forgetRemoteProbes()
  changedLocalAgentSettings(id)
}
export async function removeCustomLocalAgent(id: string): Promise<void> {
  if (!CUSTOM_ID.test(id)) throw new Error('Invalid custom local agent')
  await mutateRegistry(definitions => {
    const index = definitions.findIndex(item => item.id === id)
    if (index < 0) throw new Error('Custom local agent not found')
    definitions.splice(index, 1)
  })
}

/** Resolve a draft without changing the registry or any existing conversation. */
export async function resolveLocalAgentDraft(id: string | undefined, input: CustomLocalAgentInput, signal?: AbortSignal): Promise<LocalAgent> {
  const value = await validatedInput(input)
  const existing = id ? (await detectLocalAgents({ version: async () => undefined }, id))[0] : undefined
  if (id && !existing) throw new Error('Unknown local agent')
  if (value.remote) {
    if (id && !existing?.remote) throw new Error('The run location of an existing agent cannot be changed. Add a new agent instead.')
    const remote = await probeRemoteAgent(value.remote, signal, true)
    return remoteLocalAgent(id ?? `custom:${randomUUID()}`, value.name, value.avatar, remote)
  }
  const path = await resolveExecutable(value.command)
  if (!path) throw new Error('Executable not found. Check the path and executable permissions.')
  return { id: id ?? `custom:${randomUUID()}`, ...value, path, installed: true, discovered: true,
    chatSupported: true, status: 'ready', authentication: 'unchecked', custom: existing?.custom ?? !id }
}

// Keep the local CLI catalog aligned with Termany. Every catalog entry has a
// one-shot chat adapter in localAgentRuntime, so any detected executable can
// be selected when creating an agent.
export const localAgentCatalog = [
  ['claude', 'Claude Code', 'claude', ['Claude.app']],
  ['codex', 'Codex', 'codex', []],
  ['gemini', 'Gemini', 'gemini', []],
  ['grok', 'Grok Build', 'grok', ['Grok Bot.app']],
  ['openclaw', 'OpenClaw', 'openclaw', ['OpenClaw.app']],
  ['hermes', 'Hermes', 'hermes', ['Hermes.app']],
  ['opencode', 'OpenCode', 'opencode', ['OpenCode.app']],
  ['cursor', 'Cursor', 'cursor-agent', ['Cursor.app']],
  ['kimi', 'Kimi', 'kimi', ['Kimi.app']],
  ['omp', 'OMP', 'omp', []],
  ['fastclaw', 'FastClaw', 'fastclaw', []]
] as const

export async function findDesktopApp(names: readonly string[], roots = [
  '/Applications',
  '/System/Applications',
  join(homedir(), 'Applications')
]): Promise<string | undefined> {
  if (process.platform !== 'darwin' || !names.length) return undefined
  for (const root of roots) {
    for (const name of names) {
      const candidate = join(root, name)
      try {
        await access(candidate, constants.F_OK)
        return candidate
      } catch { /* Try the next conventional application location. */ }
    }
  }
  return undefined
}

export async function executableVersion(path: string): Promise<string | undefined> {
  try {
    const command = await executableCommand(path)
    const { stdout, stderr } = await execFileAsync(command.file, [...command.prefix, '--version'], {
      env: await executableEnvironment(),
      // Node-based CLIs can take several seconds to load even for --version.
      timeout: 6_000,
      killSignal: 'SIGKILL',
      maxBuffer: 256 * 1024,
      windowsHide: true
    })
    const line = `${stdout}\n${stderr}`.split(/\r?\n/).map((item) => item.trim()).find(Boolean)
    return line?.slice(0, 160)
  } catch {
    // A runnable CLI may not implement --version. Launch compatibility is
    // still established by its known adapter and executable bit.
    return undefined
  }
}

interface DetectionDependencies {
  executable?: (command: string) => Promise<string | undefined>
  desktopApp?: (names: readonly string[]) => Promise<string | undefined>
  version?: (path: string) => Promise<string | undefined>
}

async function detectionDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Local agent detection timed out. Check your shell startup configuration and try again.')), ms)
    })])
  } finally { clearTimeout(timer) }
}

export function detectLocalAgents(dependencies: DetectionDependencies = {}, onlyId?: string): Promise<LocalAgent[]> {
  return detectionDeadline(detectLocalAgentsInternal(dependencies, onlyId), 15000)
}

async function detectLocalAgentsInternal(dependencies: DetectionDependencies = {}, onlyId?: string): Promise<LocalAgent[]> {
  const resolveCommand = dependencies.executable ?? resolveExecutable
  const resolveApp = dependencies.desktopApp ?? findDesktopApp
  const readVersion = dependencies.version ?? executableVersion
  const custom = await customDefinitions()
  const definitions: ReadonlyArray<readonly [string, string, string, readonly string[], boolean]> = [
    ...localAgentCatalog.map(([id, name, command, appNames]) => [id, name, command, appNames, false] as const),
    ...custom.filter(item => CUSTOM_ID.test(item.id)).map(({ id, name, command }) => [id, name, command, [], true] as const)
  ]
  return Promise.all(definitions.filter(([id]) => !onlyId || id === onlyId).map(async ([id, name, command, appNames, isCustom]) => {
    const override = custom.find(item => item.id === id)
    // Remote agents are not resolved through this computer's PATH; the server is probed at launch.
    if (override?.remote && isCustom) return remoteLocalAgent(id, override.name, override.avatar, override.remote, remoteTarget(override))
    name = override?.name ?? name
    command = override?.command ?? command
    const [path, desktopPath] = await Promise.all([resolveCommand(command), resolveApp(appNames)])
    const version = path ? await detectionDeadline(readVersion(path), 8000).catch(() => undefined) : undefined
    const status = path ? 'ready' : desktopPath ? 'desktop-only' : 'not-found'
    return {
      id,
      name,
      command,
      args: override?.args,
      avatar: override?.avatar,
      installed: Boolean(path),
      discovered: Boolean(path || desktopPath),
      path,
      desktopPath,
      version,
      chatSupported: true,
      status,
      authentication: 'unchecked',
      custom: isCustom || undefined
    }
  }))
}

function remoteLocalAgent(id: string, name: string, avatar: string | undefined, remote: RemoteAgentSpec, target?: ExecutionTarget): LocalAgent {
  return {
    id, name, command: remote.executable, args: remote.args, avatar, installed: true, discovered: true,
    version: remoteHostLabel(remote), chatSupported: true, status: 'ready', authentication: 'unchecked', custom: true, remote,
    ...(target ? { remoteTarget: target } : {})
  }
}

export async function validateLocalAgent(id: string): Promise<LocalAgent> {
  const agent = (await detectLocalAgents({ version: async () => undefined }, id)).find((item) => item.id === id)
  if (!agent) throw new Error('Unknown local agent')
  if (!agent.installed) throw new Error(`${agent.name} is not installed. Refresh Agents in Settings after installing it.`)
  return agent
}
