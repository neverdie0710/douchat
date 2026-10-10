import { createCipheriv, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IMReplyPart } from './imMedia'
const sdk = vi.hoisted(() => ({ handler: undefined as any, send: vi.fn(async () => ({ code: 0 })), addReaction: vi.fn(async () => ({ code: 0 })) }))
vi.mock('@larksuiteoapi/node-sdk', () => ({
  Client: class { im = { message: { create: sdk.send }, messageReaction: { create: sdk.addReaction, delete: vi.fn() } } },
  WSClient: class { constructor(private options: any) {} start({ eventDispatcher }: any) { sdk.handler = eventDispatcher['im.message.receive_v1']; this.options.onReady?.(); return Promise.resolve() } close() {} },
  EventDispatcher: class { register(handlers: any) { return handlers } }
}))
import { IMChannelManager } from './imChannels'
import { decryptWecomMedia } from './imMedia'

/** Minimal WeCom long-connection server: acks every request and lets tests push frames. */
class FakeWecom {
  sockets: FakeSocket[] = []
  frames: any[] = []
  secret = 'bot-secret'
  factory = (url: string) => { const socket = new FakeSocket(this, url); this.sockets.push(socket); return socket as unknown as WebSocket }
  get live() { return this.sockets.filter(socket => !socket.closed) }
  push(body: any, reqId = 'req-' + randomBytes(4).toString('hex')) { this.live.at(-1)!.emit({ cmd: 'aibot_msg_callback', headers: { req_id: reqId }, body }); return reqId }
  sent(cmd: string) { return this.frames.filter(frame => frame.cmd === cmd) }
}
class FakeSocket {
  closed = false
  private listeners: Record<string, ((event: any) => void)[]> = {}
  constructor(private server: FakeWecom, readonly url: string) { queueMicrotask(() => this.fire('open', {})) }
  addEventListener(type: string, listener: (event: any) => void) { (this.listeners[type] ??= []).push(listener) }
  fire(type: string, event: any) { for (const listener of this.listeners[type] ?? []) listener(event) }
  emit(frame: any) { queueMicrotask(() => this.fire('message', { data: JSON.stringify(frame) })) }
  close() { if (this.closed) return; this.closed = true; queueMicrotask(() => this.fire('close', {})) }
  send(data: string) {
    const frame = JSON.parse(data)
    this.server.frames.push(frame)
    const ack = (extra: any = {}) => this.emit({ headers: frame.headers, errcode: 0, ...extra })
    if (frame.cmd === 'aibot_subscribe') return frame.body.secret === this.server.secret ? ack() : ack({ errcode: 40001, errmsg: 'invalid secret' })
    if (frame.cmd === 'aibot_upload_media_init') return ack({ body: { upload_id: 'upload-1' } })
    if (frame.cmd === 'aibot_upload_media_finish') return ack({ body: { media_id: 'media-1' } })
    ack()
  }
}

const cleanup: (() => void)[] = []
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.clearAllMocks() })
function setup(routes: (url: string, init?: RequestInit) => Response | undefined) {
  const directory = mkdtempSync(join(tmpdir(), 'douchat-im-qr-'))
  const wecom = new FakeWecom()
  const fetcher = vi.fn(async (url: any, init?: any) => {
    const response = routes(String(url), init)
    if (response) return response
    if (String(url).includes('tenant_access_token')) return Response.json({ code: 0, tenant_access_token: 'tenant' })
    throw new Error('Unexpected request ' + url)
  }) as unknown as typeof fetch
  const reply = vi.fn(async (_agent: string, _thread: string, text: string): Promise<IMReplyPart[]> => ['Reply: ' + text])
  const codec = { encrypt: (value: string) => value, decrypt: (value: string) => value }
  const manager = new IMChannelManager(directory, codec, () => 'alice', id => id === 'agent-a', reply, fetcher, undefined, undefined, wecom.factory)
  manager.activate()
  cleanup.push(() => { manager.stop(); rmSync(directory, { recursive: true, force: true }) })
  return { manager, wecom, reply, fetcher }
}
const text = (id: string, content: string, extra: any = {}) => ({ msgid: id, chattype: 'single', from: { userid: 'zhangsan' }, msgtype: 'text', text: { content }, ...extra })

describe('WeCom channel', () => {
  it('creates a bot by QR scan, pairs, shows thinking and answers on the inbound stream', async () => {
    let scanned = false
    const { manager, wecom, reply } = setup(url => {
      if (url.includes('/ai/qc/generate')) return Response.json({ data: { scode: 'scode-1', auth_url: 'https://work.weixin.qq.com/ai/qc/auth?scode=scode-1' } })
      if (url.includes('/ai/qc/query_result?scode=scode-1')) return Response.json({ data: scanned ? { status: 'success', bot_info: { botid: 'bot-1', secret: 'bot-secret' } } : { status: 'init' } })
    })
    const login = await manager.login('agent-a', 'wecom')
    expect(login.qr).toContain('scode-1')
    expect(await manager.loginStatus('agent-a', login.sessionId)).toEqual({ status: 'wait' })
    scanned = true
    expect(await manager.loginStatus('agent-a', login.sessionId)).toEqual({ status: 'confirmed' })
    await vi.waitFor(() => expect(manager.list('agent-a')[0]).toMatchObject({ provider: 'wecom', label: 'bot-1', status: 'connected', paired: false }))
    expect(wecom.sent('aibot_subscribe')[0].body).toEqual({ bot_id: 'bot-1', secret: 'bot-secret' })

    const notice = wecom.push(text('m1', 'hello'))
    await vi.waitFor(() => expect(wecom.sent('aibot_respond_msg').find(f => f.headers.req_id === notice)?.body.stream.content).toContain('还未配对'))
    const pair = wecom.push(text('m2', `/pair ${manager.list('agent-a')[0].pairingCode}`))
    await vi.waitFor(() => expect(wecom.sent('aibot_respond_msg').find(f => f.headers.req_id === pair)?.body.stream).toMatchObject({ finish: true, content: expect.stringContaining('配对成功') }))
    wecom.push({ ...text('g1', '@bot hi'), chattype: 'group', chatid: 'group-1' })

    reply.mockResolvedValueOnce(['First **bubble**', 'Second'])
    const ask = wecom.push(text('m3', 'question', { quote: { msgtype: 'text', text: { content: 'earlier' } } }))
    await vi.waitFor(() => expect(wecom.sent('aibot_send_msg')).toHaveLength(1))
    expect(reply).toHaveBeenCalledTimes(1)
    expect(reply.mock.calls[0][2]).toBe('> earlier\n\nquestion')
    const stream = wecom.sent('aibot_respond_msg').filter(f => f.headers.req_id === ask).map(f => f.body.stream)
    expect(stream).toEqual([{ id: stream[0].id, finish: false, content: '<think></think>' }, { id: stream[0].id, finish: true, content: 'First **bubble**' }])
    expect(wecom.sent('aibot_send_msg')[0].body).toEqual({ chatid: 'zhangsan', msgtype: 'markdown', markdown: { content: 'Second' } })
  })

  it('validates manual credentials and parks a bot taken over by another client', async () => {
    const { manager, wecom } = setup(() => undefined)
    await expect(manager.connect('agent-a', { provider: 'wecom', botId: 'bot-1', secret: 'wrong' })).rejects.toThrow('Bot ID 或 Secret 无效')
    expect(manager.list('agent-a')).toEqual([])
    await manager.connect('agent-a', { provider: 'wecom', botId: 'bot-1', secret: 'bot-secret' })
    await vi.waitFor(() => expect(manager.list('agent-a')[0].status).toBe('connected'))
    const count = wecom.sockets.length
    wecom.live.at(-1)!.emit({ cmd: 'aibot_event_callback', headers: { req_id: 'event' }, body: { event: { eventtype: 'disconnected_event' } } })
    await vi.waitFor(() => expect(manager.list('agent-a')[0]).toMatchObject({ status: 'error', error: expect.stringContaining('其他客户端') }))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(wecom.sockets).toHaveLength(count)
  })

  it('downloads and decrypts inbound images and uploads generated images', async () => {
    const key = randomBytes(32)
    const plain = Buffer.from('89504e470d0a1a0a0000', 'hex')
    const padded = Buffer.concat([plain, Buffer.alloc(32 - plain.length % 32, 32 - plain.length % 32)])
    const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16)).setAutoPadding(false)
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()])
    expect(Buffer.from(decryptWecomMedia(encrypted, key.toString('base64')))).toEqual(plain)
    const { manager, wecom, reply } = setup(url => url === 'https://wecom.example/image' ? new Response(encrypted, { headers: { 'content-disposition': 'attachment; filename="photo.png"' } }) : undefined)
    await manager.connect('agent-a', { provider: 'wecom', botId: 'bot-1', secret: 'bot-secret' })
    await vi.waitFor(() => expect(manager.list('agent-a')[0].status).toBe('connected'))
    wecom.push(text('m1', `/pair ${manager.list('agent-a')[0].pairingCode}`))
    await vi.waitFor(() => expect(manager.list('agent-a')[0].paired).toBe(true))
    reply.mockResolvedValueOnce([{ image: { name: 'out.png', mimeType: 'image/png', data: plain } }])
    wecom.push({ msgid: 'm2', chattype: 'single', from: { userid: 'zhangsan' }, msgtype: 'image', image: { url: 'https://wecom.example/image', aeskey: key.toString('base64') } })
    await vi.waitFor(() => expect(wecom.sent('aibot_send_msg')).toHaveLength(1))
    expect((reply.mock.calls[0] as any[])[5][0]).toMatchObject({ name: 'photo.png', image: true, data: plain })
    expect(wecom.sent('aibot_send_msg')[0].body).toEqual({ chatid: 'zhangsan', msgtype: 'image', image: { media_id: 'media-1' } })
    // The thinking stream must not be left spinning after an image-only reply.
    await vi.waitFor(() => expect(wecom.sent('aibot_respond_msg').at(-1).body.stream).toMatchObject({ finish: true, content: '✅' }))
  })
})

describe('Feishu QR registration', () => {
  it('creates an app by scan and pairs the scanner without a pairing command', async () => {
    let polls = 0
    const { manager, reply } = setup((url, init) => {
      if (!url.startsWith('https://accounts.feishu.cn/oauth/v1/app/registration')) return
      const form = new URLSearchParams(String(init?.body))
      if (form.get('action') === 'begin') {
        expect(Object.fromEntries(form)).toMatchObject({ archetype: 'PersonalAgent', auth_method: 'client_secret', request_user_info: 'open_id' })
        return Response.json({ device_code: 'device-1', verification_uri_complete: 'https://open.feishu.cn/page/register?user_code=ABC', interval: 5, expires_in: 600 })
      }
      expect(form.get('device_code')).toBe('device-1')
      return ++polls === 1 ? Response.json({ error: 'authorization_pending' }, { status: 400 })
        : Response.json({ client_id: 'cli_0123456789abcdef', client_secret: 'app-secret', user_info: { open_id: 'ou_owner', tenant_brand: 'feishu' } })
    })
    const login = await manager.login('agent-a', 'feishu')
    expect(new URL(login.qr).searchParams.get('from')).toBe('onboard')
    expect(await manager.loginStatus('agent-a', login.sessionId)).toEqual({ status: 'wait' })
    expect(await manager.loginStatus('agent-a', login.sessionId)).toEqual({ status: 'confirmed' })
    expect(manager.list('agent-a')[0]).toMatchObject({ provider: 'feishu', label: 'cli_0123456789abcdef', paired: false })
    const message = (id: string, openId: string, text: string) => sdk.handler({ sender: { sender_type: 'user', sender_id: { open_id: openId } },
      message: { message_id: id, chat_id: 'chat-' + openId, chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text }) } })
    await message('m1', 'ou_stranger', 'hi')
    expect(manager.list('agent-a')[0].paired).toBe(false)
    await message('m2', 'ou_owner', 'hi')
    expect(manager.list('agent-a')[0].paired).toBe(true)
    await message('m3', 'ou_owner', 'question')
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1))
  })

  it('reports a declined authorization and rejects Lark tenants', async () => {
    const begin = { device_code: 'd', verification_uri_complete: 'https://open.feishu.cn/x' }
    let outcome: any = begin
    const { manager } = setup(url => url.startsWith('https://accounts.feishu.cn') ? Response.json(outcome, { status: outcome.error ? 400 : 200 }) : undefined)
    const first = await manager.login('agent-a', 'feishu')
    outcome = { error: 'access_denied' }
    expect(await manager.loginStatus('agent-a', first.sessionId)).toEqual({ status: 'denied' })
    outcome = begin
    const second = await manager.login('agent-a', 'feishu')
    outcome = { client_id: 'cli_0123456789abcdef', client_secret: 's', user_info: { tenant_brand: 'lark' } }
    await expect(manager.loginStatus('agent-a', second.sessionId)).rejects.toThrow('Lark')
    expect(manager.list('agent-a')).toEqual([])
  })
})
