import { LocalAgentConnection, killLocalProcess, type ProgressListener } from './localAgentConnection'
import { randomUUID } from 'node:crypto'
import { executableCommand } from './windowsCommand'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { AgentConfig, LocalAgent, MessageAttachment } from '../shared/types'
import { validateLocalAgent } from './localAgents'
import { spawnEnvironment } from './shellPath'

export function localAgentArgs(id: string, prompt: string, output: string): string[] {
  switch (id) {
    case 'codex': return ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true', '-c', 'web_search="live"', '--output-last-message', output, '-']
    case 'claude': return ['-p', '--output-format', 'json', '--allowedTools', 'WebSearch,WebFetch', '--', prompt]
    case 'gemini': return ['-p', prompt, '--output-format', 'json']
    case 'grok': return [
      '--no-auto-update', '-p', prompt, '--output-format', 'json',
      '--permission-mode', 'dontAsk',
      '--allow', 'Read', '--allow', 'Grep', '--allow', 'WebFetch', '--allow', 'WebSearch',
      '--sandbox', 'strict'
    ]
    case 'cursor': return ['--print', '--output-format', 'json', '--mode', 'ask', '--', prompt]
    case 'opencode': return ['run', '--format', 'json', '--', prompt]
    case 'kimi': return ['--prompt', prompt, '--output-format', 'text']
    case 'openclaw': return ['agent', 'exec', '--message-file', '-', '--json', '--code-mode', 'direct']
    case 'fastclaw': return ['chat', '--query', prompt]
    case 'hermes': return ['--oneshot', prompt]
    case 'omp': return ['--print', '--mode', 'text', '--no-session', '--no-tools', prompt]
    default: throw new Error('This local agent has no chat adapter yet')
  }
}

export function localAgentText(id: string, stdout: string): string {
  if (['kimi', 'fastclaw', 'hermes', 'omp'].includes(id)) return stdout.trim()
  if (id === 'opencode') {
    const events = stdout.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line))
    const error = events.find((event) => event.type === 'error')
    if (error) throw new Error(error.error?.data?.message || error.error?.message || 'OpenCode failed')
    return events.filter((event) => event.type === 'text').map((event) => event.part?.text || '').join('\n').trim()
  }
  const data = JSON.parse(stdout)
  if (data.ok === false || data.status === 'error' || data.status === 'timeout' || data.is_error || data.error) {
    const message = typeof data.error === 'string' ? data.error : data.error?.message
    throw new Error(message || data.result || data.text || 'Local agent failed')
  }
  return String(data.final ?? data.result ?? data.response ?? data.text ?? '').trim()
}

function cleanProcessOutput(text: string): string {
  return text
    // Terminal colour/control sequences are useful in a shell, but make the
    // in-app diagnostic unreadable and can interfere with error matching.
    .replace(/\x1B(?:[@-_][0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '')
    .trim()
}

export function localAgentExitError(
  agent: Pick<LocalAgent, 'id' | 'name'>,
  code: number | null,
  stdout: string,
  stderr: string
): Error {
  let diagnostic = cleanProcessOutput(stderr)
  if (!diagnostic && stdout.trim()) {
    try {
      // Structured CLIs often put their useful authentication/configuration
      // failure in JSON on stdout even though the process exits non-zero.
      diagnostic = localAgentText(agent.id, stdout)
    } catch (cause) {
      diagnostic = cause instanceof Error ? cause.message : cleanProcessOutput(stdout)
    }
  }
  diagnostic = cleanProcessOutput(diagnostic).slice(-1200)
  return new Error(`${agent.name}: ${diagnostic || `Exited with status ${code ?? 'unknown'}`}`)
}

const CLAUDE_ACCOUNT_AUTH_CONFLICTS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_BASE_URL'
] as const

/** Only for the fresh, application-owned temporary workspace created below.
 * Claude account-login fallback is intentionally opt-in: a working API-key
 * setup keeps its normal precedence, while the specific connector conflict
 * can retry against Claude Code's persisted claude.ai login. */
export function localAgentEnvironment(
  id: string,
  env: NodeJS.ProcessEnv,
  useClaudeAccountLogin = false
): NodeJS.ProcessEnv {
  if (id === 'gemini') return { ...env, GEMINI_CLI_TRUST_WORKSPACE: 'true' }
  if (id !== 'claude' || !useClaudeAccountLogin) return env
  const accountEnvironment = { ...env }
  for (const name of CLAUDE_ACCOUNT_AUTH_CONFLICTS) delete accountEnvironment[name]
  return accountEnvironment
}

export function shouldRetryClaudeWithAccountLogin(
  id: string,
  cause: unknown,
  env: NodeJS.ProcessEnv
): boolean {
  if (id !== 'claude' || !(cause instanceof Error)) return false
  if (!CLAUDE_ACCOUNT_AUTH_CONFLICTS.some((name) => Boolean(env[name]))) return false
  return /claude\.ai connectors are disabled because/i.test(cause.message) && /auth source/i.test(cause.message)
}

export interface LocalAgentImage {
  name: string
  mimeType: MessageAttachment['mimeType']
  data: Uint8Array
}

export interface LocalAgentReply {
  text: string
  images: LocalAgentImage[]
}

export function localAgentReply(agentName: string, text: string, images: LocalAgentImage[]): LocalAgentReply {
  if (!text && !images.length) {
    throw new Error(`${agentName} finished without a text or image response. Check its local login and configuration.`)
  }
  return { text, images }
}

/** Codex JSONL starts with the id whose imagegen output directory it owns. */
export function codexThreadId(stdout: string): string | undefined {
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line) as { type?: string; thread_id?: string }
      if (event.type === 'thread.started' && /^[0-9a-f-]{36}$/i.test(event.thread_id ?? '')) return event.thread_id
    } catch { /* A diagnostic line is not an event. */ }
  }
  return undefined
}

function imageMime(data: Uint8Array): MessageAttachment['mimeType'] | undefined {
  if (data.length >= 8 && Buffer.from(data.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  const header = Buffer.from(data.subarray(0, 12)).toString('ascii')
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) return 'image/gif'
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

async function generatedImages(threadId: string | undefined, env: NodeJS.ProcessEnv, since = 0): Promise<LocalAgentImage[]> {
  if (!threadId || !/^[0-9a-f-]{36}$/i.test(threadId)) return []
  const directory = join(env.CODEX_HOME || join(homedir(), '.codex'), 'generated_images', threadId)
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw cause
  }
  const candidates = await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => ({
    path: join(directory, entry.name),
    name: entry.name,
    info: await stat(join(directory, entry.name))
  })))
  candidates.sort((left, right) => left.info.mtimeMs - right.info.mtimeMs)
  const images: LocalAgentImage[] = []
  let total = 0
  for (const candidate of candidates) {
    if (candidate.info.mtimeMs < since) continue
    if (images.length >= 4 || candidate.info.size > 8 * 1024 * 1024 || total + candidate.info.size > 20 * 1024 * 1024) continue
    const data = await readFile(candidate.path)
    const mimeType = imageMime(data)
    if (!mimeType) continue
    images.push({ name: basename(candidate.name), mimeType, data })
    total += data.byteLength
  }
  return images
}

export async function runLocalAgent(
  config: AgentConfig,
  prompt: string,
  signal?: AbortSignal,
  inputImages: LocalAgentImage[] = [],
  options: LocalRunOptions = {}
): Promise<LocalAgentReply> {
  options.onProgress?.({ phase: 'connecting', elapsedSeconds: 0, silentSeconds: 0 })
  if (options.sessionKey && ['codex', 'claude'].includes(config.localAgentId!)) {
    return runConnectedAgent(config, prompt, signal, inputImages, options)
  }
  const agent = await validateLocalAgent(config.localAgentId!)
  const env = await spawnEnvironment()
  signal?.throwIfAborted()
  const directory = await mkdtemp(join(tmpdir(), 'douchat-agent-'))
  try {
    const extensions: Record<MessageAttachment['mimeType'], string> = {
      'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif'
    }
    const imagePaths = await Promise.all(inputImages.map(async (image, index) => {
      const path = join(directory, `input-image-${index + 1}.${extensions[image.mimeType]}`)
      await writeFile(path, image.data)
      return path
    }))
    const effectivePrompt = imagePaths.length
      ? `${prompt}\n\nThe human attached ${imagePaths.length === 1 ? 'this image' : 'these images'}. Inspect the image file${imagePaths.length === 1 ? '' : 's'} before answering:\n${imagePaths.join('\n')}`
      : prompt
    const output = join(directory, 'reply.txt')
    const command = await executableCommand(agent.path!)
    const run = (childEnvironment: NodeJS.ProcessEnv): Promise<string> => new Promise<string>((resolve, reject) => {
      const child = spawn(command.file, [...command.prefix, ...(agent.custom ? [effectivePrompt] : localAgentArgs(agent.id, effectivePrompt, output))], {
        cwd: directory, env: childEnvironment, windowsHide: true, detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe']
      })
      let stdout = ''
      let stderr = ''
      let bytes = 0
      let failure: Error | undefined
      const kill = (): void => killLocalProcess(child)
      const abort = (): void => { failure = new Error('Stopped'); kill() }
      const started = Date.now()
      let lastOutput = started
      options.onProgress?.({ phase: 'ready', elapsedSeconds: 0, silentSeconds: 0 })
      const timer = setInterval(() => options.onProgress?.({
        phase: 'waiting', elapsedSeconds: Math.floor((Date.now() - started) / 1000),
        silentSeconds: Math.floor((Date.now() - lastOutput) / 1000)
      }), 15_000)
      const cleanup = (): void => { clearInterval(timer); signal?.removeEventListener('abort', abort) }
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      const collect = (text: string, stream: 'stdout' | 'stderr'): void => {
        lastOutput = Date.now()
        bytes += Buffer.byteLength(text)
        if (bytes > 8 * 1024 * 1024) { failure = new Error(`${agent.name} produced too much output`); kill(); return }
        if (stream === 'stdout') stdout += text
        else stderr += text
      }
      child.stdout.on('data', (text: string) => collect(text, 'stdout'))
      child.stderr.on('data', (text: string) => collect(text, 'stderr'))
      child.once('error', (error) => { cleanup(); kill(); reject(error) })
      child.once('close', (code) => {
        cleanup()
        kill()
        if (failure) reject(failure)
        else if (code !== 0) reject(localAgentExitError(agent, code, stdout, stderr))
        else resolve(stdout)
      })
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
      child.stdin.on('error', () => { /* Process exit is reported by close. */ })
      child.stdin.end(['codex', 'openclaw'].includes(agent.id) ? effectivePrompt : undefined)
    })
    let stdout: string
    let usedClaudeAccountLogin = false
    try {
      stdout = await run(localAgentEnvironment(agent.id, env))
    } catch (cause) {
      if (!shouldRetryClaudeWithAccountLogin(agent.id, cause, env)) throw cause
      usedClaudeAccountLogin = true
      stdout = await run(localAgentEnvironment(agent.id, env, true))
    }
    const images = agent.id === 'codex' ? await generatedImages(codexThreadId(stdout), env) : []
    const replyText = async (): Promise<string> => agent.custom
      ? stdout.trim()
      : agent.id === 'codex' ? (await readFile(output, 'utf8')).trim() : localAgentText(agent.id, stdout)
    let text: string
    try {
      text = await replyText()
    } catch (cause) {
      if (usedClaudeAccountLogin || !shouldRetryClaudeWithAccountLogin(agent.id, cause, env)) throw cause
      usedClaudeAccountLogin = true
      stdout = await run(localAgentEnvironment(agent.id, env, true))
      text = await replyText()
    }
    return localAgentReply(agent.name, text, images)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}


export interface LocalRunOptions {
  sessionKey?: string
  /** Full transcript is needed only when a connection is cold. */
  continuationPrompt?: string
  onProgress?: ProgressListener
  /** Internal retry for the specific Claude account-login configuration conflict. */
  claudeAccountLogin?: boolean
}
interface ConnectedSession {
  config: AgentConfig
  sessionKey: string
  connection: LocalAgentConnection
  directory: Promise<string>
  ready: Promise<{ agent: LocalAgent; env: NodeJS.ProcessEnv; directory: string }>
  busy: boolean
  idle?: NodeJS.Timeout
}
const connections = new Map<string, ConnectedSession>()
const MAX_CONNECTIONS = 8
const IDLE_CONNECTION_MS = 5 * 60_000

function evictConnection(key: string, entry: ConnectedSession): void {
  if (connections.get(key) === entry) connections.delete(key)
  clearTimeout(entry.idle)
  entry.connection.close()
  void entry.directory.then(async (directory) => {
    await entry.connection.disposed()
    await rm(directory, { recursive: true, force: true })
  }).catch(() => { /* Startup already reports its error. */ })
}

export function disposeLocalAgentSessions(agentId: string): void {
  for (const [key, entry] of connections) if (entry.config.id === agentId) evictConnection(key, entry)
}
export function resetLocalAgentConversation(conversationId: string, topicId?: string): void {
  const prefixes = [`direct:${conversationId}:`, `group:${encodeURIComponent(conversationId)}:`, `handoff:${conversationId}:`]
  for (const [key, entry] of connections) {
    if (prefixes.some((prefix) => entry.sessionKey.startsWith(prefix))
      && (!topicId || entry.sessionKey.includes(encodeURIComponent(topicId)))) evictConnection(key, entry)
  }
}

async function runConnectedAgent(config: AgentConfig, prompt: string, signal: AbortSignal | undefined,
  images: LocalAgentImage[], options: LocalRunOptions): Promise<LocalAgentReply> {
  signal?.throwIfAborted()
  // Include account and complete configuration: edits cannot inherit old persona or login state.
  let key = JSON.stringify([config.ownerId, config.id, options.sessionKey, config.localAgentId, config.instructions, config.role, config.name, config.model, options.claudeAccountLogin])
  if (config.localAgentId === 'claude' && !connections.has(key) && !options.claudeAccountLogin) {
    const accountKey = JSON.stringify([config.ownerId, config.id, options.sessionKey, config.localAgentId, config.instructions, config.role, config.name, config.model, true])
    if (connections.has(accountKey)) key = accountKey
  }
  let entry = connections.get(key)
  if (entry && !entry.connection.alive) { evictConnection(key, entry); entry = undefined }
  if (entry?.busy) throw new Error('This local agent conversation is already working')
  if (!entry) {
    if (connections.size >= MAX_CONNECTIONS) {
      const idle = [...connections].find(([, candidate]) => !candidate.busy)
      if (idle) evictConnection(...idle)
      else throw new Error('All local agent connections are busy. Wait for a task to finish or stop one.')
    }
    const connection = new LocalAgentConnection(config.localAgentId as 'codex' | 'claude')
    const directory = mkdtemp(join(tmpdir(), 'douchat-session-'))
    const ready = Promise.all([validateLocalAgent(config.localAgentId!), spawnEnvironment(), directory])
      .then(async ([agent, env, cwd]) => {
        await connection.connect(agent.path!, cwd, localAgentEnvironment(agent.id, env, options.claudeAccountLogin))
        return { agent, env, directory: cwd }
      })
    entry = { config, sessionKey: options.sessionKey!, connection, directory, ready, busy: true }
    connections.set(key, entry)
  }
  entry.busy = true
  clearTimeout(entry.idle)
  const current = entry
  const abort = (): void => current.connection.close(new Error('Stopped'))
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const connectingAt = Date.now()
  const connectingTimer = setInterval(() => options.onProgress?.({ phase: 'connecting', elapsedSeconds: Math.floor((Date.now() - connectingAt) / 1000), silentSeconds: 0 }), 15_000)
  try {
    const { agent, env, directory } = await current.ready
    clearInterval(connectingTimer)
    signal?.throwIfAborted()
    const paths = await Promise.all(images.map(async (image) => {
      const path = join(directory, `input-${randomUUID()}.${image.mimeType.split('/')[1]}`)
      await writeFile(path, image.data)
      return path
    }))
    const text = current.connection.hasHistory ? options.continuationPrompt ?? prompt : prompt
    const effective = paths.length ? `${text}\n\nInspect these attached image files before answering:\n${paths.join('\n')}` : text
    const started = Date.now()
    const reply = await current.connection.turn(effective, signal, options.onProgress)
    const outputImages = agent.id === 'codex' ? await generatedImages(current.connection.thread, env, started) : []
    return localAgentReply(agent.name, reply, outputImages)
  } catch (error) {
    // Never replay a failed turn automatically: tools may already have caused side effects.
    evictConnection(key, current)
    if (config.localAgentId === 'claude' && !options.claudeAccountLogin && !current.connection.hasHistory
      && shouldRetryClaudeWithAccountLogin(config.localAgentId!, error, await spawnEnvironment())) {
      return runConnectedAgent(config, prompt, signal, images, { ...options, claudeAccountLogin: true })
    }
    throw error
  } finally {
    clearInterval(connectingTimer)
    signal?.removeEventListener('abort', abort)
    current.busy = false
    if (connections.get(key) === current) {
      current.idle = setTimeout(() => evictConnection(key, current), IDLE_CONNECTION_MS)
      current.idle.unref()
    }
  }
}
