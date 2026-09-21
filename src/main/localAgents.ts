import { executableCommand } from './windowsCommand'
import type { LocalAgent } from '../shared/types'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { resolveExecutable } from './shellPath'

const execFileAsync = promisify(execFile)
let customRegistryPath: string | undefined

interface CustomLocalAgentDefinition {
  id: string
  name: string
  command: string
}

const CUSTOM_ID = /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function configureLocalAgentRegistry(userDataPath?: string): void {
  customRegistryPath = userDataPath ? join(userDataPath, 'local-agents.json') : undefined
}

function customDefinition(value: unknown): CustomLocalAgentDefinition | undefined {
  if (!value || typeof value !== 'object') return undefined
  const input = value as Record<string, unknown>
  const id = String(input.id ?? '').trim()
  const name = String(input.name ?? '').trim().slice(0, 80)
  const command = String(input.command ?? '').trim().slice(0, 2_048)
  if (!CUSTOM_ID.test(id) || !name || !command || command.includes('\0') || /[\r\n]/.test(command)) return undefined
  return { id, name, command }
}

async function customDefinitions(): Promise<CustomLocalAgentDefinition[]> {
  if (!customRegistryPath) return []
  try {
    const parsed = JSON.parse(await readFile(customRegistryPath, 'utf8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(customDefinition).filter((item): item is CustomLocalAgentDefinition => Boolean(item)).slice(0, 64)
  } catch {
    return []
  }
}

async function writeCustomDefinitions(definitions: CustomLocalAgentDefinition[]): Promise<void> {
  if (!customRegistryPath) throw new Error('Local agent registry is unavailable')
  await mkdir(dirname(customRegistryPath), { recursive: true })
  const temporary = `${customRegistryPath}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(definitions, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, customRegistryPath)
}

export async function addCustomLocalAgent(input: { name: string; command: string }): Promise<void> {
  const name = String(input?.name ?? '').trim()
  const command = String(input?.command ?? '').trim()
  if (!name || name.length > 80) throw new Error('Enter a local agent name of 80 characters or fewer.')
  if (!command || command.length > 2_048 || command.includes('\0') || /[\r\n]/.test(command)) throw new Error('Enter a valid executable command or absolute path.')
  if (!/[\\/]/.test(command) && /\s/.test(command)) throw new Error('A command name cannot contain spaces. Use an absolute path instead.')
  const definitions = await customDefinitions()
  if (definitions.length >= 64) throw new Error('Up to 64 custom local agents can be registered.')
  definitions.push({ id: `custom:${randomUUID()}`, name, command })
  await writeCustomDefinitions(definitions)
}

export async function removeCustomLocalAgent(id: string): Promise<void> {
  if (!CUSTOM_ID.test(id)) throw new Error('Invalid custom local agent')
  const definitions = await customDefinitions()
  const next = definitions.filter((item) => item.id !== id)
  if (next.length === definitions.length) throw new Error('Custom local agent not found')
  await writeCustomDefinitions(next)
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

async function executableVersion(path: string): Promise<string | undefined> {
  try {
    const command = await executableCommand(path)
    const { stdout, stderr } = await execFileAsync(command.file, [...command.prefix, '--version'], {
      timeout: 1_000,
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

export async function detectLocalAgents(dependencies: DetectionDependencies = {}): Promise<LocalAgent[]> {
  const resolveCommand = dependencies.executable ?? resolveExecutable
  const resolveApp = dependencies.desktopApp ?? findDesktopApp
  const readVersion = dependencies.version ?? executableVersion
  const custom = await customDefinitions()
  const definitions: ReadonlyArray<readonly [string, string, string, readonly string[], boolean]> = [
    ...localAgentCatalog.map(([id, name, command, appNames]) => [id, name, command, appNames, false] as const),
    ...custom.map(({ id, name, command }) => [id, name, command, [], true] as const)
  ]
  return Promise.all(definitions.map(async ([id, name, command, appNames, isCustom]) => {
    const [path, desktopPath] = await Promise.all([resolveCommand(command), resolveApp(appNames)])
    const version = path && !isCustom ? await readVersion(path) : undefined
    const status = path ? 'ready' : desktopPath ? 'desktop-only' : 'not-found'
    return {
      id,
      name,
      command,
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

export async function validateLocalAgent(id: string): Promise<LocalAgent> {
  const agent = (await detectLocalAgents()).find((item) => item.id === id)
  if (!agent) throw new Error('Unknown local agent')
  if (!agent.installed) throw new Error(`${agent.name} is not installed. Refresh Agents in Settings after installing it.`)
  return agent
}
