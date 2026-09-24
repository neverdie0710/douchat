import { createCipheriv, randomBytes } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { decryptWechatMedia, downloadMedia, imageInput, mediaName, MAX_IM_FILE_BYTES } from './imMedia'

describe('IM media', () => {
  it('detects image bytes rather than trusting filenames', () => {
    expect(imageInput({ name: '../photo.exe', image: true, data: Buffer.from('89504e470d0a1a0a', 'hex') })).toMatchObject({ name: 'photo.exe', mimeType: 'image/png' })
    expect(() => imageInput({ name: 'photo.png', image: true, data: Buffer.from('text') })).toThrow('图片格式')
    expect(mediaName('../../foo\\bar\n.txt')).toBe('bar_.txt')
  })
  it('decrypts both WeChat key encodings and raw image hex keys', () => {
    const key = randomBytes(16)
    const cipher = createCipheriv('aes-128-ecb', key, null)
    const body = Buffer.from('hello document')
    const encrypted = Buffer.concat([cipher.update(body), cipher.final()])
    for (const encoded of [key.toString('base64'), Buffer.from(key.toString('hex')).toString('base64')]) {
      expect(decryptWechatMedia(encrypted, encoded)).toEqual(body)
    }
    expect(decryptWechatMedia(encrypted, undefined, key.toString('hex'))).toEqual(body)
    expect(() => decryptWechatMedia(encrypted.subarray(0, 3), key.toString('base64'))).toThrow('解密失败')
  })
  it('bounds streamed downloads without trusting content-length', async () => {
    let cancelled = false
    const request = vi.fn(async () => new Response(new ReadableStream({
      start(c) { c.enqueue(new Uint8Array(MAX_IM_FILE_BYTES)); c.enqueue(new Uint8Array(17)) },
      cancel() { cancelled = true }
    })))
    await expect(downloadMedia(request, 'https://example.com', new AbortController().signal)).rejects.toThrow('20 MB')
    expect(cancelled).toBe(true)
  })
  it('downloads bytes and rejects a cancelled request', async () => {
    const request = vi.fn(async () => new Response('hello'))
    expect(Buffer.from(await downloadMedia(request, 'https://example.com', new AbortController().signal)).toString()).toBe('hello')
    const abort = new AbortController(); abort.abort()
    await expect(downloadMedia(request, 'https://example.com', abort.signal)).rejects.toThrow()
  })
})
