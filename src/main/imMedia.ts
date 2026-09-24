import { createDecipheriv } from 'node:crypto'
import type { MessageImageInput } from '../shared/types'

export type IMReplyPart = string | { image: { name: string; mimeType: string; data: Uint8Array } }
export interface IMMedia { name: string; data: Uint8Array; image: boolean }
export const MAX_IM_FILE_BYTES = 20 * 1024 * 1024
export class IMMediaError extends Error {}
export function mediaName(name: unknown): string {
  let safe = (typeof name === 'string' ? name.split(/[\\/]/).pop()! : 'attachment')
    .replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').replace(/^\.+/, '_').replace(/[. ]+$/, '') || 'attachment'
  while (Buffer.byteLength(safe) > 180) safe = Array.from(safe).slice(0, -1).join('')
  return safe
}
export function imageInput(media: IMMedia): MessageImageInput {
  const b = Buffer.from(media.data)
  const mimeType = b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'image/png'
    : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg'
    : /^GIF8[79]a$/.test(b.subarray(0, 6).toString()) ? 'image/gif'
    : b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : undefined
  if (!mimeType) throw new IMMediaError('暂不支持这种图片格式，请转成 PNG、JPEG、WebP 或 GIF 后重发，或作为文件发送。')
  if (b.length > 8 * 1024 * 1024) throw new IMMediaError('图片超过 8 MB，请压缩后重发，或作为文件发送。')
  return { name: mediaName(media.name), mimeType, data: media.data }
}
export async function downloadMedia(request: typeof fetch, url: string, signal: AbortSignal, headers?: HeadersInit): Promise<Uint8Array> {
  const response = await request(url, { headers, redirect: 'error', signal })
  if (!response.ok || !response.body) throw new IMMediaError('附件下载失败，请重新发送。')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    if (Number(response.headers.get('content-length')) > MAX_IM_FILE_BYTES + 16) throw new IMMediaError('附件超过 20 MB，请压缩或拆分后重发。')
    while (true) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_IM_FILE_BYTES + 16) throw new IMMediaError('附件超过 20 MB，请压缩或拆分后重发。')
      chunks.push(value)
    }
    signal.throwIfAborted()
    if (!size) throw new IMMediaError('附件为空，请重新发送。')
    return Buffer.concat(chunks)
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}
export function decryptWechatMedia(data: Uint8Array, encoded?: string, hex?: string): Uint8Array {
  const raw = Buffer.from(encoded ?? '', 'base64')
  const key = hex ? Buffer.from(hex, 'hex') : raw.length === 16 ? raw : Buffer.from(raw.toString(), 'hex')
  if (key.length !== 16) throw new IMMediaError('微信附件密钥无效，请重新发送。')
  try {
    const decipher = createDecipheriv('aes-128-ecb', key, null)
    return Buffer.concat([decipher.update(data), decipher.final()])
  } catch { throw new IMMediaError('微信附件解密失败，请重新发送。') }
}
