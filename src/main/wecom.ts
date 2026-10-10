import { createHash, randomBytes } from 'node:crypto'

/**
 * WeCom (企业微信) smart bot over its WebSocket long connection, ported from fastclaw.
 * Every frame is JSON {cmd, headers:{req_id}, body}; acks echo req_id with errcode/errmsg and no cmd.
 * - auth: aibot_subscribe {bot_id, secret}; heartbeat: ping every 30s, two missed acks = dead connection
 * - inbound: aibot_msg_callback; aibot_event_callback carries disconnected_event when another client takes over
 * - reply: aibot_respond_msg on the inbound req_id (stream body); push: aibot_send_msg {chatid, msgtype, ...}
 */
export const WECOM_WS = 'wss://openws.work.weixin.qq.com'
const WECOM_QR = 'https://work.weixin.qq.com/ai/qc'
const HEARTBEAT = 30_000
const REQUEST_TIMEOUT = 10_000
const UPLOAD_CHUNK = 512 * 1024

export interface WecomFrame { cmd?: string; headers?: { req_id?: string }; body?: any; errcode?: number; errmsg?: string }
export type WecomSocket = Pick<WebSocket, 'send' | 'close' | 'addEventListener'>
export type WecomSocketFactory = (url: string) => WecomSocket

export class WecomAuthError extends Error {}
export class WecomSupersededError extends Error {}

export function wecomReqId(prefix: string): string { return `${prefix}_${Date.now()}_${randomBytes(6).toString('hex')}` }

/** One authenticated connection; resolves once subscribed and rejects if the handshake fails. */
export function openWecom(socketFactory: WecomSocketFactory, botId: string, secret: string,
  onFrame: (frame: WecomFrame) => void, onClose: (error: Error) => void, signal?: AbortSignal): Promise<WecomConnection> {
  return new Promise((resolve, reject) => {
    const socket = socketFactory(WECOM_WS)
    const connection = new WecomConnection(socket, onFrame)
    const subscribe = wecomReqId('aibot_subscribe')
    let ready = false, closed = false
    const fail = (error: Error) => {
      if (closed) return
      closed = true
      clearTimeout(timer); signal?.removeEventListener('abort', abort)
      try { socket.close() } catch {}
      connection.dispose(error)
      if (!ready) reject(error)
      else onClose(error)
    }
    const abort = () => fail(new Error('Channel disconnected'))
    const timer = setTimeout(() => fail(new Error('企业微信连接超时')), REQUEST_TIMEOUT)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) return abort()
    socket.addEventListener('open', () => socket.send(JSON.stringify({ cmd: 'aibot_subscribe', headers: { req_id: subscribe }, body: { bot_id: botId, secret } })))
    socket.addEventListener('error', () => fail(new Error('企业微信连接失败')))
    socket.addEventListener('close', () => fail(connection.closeReason ?? new Error('企业微信连接已断开')))
    socket.addEventListener('message', event => {
      let frame: WecomFrame
      try { frame = JSON.parse(String(event.data)) } catch { return }
      if (!ready) {
        if (frame.headers?.req_id !== subscribe) return
        if (frame.errcode) return fail(new WecomAuthError('企业微信 Bot ID 或 Secret 无效'))
        ready = true; clearTimeout(timer)
        connection.startHeartbeat()
        return resolve(connection)
      }
      connection.receive(frame)
    })
  })
}

export class WecomConnection {
  closeReason?: Error
  private acks = new Map<string, { resolve: (frame: WecomFrame) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private heartbeat?: ReturnType<typeof setInterval>
  private missed = 0
  constructor(private socket: WecomSocket, private onFrame: (frame: WecomFrame) => void) {}
  startHeartbeat(): void {
    this.heartbeat = setInterval(() => {
      if (this.missed >= 2) return this.close(new Error('企业微信心跳超时，正在重连'))
      this.missed++
      try { this.socket.send(JSON.stringify({ cmd: 'ping', headers: { req_id: wecomReqId('ping') } })) } catch { this.close(new Error('企业微信连接已断开')) }
    }, HEARTBEAT)
  }
  receive(frame: WecomFrame): void {
    const id = frame.headers?.req_id ?? ''
    if (frame.cmd === 'aibot_event_callback' && frame.body?.event?.eventtype === 'disconnected_event')
      return this.close(new WecomSupersededError('其他客户端已接管这个企业微信机器人，请断开后重新连接'))
    if (frame.cmd) return this.onFrame(frame)
    if (id.startsWith('ping')) { this.missed = 0; return }
    const ack = this.acks.get(id)
    if (!ack) return
    this.acks.delete(id); clearTimeout(ack.timer)
    if (frame.errcode) ack.reject(new Error(`企业微信请求失败：${frame.errmsg || frame.errcode}`))
    else ack.resolve(frame)
  }
  /** Sends one frame and waits for its ack. */
  request(cmd: string, body: unknown, reqId = wecomReqId(cmd)): Promise<WecomFrame> {
    if (this.closeReason) return Promise.reject(this.closeReason)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.acks.delete(reqId); reject(new Error(`企业微信 ${cmd} 超时`)) }, REQUEST_TIMEOUT)
      this.acks.set(reqId, { resolve, reject, timer })
      try { this.socket.send(JSON.stringify({ cmd, headers: { req_id: reqId }, body })) }
      catch (error) { clearTimeout(timer); this.acks.delete(reqId); reject(error as Error) }
    })
  }
  respondStream(reqId: string, streamId: string, content: string, finish: boolean): Promise<WecomFrame> {
    return this.request('aibot_respond_msg', { msgtype: 'stream', stream: { id: streamId, finish, content } }, reqId)
  }
  sendMarkdown(chatId: string, content: string): Promise<WecomFrame> {
    return this.request('aibot_send_msg', { chatid: chatId, msgtype: 'markdown', markdown: { content } })
  }
  /** Three-step temp-media upload (init → chunks → finish), then a push. */
  async sendMedia(chatId: string, kind: 'image' | 'file', name: string, data: Uint8Array): Promise<void> {
    const bytes = Buffer.from(data)
    const chunks = Math.ceil(bytes.length / UPLOAD_CHUNK)
    if (!chunks || chunks > 100) throw new Error('Invalid media size')
    const init = await this.request('aibot_upload_media_init', { type: kind, filename: name, total_size: bytes.length, total_chunks: chunks, md5: createHash('md5').update(bytes).digest('hex') })
    const uploadId = init.body?.upload_id
    if (!uploadId) throw new Error('Missing upload id')
    for (let i = 0; i < chunks; i++) await this.request('aibot_upload_media_chunk', { upload_id: uploadId, chunk_index: i, base64_data: bytes.subarray(i * UPLOAD_CHUNK, (i + 1) * UPLOAD_CHUNK).toString('base64') })
    const mediaId = (await this.request('aibot_upload_media_finish', { upload_id: uploadId })).body?.media_id
    if (!mediaId) throw new Error('Missing media id')
    await this.request('aibot_send_msg', { chatid: chatId, msgtype: kind, [kind]: { media_id: mediaId } })
  }
  close(reason = new Error('Channel disconnected')): void {
    if (this.closeReason) return
    this.dispose(reason)
    // The socket's close event reports closeReason to the owner, which decides whether to reconnect.
    try { this.socket.close() } catch {}
  }
  dispose(reason: Error): void {
    this.closeReason ??= reason
    clearInterval(this.heartbeat)
    for (const ack of this.acks.values()) { clearTimeout(ack.timer); ack.reject(this.closeReason) }
    this.acks.clear()
  }
}

/** Checks credentials with one subscribe. A successful subscribe kicks any live connection for the bot. */
export async function validateWecom(socketFactory: WecomSocketFactory, botId: string, secret: string): Promise<void> {
  const connection = await openWecom(socketFactory, botId, secret, () => {}, () => {})
  connection.close()
}

/**
 * QR flow that creates a smart bot (API mode, long connection) for the scanner — the flow the official
 * @wecom/wecom-openclaw-cli installer uses. It is undocumented, so manual Bot ID/Secret stays available.
 */
export async function wecomQR(request: typeof fetch, path: string): Promise<any> {
  const response = await request(WECOM_QR + path, { redirect: 'error', signal: AbortSignal.timeout(10000) })
  const data = response.ok ? (await response.json() as any)?.data : undefined
  if (!data) throw new Error(`获取企业微信二维码失败（HTTP ${response.status}）`)
  return data
}
export function wecomPlatform(): string {
  return process.platform === 'darwin' ? '1' : process.platform === 'win32' ? '2' : process.platform === 'linux' ? '3' : '0'
}
