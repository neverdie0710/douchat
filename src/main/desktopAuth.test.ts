import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  it('retains validated template translations and rejects oversized translated prompts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'douchat-auth-')); directories.push(directory)
    const auth = new DesktopAuth('https://douchat.ai', 'douchat', false, directory, vi.fn())
    const translation = { role: '助手', instructions: '帮助用户', labels: '豆博士' }
    const manifest = { version: 1, agents: [{ id: 'admin', systemKey: 'dr-dou', systemRole: 'admin', capabilities: ['manage_agents'], templateVersion: 2, name: 'Dr. Dou', role: 'Assistant', instructions: 'Help the user', labels: 'Dr. Dou', color: '#14B8A6', modelRoute: 'default', localizations: { 'zh-CN': translation } }] }
    expect((auth as any).requireBuiltInManifest(manifest).agents[0].localizations['zh-CN']).toEqual(translation)
    translation.instructions = 'x'.repeat(12001)
    expect(() => (auth as any).requireBuiltInManifest(manifest)).toThrow('translation')
  })

  it('offers a safe way back to the Douchat website after loopback login', () => {
    const page = createLoopbackSuccessPage()

    expect(page).toContain('登录成功')
    expect(page).toContain('返回 Douchat 官网')
    expect(page).toContain('href="https://douchat.ai"')
    expect(page).not.toContain('douchat://')
  })

  it.each([true, false])('waits for token exchange before returning the browser result (success=%s)', async (success) => {
    const directory = mkdtempSync(join(tmpdir(), 'douchat-auth-'))
    directories.push(directory)
    const auth = new DesktopAuth('https://douchat.ai', 'douchat', true, directory, vi.fn())
    let finishExchange!: (response: Response) => void
    let exchangeStarted!: () => void
    const started = new Promise<void>(resolve => { exchangeStarted = resolve })
    globalThis.fetch = vi.fn(() => {
      exchangeStarted()
      return new Promise<Response>(resolve => { finishExchange = resolve })
    }) as typeof fetch
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await auth.startLogin()
      const flow = JSON.parse(readFileSync(join(directory, 'auth-flow.json'), 'utf8'))
      const callback = `${flow.redirectUri}?state=${flow.state}&code=${'c'.repeat(43)}`
      let browserResponded = false
      const browser = originalFetch(callback).then(response => { browserResponded = true; return response })
      await started
      expect(auth.getState().status).toBe('checking')
      expect(browserResponded).toBe(false)
      const duplicate = await originalFetch(callback)
      expect(duplicate.status).toBe(409)
      await duplicate.text()
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
      finishExchange(new Response(JSON.stringify(success ? {
        code: 0,
        data: { accessToken: 'dch_test', user: { id: 'user-1', email: 'user@example.com' } }
      } : { message: 'HTTPError' }), { status: success ? 200 : 503 }))
      const response = await browser
      const page = await response.text()
      expect(response.status).toBe(success ? 200 : 502)
      expect(page).toContain(success ? '登录成功' : '登录未完成')
      if (!success) {
        expect(page).not.toContain('登录成功')
        expect(page).toContain('HTTP 503')
        expect(page).not.toContain('HTTPError')
        expect(auth.getState()).toMatchObject({ status: 'error', error: expect.stringContaining('HTTP 503') })
      } else {
        expect(auth.getState().status).toBe('signed-in')
      }
    } finally {
      warning.mockRestore()
      globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 })) as typeof fetch
      await auth.signOut()
    }
  })

  it('cancels a pending browser login and rejects its late callback', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'douchat-auth-'))
    directories.push(directory)
    const auth = new DesktopAuth('https://douchat.ai', 'douchat', false, directory, vi.fn())

    expect(await auth.startLogin()).toEqual({ status: 'waiting' })
    const flow = JSON.parse(readFileSync(join(directory, 'auth-flow.json'), 'utf8')) as { state: string }
    expect(await auth.cancelLogin()).toEqual({ status: 'signed-out' })
    expect(existsSync(join(directory, 'auth-flow.json'))).toBe(false)

    const late = await auth.handleCallback(`douchat://auth/callback?state=${flow.state}&code=${'c'.repeat(43)}`)
    expect(late.status).toBe('error')
    expect(auth.getAccessToken()).toBeFalsy()
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
    const onChange = vi.fn()
    const auth = new DesktopAuth('https://douchat.ai', 'douchat', false, directory, onChange)

    const result = await auth.handleCallback(`douchat://auth/callback?state=${state}&code=${code}`)

    expect(result).toMatchObject({ status: 'signed-in', user: { id: 'user-1' } })
    expect(onChange).toHaveBeenLastCalledWith(result, 'login-completed')
    // Focus-triggered profile refresh must not request another activation,
    // even when its response arrives after the user switches applications.
    onChange.mockClear()
    await auth.refreshProfile()
    await auth.refreshProfile()
    expect(onChange).toHaveBeenCalledTimes(2)
    for (const [state, reason] of onChange.mock.calls) {
      expect(state.status).toBe('signed-in')
      expect(reason).toBeUndefined()
    }
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
