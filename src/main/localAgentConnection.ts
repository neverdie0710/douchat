import { localModelId, withLocalModel } from '../shared/localModels'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { executableCommand } from './windowsCommand'

export interface LocalProgress {
  phase: 'connecting' | 'ready' | 'working' | 'waiting'
  elapsedSeconds: number
  silentSeconds: number
  detail?: string
}
export type ProgressListener = (progress: LocalProgress) => void

/** Kill the owned process group, including CLI tools and MCP children. */
export function killLocalProcess(child: ChildProcessWithoutNullStreams): void {
  if (!child.pid) return
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL')
    else {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.once('error', () => { child.kill('SIGKILL') })
      killer.once('exit', (code) => { if (code) child.kill('SIGKILL') })
    }
  } catch { /* Already exited. */ }
}

type Packet = Record<string, any>
type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }

/** One private stdio connection per Douchat conversation/topic/agent. No TCP listener. */
export class LocalAgentConnection {
  private child!: ChildProcessWithoutNullStreams
  private pending = new Map<number, Pending>()
  private sequence = 0
  private buffer = ''
  private stderr = ''
  private threadId?: string
  private listener?: (packet: Packet) => void
  private failTurn?: (error: Error) => void
  private failure?: Error
  private turnCount = 0
  private lastEvent = Date.now()
  private readonly closedPromise: Promise<void>
  private resolveClosed!: () => void

  constructor(private readonly kind: 'codex' | 'claude') {
    this.closedPromise = new Promise((resolve) => { this.resolveClosed = resolve })
  }
  get alive(): boolean { return !this.failure }
  get hasHistory(): boolean { return this.turnCount > 0 }
  get thread(): string | undefined { return this.threadId }

  async connect(path: string, cwd: string, env: NodeJS.ProcessEnv, model?: string, discoveryOnly = false): Promise<void> {
    const command = await executableCommand(path)
    if (this.failure) throw this.failure
    const args = this.kind === 'codex'
      ? ['app-server']
      : ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--no-session-persistence', '--allowedTools', 'WebSearch,WebFetch', '--permission-mode', 'dontAsk']
    this.child = spawn(command.file, [...command.prefix, ...(this.kind === 'claude' ? withLocalModel('claude', args, model) : args)], {
      cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => this.read(chunk))
    this.child.stderr.on('data', (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-1600) })
    this.child.stdin.on('error', (error) => this.close(error))
    this.child.once('error', (error) => this.close(error))
    this.child.once('exit', (code) => this.close(new Error(`Local agent disconnected (${code ?? 'signal'}). ${this.stderr}`)))
    this.child.once('close', (code) => {
      this.close(new Error(`Local agent disconnected (${code ?? 'signal'}). ${this.stderr}`))
      this.resolveClosed()
    })
    if (this.kind === 'codex') {
      await this.request('initialize', { clientInfo: { name: 'douchat', version: '1.0.0' }, capabilities: { experimentalApi: true } })
      this.write({ method: 'initialized' })
      if (discoveryOnly) return
      const response = await this.request('thread/start', {
        ...(localModelId(model) ? { model: localModelId(model) } : {}),
        cwd, approvalPolicy: 'never', sandbox: 'workspace-write', ephemeral: true,
        config: { 'sandbox_workspace_write.network_access': true, web_search: 'live' }
      })
      if (typeof response.thread?.id !== 'string') throw new Error('Codex did not return a thread ID')
      this.threadId = response.thread.id
    }
  }

  async models(): Promise<Array<{ id: string; name: string }>> {
    if (this.kind === 'claude') {
      const result = await this.request('initialize', {}, true)
      return (result.models ?? []).filter((item: any) => typeof item.value === 'string' && item.value !== 'default').map((item: any) => ({ id: item.value, name: item.displayName || item.value }))
    }
    const models: Array<{ id: string; name: string }> = []
    let cursor: string | undefined
    for (let page = 0; page < 20; page++) {
      const result = await this.request('model/list', { limit: 100, ...(cursor ? { cursor } : {}) })
      for (const item of result.data ?? []) {
        const id = item.model ?? item.id
        if (typeof id === 'string') models.push({ id, name: item.displayName || id })
      }
      if (!result.nextCursor || result.nextCursor === cursor) break
      cursor = result.nextCursor
    }
    return models
  }

  private write(packet: Packet): void {
    if (this.failure) throw this.failure
    this.child.stdin.write(`${JSON.stringify(packet)}\n`)
  }
  private request(method: string, params: Packet, control = false): Promise<any> {
    if (this.failure) return Promise.reject(this.failure)
    return new Promise((resolve, reject) => {
      const id = ++this.sequence
      const timer = setTimeout(() => this.close(new Error(`Local agent did not acknowledge ${method} within 60 seconds`)), 60_000)
      this.pending.set(id, { resolve, reject, timer })
      try { this.write(control ? { type: 'control_request', request_id: String(id), request: { subtype: method, ...params } } : { id, method, params }) } catch (error) { this.close(error as Error) }
    })
  }
  private read(chunk: string): void {
    if (this.failure) return
    this.buffer += chunk
    // Limit individual frames, not total output over a multi-hour task.
    if (this.buffer.length > 8 * 1024 * 1024) { this.close(new Error('Local agent protocol frame is too large')); return }
    let newline: number
    while (!this.failure && (newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (!line) continue
      let packet: Packet
      try { packet = JSON.parse(line) } catch { this.close(new Error('Invalid local agent protocol response')); return }
      if (!packet || typeof packet !== 'object' || Array.isArray(packet)) { this.close(new Error('Invalid local agent protocol packet')); return }
      this.lastEvent = Date.now()
      if (packet.type === 'control_response') {
        const id = Number(packet.response?.request_id)
        const pending = this.pending.get(id)
        if (pending) {
          clearTimeout(pending.timer); this.pending.delete(id)
          if (packet.response.subtype === 'error') pending.reject(new Error(packet.response.error || 'Model discovery failed'))
          else pending.resolve(packet.response.response)
        }
      } else if (packet.id !== undefined && !packet.method) {
        const pending = this.pending.get(packet.id)
        if (pending) {
          clearTimeout(pending.timer)
          this.pending.delete(packet.id)
          if (packet.error) pending.reject(new Error(packet.error.message || 'Local agent request failed'))
          else pending.resolve(packet.result)
        }
      } else if (packet.id !== undefined && packet.method) {
        this.write({ id: packet.id, error: { code: -32601, message: 'Interactive requests are not supported in Douchat.' } })
      } else if (packet.type === 'control_request') {
        this.write({ type: 'control_response', response: { subtype: 'error', request_id: packet.request_id, error: 'Interactive requests are not supported in Douchat' } })
      } else this.listener?.(packet)
    }
  }

  async turn(prompt: string, signal: AbortSignal | undefined, progress?: ProgressListener): Promise<string> {
    signal?.throwIfAborted()
    if (this.failure) throw this.failure
    if (this.listener) throw new Error('This local agent session is already working')
    const started = Date.now()
    this.lastEvent = started
    let detail: string | undefined
    let lastReport = 0
    const report = (): void => {
      if (Date.now() - lastReport < 1_000) return
      lastReport = Date.now()
      progress?.({ phase: detail ? 'working' : 'waiting', elapsedSeconds: Math.floor((Date.now() - started) / 1000), silentSeconds: Math.floor((Date.now() - this.lastEvent) / 1000), detail })
    }
    const heartbeat = setInterval(report, 15_000)
    const abort = (): void => this.close(new Error('Stopped'))
    signal?.addEventListener('abort', abort, { once: true })
    try {
      return await new Promise<string>((resolve, reject) => {
        let finalText = ''
        let commentary = ''
        this.failTurn = reject
        this.listener = (packet) => {
          if (this.kind === 'claude') {
            if (packet.type === 'system' && packet.subtype === 'init') progress?.({ phase: 'ready', elapsedSeconds: 0, silentSeconds: 0 })
            if (packet.type === 'assistant') {
              for (const item of packet.message?.content ?? []) {
                if (item.type === 'text') detail = String(item.text).slice(-500)
                if (item.type === 'tool_use') detail = `Tool: ${item.name}`
              }
              report()
            }
            if (packet.type === 'result') {
              if (packet.is_error) reject(new Error(packet.result || packet.errors?.join('\n') || 'Claude failed'))
              else { this.turnCount++; resolve(String(packet.result ?? '')) }
            }
            return
          }
          const params = packet.params ?? {}
          if (params.threadId && params.threadId !== this.threadId) return
          if (packet.method === 'item/completed' || packet.method === 'item/started') {
            const item = params.item ?? {}
            if (item.type === 'agentMessage' && packet.method === 'item/completed') {
              if (item.phase === 'commentary') commentary = String(item.text ?? '')
              else finalText = String(item.text ?? '')
              detail = String(item.text ?? '').slice(-500)
            } else if (item.type !== 'reasoning' && item.type !== 'userMessage') {
              const labels: Record<string, string> = {
                commandExecution: 'Running a command', fileChange: 'Updating files',
                webSearch: 'Searching the web', mcpToolCall: 'Using a connected tool',
                imageGeneration: 'Generating an image', plan: 'Planning the next steps',
                contextCompaction: 'Compacting conversation context'
              }
              detail = labels[item.type] || 'Working on the task'
            }
            report()
          }
          if (packet.method === 'turn/completed') {
            if (params.turn?.status !== 'completed') reject(new Error(params.turn?.error?.message || `Local agent ${params.turn?.status || 'failed'}`))
            else { this.turnCount++; resolve(finalText || commentary) }
          }
        }
        if (signal?.aborted) { abort(); return }
        progress?.({ phase: 'ready', elapsedSeconds: 0, silentSeconds: 0 })
        if (this.kind === 'codex') {
          void this.request('turn/start', { threadId: this.threadId, input: [{ type: 'text', text: prompt, text_elements: [] }] }).catch(reject)
        } else {
          try { this.write({ type: 'user', message: { role: 'user', content: prompt } }) } catch (error) { reject(error) }
        }
      })
    } finally {
      clearInterval(heartbeat)
      signal?.removeEventListener('abort', abort)
      this.listener = undefined
      this.failTurn = undefined
    }
  }

  close(error = new Error('Local agent session closed')): void {
    if (this.failure) return
    this.failure = error
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
    this.pending.clear()
    this.failTurn?.(error)
    this.buffer = ''
    if (this.child) killLocalProcess(this.child)
    else this.resolveClosed()
  }
  async disposed(): Promise<void> { await this.closedPromise }
}
