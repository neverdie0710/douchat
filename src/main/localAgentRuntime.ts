import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { AgentConfig, MessageAttachment } from '../shared/types'
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

/** Only for the fresh, application-owned temporary workspace created below. */
export function localAgentEnvironment(id: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return id === 'gemini' ? { ...env, GEMINI_CLI_TRUST_WORKSPACE: 'true' } : env
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

async function generatedImages(threadId: string | undefined, env: NodeJS.ProcessEnv): Promise<LocalAgentImage[]> {
  if (!threadId) return []
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
  inputImages: LocalAgentImage[] = []
): Promise<LocalAgentReply> {
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
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(agent.path!, localAgentArgs(agent.id, effectivePrompt, output), {
        cwd: directory, env: localAgentEnvironment(agent.id, env), windowsHide: true, detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe']
      })
      let stdout = ''
      let stderr = ''
      let bytes = 0
      let failure: Error | undefined
      const kill = (): void => {
        if (!child.pid) return
        try {
          if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL')
          else child.kill('SIGKILL')
        } catch { /* Already exited. */ }
      }
      const abort = (): void => { failure = new Error('Stopped'); kill() }
      const timer = setTimeout(() => { failure = new Error(`${agent.name} timed out after three minutes`); kill() }, 180_000)
      const cleanup = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      const collect = (text: string, stream: 'stdout' | 'stderr'): void => {
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
        else if (code !== 0) reject(new Error(`${agent.name}: ${stderr.trim().slice(-1200) || `Exited with status ${code}`}`))
        else resolve(stdout)
      })
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
      child.stdin.on('error', () => { /* Process exit is reported by close. */ })
      child.stdin.end(['codex', 'openclaw'].includes(agent.id) ? effectivePrompt : undefined)
    })
    const text = agent.id === 'codex' ? (await readFile(output, 'utf8')).trim() : localAgentText(agent.id, stdout)
    if (!text) throw new Error(`${agent.name} finished without a text response. Check its local login and configuration.`)
    const images = agent.id === 'codex' ? await generatedImages(codexThreadId(stdout), env) : []
    return { text, images }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
