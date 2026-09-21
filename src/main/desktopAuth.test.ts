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

import { DesktopAuth } from './desktopAuth'

const originalFetch = globalThis.fetch
const directories: string[] = []

afterEach(() => {
  globalThis.fetch = originalFetch
  electron.encryptString.mockClear()
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true })
})

describe('desktop authentication', () => {
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
})
