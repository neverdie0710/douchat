import { randomUUID } from 'node:crypto'
import type { LocalAgentImage } from '../shared/agentExecutor'
import type { MessageAttachment, RemoteAgentSpec } from '../shared/types'
import {
  cleanupScript, clearOutboxScript, framesScript, killScript, markerScript, prepareScript, remoteImageDirectories, runDirectory, runFileScript, uploadScript, SAFE_NAME,
  assertWorkspaceKey, workspacePath
} from './remoteScript'
import { remoteCheck, remoteExec } from './remoteTransport'
import { assertUuid } from './remoteValidate'

export interface Frame { name: string; data: Buffer }
export interface FrameLimits { maxFiles: number; maxFileBytes: number; maxTotalBytes: number }
export const IMAGE_LIMITS: FrameLimits = { maxFiles: 4, maxFileBytes: 8 * 1024 * 1024, maxTotalBytes: 20 * 1024 * 1024 }
export const OUTBOX_LIMITS: FrameLimits = { maxFiles: 10, maxFileBytes: 20 * 1024 * 1024, maxTotalBytes: 50 * 1024 * 1024 }
export const REPLY_LIMITS: FrameLimits = { maxFiles: 1, maxFileBytes: 8 * 1024 * 1024, maxTotalBytes: 8 * 1024 * 1024 }

const HEADER = /^(\d{1,9}) ([A-Za-z0-9._-]{1,128})\n$/

/** In-memory parser for the `<size> <name>\n<bytes>` stream. Any inconsistency
 * rejects the whole batch; nothing is written to disk here. */
export function parseFrames(input: Buffer, limits: FrameLimits): Frame[] {
  const frames: Frame[] = []
  let offset = 0
  let total = 0
  while (offset < input.length) {
    const newline = input.indexOf(0x0a, offset)
    if (newline < 0 || newline - offset + 1 > 256) throw new Error('Invalid remote file frame header')
    const header = HEADER.exec(input.subarray(offset, newline + 1).toString('latin1'))
    if (!header) throw new Error('Invalid remote file frame header')
    const size = Number(header[1])
    const name = header[2]
    if (name.startsWith('.') || name.includes('/')) throw new Error('Invalid remote file name')
    if (size < 1 || size > limits.maxFileBytes) throw new Error('Remote file exceeds the size limit')
    if (frames.length + 1 > limits.maxFiles) throw new Error('Remote returned too many files')
    total += size
    if (total > limits.maxTotalBytes) throw new Error('Remote files exceed the total size limit')
    const start = newline + 1
    if (start + size > input.length) throw new Error('Remote file frame is truncated')
    frames.push({ name, data: Buffer.from(input.subarray(start, start + size)) })
    offset = start + size
  }
  return frames
}

function frameStdoutLimit(limits: FrameLimits): number { return limits.maxTotalBytes + limits.maxFiles * 256 + 1 }

export function imageMime(data: Uint8Array): MessageAttachment['mimeType'] | undefined {
  if (data.length >= 8 && Buffer.from(data.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  const header = Buffer.from(data.subarray(0, 12)).toString('ascii')
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) return 'image/gif'
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

const EXTENSIONS: Record<MessageAttachment['mimeType'], string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

/** One private directory per remote run: $HOME/.douchat-remote/t-<uuid>. */
export class RemoteRun {
  readonly id = randomUUID()
  private prepared = false
  private closed = false
  constructor(readonly spec: RemoteAgentSpec & { remoteHome: string }, readonly workspaceKey?: string) {
    if (workspaceKey) assertWorkspaceKey(workspaceKey)
  }

  /** Absolute paths (for prompts only; never used as a shell operand). */
  get directory(): string { return `${this.spec.remoteHome}/.douchat-remote/t-${this.id}` }
  get outbox(): string { return `${this.directory}/out` }
  /** Working directory of the agent on the server, assigned by Douchat. */
  get workspace(): string { return workspacePath(this.spec.remoteHome, this.id, this.workspaceKey) }
  /** Shell fragment for templates. */
  get shellDirectory(): string { return runDirectory(this.id) }

  async prepare(signal?: AbortSignal): Promise<void> {
    await remoteCheck(this.spec, prepareScript(this.id, this.workspaceKey), { signal, timeoutMs: 30_000 })
    this.prepared = true
  }

  /** Upload bytes into a Douchat-named file and return its remote path. */
  async upload(name: string, data: Uint8Array, signal?: AbortSignal): Promise<string> {
    if (!SAFE_NAME.test(name) || name.startsWith('.')) throw new Error('Invalid remote file name')
    const output = await remoteCheck(this.spec, uploadScript(this.id, name, data.byteLength), { input: data, signal, timeoutMs: 120_000, maxStdout: 64 })
    if (output.toString('utf8').trim() !== String(data.byteLength)) throw new Error('Remote upload was incomplete')
    return `${this.directory}/${name}`
  }

  async uploadImages(images: LocalAgentImage[], signal?: AbortSignal): Promise<string[]> {
    const paths: string[] = []
    for (const image of images.slice(0, 4)) {
      const mimeType = imageMime(image.data)
      if (!mimeType || mimeType !== image.mimeType || image.data.byteLength > IMAGE_LIMITS.maxFileBytes) throw new Error('Unsupported image attachment')
      paths.push(await this.upload(`img-${randomUUID()}.${EXTENSIONS[mimeType]}`, image.data, signal))
    }
    return paths
  }

  /** Start of a turn on a long-lived connection: new marker, empty outbox. */
  async beginTurn(signal?: AbortSignal): Promise<void> {
    await remoteCheck(this.spec, markerScript(this.id), { signal, timeoutMs: 15_000 })
    await remoteCheck(this.spec, clearOutboxScript(this.id), { signal, timeoutMs: 15_000 })
  }

  private async frames(directory: { directory: string; parentChecks: number }, limits: FrameLimits, extra: { exclude?: string[]; only?: string[]; newerThanRun?: string } = {}, signal?: AbortSignal): Promise<Frame[]> {
    const result = await remoteExec(this.spec, framesScript({ ...directory, ...extra, ...limits }), { signal, timeoutMs: 120_000, maxStdout: frameStdoutLimit(limits) })
    if (result.code !== 0) throw new Error('Could not fetch files from the server')
    return parseFrames(result.stdout, limits)
  }

  async names(directory: { directory: string; parentChecks: number }, signal?: AbortSignal): Promise<Set<string>> {
    const result = await remoteExec(this.spec, framesScript({ ...directory, listOnly: true, ...IMAGE_LIMITS }), { signal, timeoutMs: 30_000, maxStdout: 1024 * 1024 })
    if (result.code !== 0) throw new Error('Could not list files on the server')
    return new Set(result.stdout.toString('utf8').split('\n').filter(name => SAFE_NAME.test(name)))
  }

  async images(directory: { directory: string; parentChecks: number }, extra: { exclude?: string[]; only?: string[]; newerThanRun?: string } = {}, signal?: AbortSignal): Promise<LocalAgentImage[]> {
    const frames = await this.frames(directory, IMAGE_LIMITS, extra, signal)
    return frames.flatMap(frame => {
      const mimeType = imageMime(frame.data)
      return mimeType ? [{ name: frame.name, mimeType, data: frame.data }] : []
    })
  }

  codexImages(threadId: string | undefined, signal?: AbortSignal): Promise<LocalAgentImage[]> {
    if (!threadId) return Promise.resolve([])
    return this.images(remoteImageDirectories.codex(assertUuid(threadId, 'thread')), { newerThanRun: this.id }, signal)
  }

  geminiSnapshot(signal?: AbortSignal): Promise<Set<string>> { return this.names(remoteImageDirectories.gemini(this.id, this.workspaceKey), signal) }
  async geminiImages(before: Set<string>, signal?: AbortSignal): Promise<LocalAgentImage[]> {
    const images = await this.images(remoteImageDirectories.gemini(this.id, this.workspaceKey), { exclude: [...before] }, signal)
    if (!images.length) throw new Error('Gemini: Image generation failed. The tool did not produce a new image file.')
    return images
  }

  /** Only files named in Grok's typed tool results are accepted. */
  async grokImages(result: { paths: string[]; sessionId?: string }, signal?: AbortSignal): Promise<LocalAgentImage[]> {
    if (!result.paths.length) return []
    const sessionId = assertUuid(result.sessionId, 'Grok session')
    const names = result.paths.map(path => path.split('/').pop() ?? '').filter(name => SAFE_NAME.test(name))
    if (!names.length) return []
    const images = await this.images(remoteImageDirectories.grok(sessionId), { only: names }, signal)
    if (!images.length) throw new Error('Grok: Generated image could not be fetched from the server')
    return images
  }

  async outboxFiles(signal?: AbortSignal): Promise<Frame[]> {
    return this.frames(remoteImageDirectories.outbox(this.id), OUTBOX_LIMITS, {}, signal)
  }

  async replyText(signal?: AbortSignal): Promise<string> {
    const result = await remoteExec(this.spec, runFileScript(this.id, 'reply.txt', REPLY_LIMITS.maxFileBytes), { signal, timeoutMs: 60_000, maxStdout: frameStdoutLimit(REPLY_LIMITS) })
    if (result.code !== 0) throw new Error('Could not fetch the reply from the server')
    const frame = parseFrames(result.stdout, REPLY_LIMITS)[0]
    return frame ? new TextDecoder('utf-8').decode(frame.data) : ''
  }

  /** Signal the remote process group; the pid must be numeric on the server. */
  async kill(): Promise<void> {
    if (!this.prepared) return
    await remoteExec(this.spec, killScript(this.id), { timeoutMs: 10_000 }).catch(() => undefined)
  }

  async dispose(kill = true): Promise<void> {
    if (!this.prepared || this.closed) return
    this.closed = true
    await remoteExec(this.spec, cleanupScript(this.id, kill), { timeoutMs: 15_000 }).catch(() => undefined)
  }
}

/** Prompt text telling the agent where deliverables go. Paths only enter the prompt. */
export function outboxPrompt(run: RemoteRun): string {
  return `To deliver a non-image file to the human (for example a document, archive or data file), write it into this private outbox directory on the server: ${run.outbox}\nUse only ASCII letters, digits, ".", "_" and "-" in file names; do not create subdirectories or links. At most 10 files, 20 MB each. Douchat fetches them after your turn and attaches them to your reply. Do not paste file paths as links.`
}
