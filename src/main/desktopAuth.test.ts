import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  encryptString: vi.fn((): Buffer => { throw new Error('User denied Keychain access') })
}))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: electron.encryptString,
    decryptString: vi.fn()
  },
  shell: { openExternal: vi.fn() }
}))

import { createLoopbackSuccessPage, DesktopAuth } from './desktopAuth'

const originalFetch = globalThis.fetch
const directories: string[] = []

afterEach(() => {
  globalThis.fetch = originalFetch
  electron.encryptString.mockClear()
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true })
})

describe('desktop authentication', () => {
  it('offers a safe way back to the Douchat website after loopback login', () => {
    const page = createLoopbackSuccessPage()

    expect(page).toContain('登录成功')
    expect(page).toContain('返回 Douchat 官网')
    expect(page).toContain('href="https://douchat.ai"')
    expect(page).not.toContain('douchat://')
  })

  it('keeps the current session in memory when secure persistence is declined', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'douchat-auth-'))
    directories.push(directory)
    const state = 's'.repeat(43)
    const code = 'c'.repeat(43)
    writeFileSync(join(directory, 'auth-flow.json'), JSON.stringify({
      state,
      codeVerifier: 'v'.repeat(43),
      redirectUri: 'douchat://auth/callback',
      createdAt: Date.now()
    }))
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      data: {
        accessToken: 'dch_session-only',
        user: { id: 'user-1', name: 'Douchat User', email: 'user@example.com' }
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const auth = new DesktopAuth('https://douchat.ai', 'douchat', false, directory, () => {})

    const result = await auth.handleCallback(`douchat://auth/callback?state=${state}&code=${code}`)

    expect(result).toMatchObject({ status: 'signed-in', user: { id: 'user-1' } })
    expect(auth.getAccessToken()).toBe('dch_session-only')
    expect(electron.encryptString).toHaveBeenCalledWith('dch_session-only')
    expect(existsSync(join(directory, 'auth.json'))).toBe(false)
    expect(existsSync(join(directory, 'auth-flow.json'))).toBe(false)
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('secure session persistence unavailable'),
      'User denied Keychain access'
    )
    warning.mockRestore()
  })

  it('uploads a prepared avatar and saves only its CDN URL on the profile', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'douchat-auth-'))
    directories.push(directory)
    const state = 's'.repeat(43)
    const code = 'c'.repeat(43)
    writeFileSync(join(directory, 'auth-flow.json'), JSON.stringify({
      state,
      codeVerifier: 'v'.repeat(43),
      redirectUri: 'douchat://auth/callback',
      createdAt: Date.now()
    }))

    const requests: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.endsWith('/api/desktop-auth/token')) {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            accessToken: 'dch_test-avatar-session',
            user: { id: 'user-1', name: 'Douchat User', email: 'user@example.com' }
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/api/desktop-auth/avatar')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer dch_test-avatar-session' })
        expect(init?.body).toBeInstanceOf(FormData)
        const file = (init?.body as FormData).get('file')
        expect(file).toBeInstanceOf(File)
        expect((file as File).type).toBe('image/png')
        return new Response(JSON.stringify({
          code: 0,
          data: { url: 'https://cdn.douchat.ai/uploads/avatar.png' }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/api/desktop-auth/me')) {
        expect(JSON.parse(String(init?.body))).toEqual({
          name: 'Updated User',
          image: 'https://cdn.douchat.ai/uploads/avatar.png'
        })
        return new Response(JSON.stringify({
          code: 0,
          data: {
            user: {
              id: 'user-1',
              name: 'Updated User',
              email: 'user@example.com',
              image: 'https://cdn.douchat.ai/uploads/avatar.png'
            }
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as typeof fetch

    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const auth = new DesktopAuth('https://douchat.ai', 'douchat', false, directory, () => {})
    await auth.handleCallback(`douchat://auth/callback?state=${state}&code=${code}`)

    const result = await auth.updateProfile({
      name: 'Updated User',
      image: 'data:image/png;base64,aGVsbG8='
    })

    expect(result).toMatchObject({
      status: 'signed-in',
      user: { image: 'https://cdn.douchat.ai/uploads/avatar.png' }
    })
    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      '/api/desktop-auth/token',
      '/api/desktop-auth/avatar',
      '/api/desktop-auth/me'
    ])
    warning.mockRestore()
  })
})
