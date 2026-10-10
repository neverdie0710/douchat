import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, rmSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { ServiceError, UnauthorizedError, type HostClient } from './client'

/**
 * The host half of the byte-stream relay (douchat-tanstack relay.ts). It is
 * the SSH server's role and nothing more: run one signed remote script with
 * its stdio forwarded, or expose a UNIX socket whose connections are carried
 * back to the desktop's skill bridge. Prompts, memory, approvals and replies
 * stay on the desktop, exactly as with SSH.
 */

/** Same decoding step as REMOTE_BOOTSTRAP in src/main/remoteScript.ts; the script is the base64 `$1`. */
const BOOTSTRAP = 'eval "$(printf %s "$1" | base64 -d 2>/dev/null || printf %s "$1" | base64 -D)"'
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const STREAM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const BRIDGE_NAME = /^b-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.sock$/
/** Used for the one frame sent on a stream this process never ran (rejected or left over from a restart). */
const TERMINAL_SEQ = 999_999_999_999
const MAX_WATCH = 64
const MAX_BATCH_FRAMES = 64
const MAX_BATCH_BYTES = 6 * 1024 * 1024
const MAX_FRAME_BYTES = 1024 * 1024
const HIGH_WATER = 16 * 1024 * 1024
const LOW_WATER = 4 * 1024 * 1024
/** The desktop refreshes this on every receive (at most ~15s apart). */
const OWNER_LOST_MS = 120_000
const KILL_GRACE_MS = 5_000
const BACKOFF = [250, 1_000, 3_000, 10_000]
const IGNORE_TTL_MS = 60 * 60 * 1000

type Kind = 'exec' | 'listen' | 'conn'
type OutType = 'out' | 'err' | 'exit' | 'error' | 'accept'
interface OutFrame { type: OutType; data?: Buffer; extra?: unknown; seq?: number; sent?: () => void }
interface InFrame { streamId: string; seq: number; type: string; data?: string; extra?: unknown }
interface Opened { streamId: string; kind: Kind; signed?: unknown; parentId?: string }
interface PollResult { serverTime: number; ownerAliveAt: number; opened: Opened[]; frames: InFrame[]; streams: Record<string, string> }

export type OpenRequest = { kind: 'exec'; script: string } | { kind: 'listen'; socketPath: string }

export interface RelayOptions {
  client: HostClient
  /** Verifies the owner signature for a new stream; throws when it is not acceptable. */
  verifyOpen(signed: unknown, streamId: string): OpenRequest
  log(message: string): void
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>(resolve => {
  const timer = setTimeout(done, ms)
  function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
  signal?.addEventListener('abort', done, { once: true })
})
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500)

interface Pausable { pause(): unknown; resume(): unknown }

class Stream {
  /** Last frame applied from the desktop; sent back as the acknowledgement. */
  recvSeq = 0
  /** Watched (and acknowledged) only once the service knows the stream. */
  registered = true
  /** A terminal frame (exit/error) is queued. */
  finished = false
  /** Nothing more is sent: the terminal frame was delivered, or the stream is gone. */
  done = false
  receive: (frame: InFrame) => void = () => undefined
  teardown: () => void = () => undefined
  readonly children = new Set<Stream>()
  pausables: Pausable[] = []
  private sendSeq = 0
  private queue: OutFrame[] = []
  private queued = 0
  private paused = false
  private sending = false
  private batch?: { frames: (OutFrame & { seq: number })[]; bytes: number }
  private gate?: Promise<void>
  private release?: () => void

  constructor(private readonly relay: Relay, readonly id: string, readonly kind: Kind) {}

  /** Holds outgoing frames until the service created this stream (bridge connections). */
  holdUntilRegistered(): () => void {
    this.registered = false
    this.gate = new Promise(resolve => { this.release = resolve })
    return () => { this.registered = true; this.release?.(); this.gate = undefined }
  }

  push(frame: OutFrame): void {
    if (this.finished || this.done) return
    if (frame.type === 'exit' || frame.type === 'error') this.finished = true
    const last = this.queue[this.queue.length - 1]
    const size = frame.data?.length ?? 0
    if (frame.data && !frame.extra && !frame.sent && last?.data && last.type === frame.type && !last.extra && !last.sent && last.data.length + size <= MAX_FRAME_BYTES)
      last.data = Buffer.concat([last.data, frame.data])
    else this.queue.push(frame)
    this.queued += size
    if (!this.paused && this.queued > HIGH_WATER) {
      this.paused = true
      for (const source of this.pausables) source.pause()
    }
    void this.pump()
  }

  private takeBatch(): { frames: (OutFrame & { seq: number })[]; bytes: number } {
    const frames: (OutFrame & { seq: number })[] = []
    let bytes = 0
    while (this.queue.length && frames.length < MAX_BATCH_FRAMES) {
      const next = this.queue[0]
      let size = next.data?.length ?? 0
      if (frames.length && bytes + size > MAX_BATCH_BYTES) break
      if (next.data && size > MAX_FRAME_BYTES) {
        // Split oversized output so one frame stays well under the service limit.
        this.queue[0] = { ...next, data: next.data.subarray(MAX_FRAME_BYTES) }
        size = MAX_FRAME_BYTES
        frames.push({ type: next.type, data: next.data.subarray(0, MAX_FRAME_BYTES), seq: ++this.sendSeq })
      } else {
        this.queue.shift()
        const seq = next.seq ?? ++this.sendSeq
        this.sendSeq = Math.max(this.sendSeq, seq)
        frames.push({ ...next, seq })
      }
      bytes += size
    }
    return { frames, bytes }
  }

  /** One send in flight per stream, so the desktop always sees frames in order. */
  private async pump(): Promise<void> {
    if (this.sending) return
    this.sending = true
    try {
      if (this.gate) await this.gate
      let failures = 0
      while (!this.done && (this.batch || this.queue.length)) {
        this.batch ??= this.takeBatch()
        const batch = this.batch
        try {
          const result = await this.relay.client.call<{ closed?: boolean }>({
            action: 'relay-send',
            streamId: this.id,
            frames: batch.frames.map(frame => ({ seq: frame.seq, type: frame.type, ...(frame.data ? { data: frame.data.toString('base64') } : {}), ...(frame.extra !== undefined ? { extra: frame.extra } : {}) }))
          }, undefined, 60_000)
          this.batch = undefined
          failures = 0
          this.queued -= batch.bytes
          if (this.paused && this.queued < LOW_WATER) {
            this.paused = false
            for (const source of this.pausables) source.resume()
          }
          for (const frame of batch.frames) frame.sent?.()
          if (result?.closed) { this.relay.drop(this); return }
          if (batch.frames.some(frame => frame.type === 'exit' || frame.type === 'error')) { this.done = true; this.relay.forget(this); return }
        } catch (error) {
          if (error instanceof UnauthorizedError) { this.relay.fail(error); return }
          if (error instanceof ServiceError && /数据流不存在|无效/.test(error.message)) {
            this.relay.options.log(`stream ${this.id.slice(0, 8)}: ${error.message}`)
            this.relay.drop(this)
            return
          }
          await sleep(BACKOFF[Math.min(failures++, BACKOFF.length - 1)])
        }
      }
    } finally {
      this.sending = false
    }
  }

  /** Stops everything local without sending anything more. */
  close(): void {
    if (this.done) return
    this.done = true
    this.queue = []
    this.batch = undefined
    this.release?.()
    for (const child of this.children) this.relay.drop(child)
    try { this.teardown() } catch { /* already gone */ }
  }
}

export class Relay {
  private readonly streams = new Map<string, Stream>()
  /** Stream ids this process already handled, so a redelivered open runs once. */
  private readonly handled = new Map<string, number>()
  private poll?: AbortController
  private fatal?: Error
  private readonly stop = new AbortController()

  constructor(readonly options: RelayOptions) {}
  get client(): HostClient { return this.options.client }
  get active(): number { return this.streams.size }

  /** Long-polls until stopped; rejects when the host was revoked. */
  async run(signal: AbortSignal): Promise<void> {
    signal.addEventListener('abort', () => { this.stop.abort(); this.poll?.abort() }, { once: true })
    let failures = 0
    while (!this.stop.signal.aborted) {
      const watch: Record<string, number> = {}
      for (const stream of this.streams.values())
        if (stream.registered && Object.keys(watch).length < MAX_WATCH) watch[stream.id] = stream.recvSeq
      const poll = new AbortController()
      this.poll = poll
      let result: PollResult
      try {
        result = await this.client.call<PollResult>({ action: 'relay-poll', streams: watch, wait: true }, AbortSignal.any([poll.signal, this.stop.signal]), 30_000)
        failures = 0
      } catch (error) {
        if (this.fatal) break
        if (error instanceof UnauthorizedError) { this.fail(error); break }
        if (this.stop.signal.aborted) break
        if (poll.signal.aborted) continue
        this.options.log(`poll failed: ${errorText(error)}`)
        await sleep(BACKOFF[Math.min(failures++, BACKOFF.length - 1)], this.stop.signal)
        continue
      } finally {
        if (this.poll === poll) this.poll = undefined
      }
      this.handle(result)
    }
    for (const stream of [...this.streams.values()]) this.drop(stream)
    if (this.fatal) throw this.fatal
  }

  /** The watch list changed: restart the long poll so it includes new streams. */
  private kick(): void { this.poll?.abort() }

  fail(error: Error): void {
    this.fatal ??= error
    this.stop.abort()
    this.poll?.abort()
  }

  drop(stream: Stream): void {
    stream.close()
    if (this.streams.get(stream.id) === stream) this.streams.delete(stream.id)
  }

  forget(stream: Stream): void {
    if (this.streams.get(stream.id) === stream) this.streams.delete(stream.id)
  }

  private handle(result: PollResult): void {
    const now = Date.now()
    for (const [id, at] of this.handled) if (now - at > IGNORE_TTL_MS && !this.streams.has(id)) this.handled.delete(id)

    for (const opened of Array.isArray(result.opened) ? result.opened : []) {
      const id = opened?.streamId
      if (typeof id !== 'string' || !STREAM_ID.test(id) || this.streams.has(id) || this.handled.has(id)) continue
      this.handled.set(id, now)
      if (opened.kind === 'conn') { this.reject(id, { type: 'exit', extra: { code: 0 } }); continue }
      let request: OpenRequest
      try {
        request = this.options.verifyOpen(opened.signed, id)
        if (request.kind !== opened.kind) throw new Error('Stream kind does not match its signature.')
      } catch (error) {
        this.options.log(`rejected stream ${id.slice(0, 8)}: ${errorText(error)}`)
        this.reject(id, { type: 'error', extra: { message: errorText(error) } })
        continue
      }
      try {
        if (request.kind === 'exec') this.startExec(id, request.script)
        else this.startListen(id, request.socketPath)
      } catch (error) {
        const stream = this.streams.get(id)
        if (stream) this.drop(stream)
        this.reject(id, { type: 'error', extra: { message: errorText(error) } })
      }
    }

    for (const frame of Array.isArray(result.frames) ? result.frames : []) {
      const stream = this.streams.get(frame.streamId)
      if (!stream || stream.done || !Number.isSafeInteger(frame.seq) || frame.seq <= stream.recvSeq) continue
      stream.recvSeq = frame.seq
      try { stream.receive(frame) } catch (error) { this.options.log(`stream ${stream.id.slice(0, 8)}: ${errorText(error)}`) }
    }

    for (const [id, state] of Object.entries(result.streams ?? {})) {
      const stream = this.streams.get(id)
      if (stream && (state === 'closed' || state === 'gone')) this.drop(stream)
    }

    // The desktop is the orchestrator, as with SSH: once it is gone, its runs stop.
    const ownerAliveAt = Number(result.ownerAliveAt) || 0
    if (this.streams.size && ownerAliveAt && Number(result.serverTime) - ownerAliveAt > OWNER_LOST_MS) {
      this.options.log('desktop disconnected; stopping its streams')
      for (const stream of [...this.streams.values()]) stream.receive({ streamId: stream.id, seq: stream.recvSeq, type: 'kill' })
    }
  }

  /** Closes a stream this process does not run with one terminal frame. */
  private reject(id: string, frame: OutFrame): void {
    const stream = new Stream(this, id, 'exec')
    stream.registered = false
    this.streams.set(id, stream)
    stream.push({ ...frame, seq: TERMINAL_SEQ })
  }

  private startExec(id: string, script: string): void {
    if (typeof script !== 'string' || !BASE64.test(script)) throw new Error('Invalid remote script.')
    const stream = new Stream(this, id, 'exec')
    this.streams.set(id, stream)
    const child: ChildProcessWithoutNullStreams = spawn('/bin/sh', ['-c', BOOTSTRAP, 'sh', script], {
      cwd: homedir(), detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: process.env
    })
    let exited = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const kill = () => {
      if (exited || !child.pid || killTimer) return
      try { process.kill(-child.pid, 'SIGTERM') } catch { /* already gone */ }
      killTimer = setTimeout(() => { if (!exited && child.pid) try { process.kill(-child.pid, 'SIGKILL') } catch { /* gone */ } }, KILL_GRACE_MS)
      killTimer.unref()
    }
    stream.pausables = [child.stdout, child.stderr]
    child.stdout.on('data', (data: Buffer) => stream.push({ type: 'out', data }))
    child.stderr.on('data', (data: Buffer) => stream.push({ type: 'err', data }))
    child.stdin.on('error', () => undefined)
    child.on('error', error => { exited = true; stream.push({ type: 'error', extra: { message: errorText(error) } }) })
    child.on('exit', () => { exited = true; clearTimeout(killTimer) })
    child.on('close', (code, signal) => stream.push({ type: 'exit', extra: { code, signal } }))
    stream.receive = frame => {
      if (frame.type === 'in') { if (!child.stdin.destroyed) child.stdin.write(Buffer.from(frame.data ?? '', 'base64')) }
      else if (frame.type === 'eof') child.stdin.end()
      else if (frame.type === 'kill') kill()
    }
    stream.teardown = kill
  }

  private startListen(id: string, socketPath: string): void {
    const directory = join(homedir(), '.douchat-remote')
    if (typeof socketPath !== 'string' || dirname(socketPath) !== directory || !BRIDGE_NAME.test(basename(socketPath)))
      throw new Error('The bridge socket must be ~/.douchat-remote/b-<id>.sock.')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    chmodSync(directory, 0o700)
    try {
      if (!lstatSync(socketPath).isSocket()) throw new Error('The bridge socket path is taken.')
      rmSync(socketPath, { force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const stream = new Stream(this, id, 'listen')
    this.streams.set(id, stream)
    const sockets = new Set<Socket>()
    let closed = false
    const server = createServer(socket => {
      if (closed || stream.finished) { socket.destroy(); return }
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
      this.acceptConnection(stream, socket)
    })
    const close = (notify: boolean) => {
      if (closed) return
      closed = true
      server.close()
      for (const socket of sockets) socket.destroy()
      try { if (lstatSync(socketPath).isSocket()) rmSync(socketPath, { force: true }) } catch { /* gone */ }
      if (notify) stream.push({ type: 'exit', extra: { code: 0 } })
    }
    server.on('error', error => {
      stream.push({ type: 'error', extra: { message: errorText(error) } })
      close(false)
    })
    server.listen(socketPath, () => {
      try { chmodSync(socketPath, 0o600) } catch { /* reported on use */ }
      // Lets the desktop stop waiting, like SSH's forwarding check.
      stream.push({ type: 'out', extra: { listening: true } })
    })
    stream.receive = frame => { if (frame.type === 'eof' || frame.type === 'kill') close(true) }
    stream.teardown = () => close(false)
  }

  private acceptConnection(parent: Stream, socket: Socket): void {
    const childId = randomUUID()
    const stream = new Stream(this, childId, 'conn')
    const registered = stream.holdUntilRegistered()
    this.handled.set(childId, Date.now())
    this.streams.set(childId, stream)
    parent.children.add(stream)
    stream.pausables = [socket]
    socket.on('data', (data: Buffer) => stream.push({ type: 'out', data }))
    socket.on('error', () => undefined)
    socket.once('close', () => { parent.children.delete(stream); stream.push({ type: 'exit', extra: { code: 0 } }) })
    stream.receive = frame => {
      if (frame.type === 'in') socket.write(Buffer.from(frame.data ?? '', 'base64'))
      else if (frame.type === 'eof') socket.end()
      else if (frame.type === 'kill') socket.destroy()
    }
    stream.teardown = () => socket.destroy()
    parent.push({ type: 'accept', extra: { childId }, sent: () => { registered(); this.kick() } })
  }
}
