import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'
import { safeStorage, shell } from 'electron'
import type { DesktopAuthState, DesktopAuthUser, UpdateDesktopProfileInput } from '../shared/types'
import { createDesktopLoginUrl, DESKTOP_AUTH_CLIENT_ID, parseDesktopAuthCallback } from './authProtocol'

interface StoredCredential {
  version: 1
  encryptedAccessToken: string
}

interface PendingFlow {
  state: string
  codeVerifier: string
  redirectUri: string
  createdAt: number
}

interface ApiEnvelope<T> {
  code: number
  message?: string
  data?: T
}

const FLOW_MAX_AGE_MS = 10 * 60 * 1000

export class DesktopAuth {
  private readonly credentialPath: string
  private readonly pendingPath: string
  private state: DesktopAuthState = { status: 'checking' }
  private accessToken = ''
  private callbackServer: Server | null = null

  constructor(
    private readonly webAppUrl: string,
    private readonly scheme: string,
    private readonly useLoopbackCallback: boolean,
    userDataPath: string,
    private readonly onChange: (state: DesktopAuthState) => void
  ) {
    this.credentialPath = join(userDataPath, 'auth.json')
    this.pendingPath = join(userDataPath, 'auth-flow.json')
  }

  getState(): DesktopAuthState {
    return this.state
  }

  /** The model transport may read the current token in the main process only.
   * It is intentionally absent from DesktopAuthState and every IPC contract. */
  getAccessToken(): string | undefined {
    return this.state.status === 'signed-in' && this.accessToken ? this.accessToken : undefined
  }

  async initialize(): Promise<DesktopAuthState> {
    this.setState({ status: 'checking' })
    const stored = await this.readCredential()
    if (!stored) {
      const pending = await this.readPendingFlow()
      if (pending?.redirectUri.startsWith('http://')) {
        await this.removeFile(this.pendingPath)
        return this.setState({ status: 'signed-out' })
      }
      return this.setState(pending ? { status: 'waiting' } : { status: 'signed-out' })
    }

    this.accessToken = stored.accessToken
    try {
      const user = await this.fetchUser(this.accessToken)
      return this.setState({ status: 'signed-in', user })
    } catch (error) {
      if (error instanceof InvalidSessionError) {
        await this.clearCredential()
        return this.setState({ status: 'signed-out' })
      }
      return this.setState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Could not reach the login service.'
      })
    }
  }

  async startLogin(): Promise<DesktopAuthState> {
    try {
      const codeVerifier = randomBytes(32).toString('base64url')
      const state = randomBytes(32).toString('base64url')
      const redirectUri = this.useLoopbackCallback
        ? await this.startLoopbackCallback(state)
        : `${this.scheme}://auth/callback`
      const flow: PendingFlow = { state, codeVerifier, redirectUri, createdAt: Date.now() }
      const codeChallenge = createHash('sha256').update(codeVerifier, 'utf8').digest('base64url')
      await this.writeJson(this.pendingPath, flow)
      this.setState({ status: 'waiting' })
      await shell.openExternal(createDesktopLoginUrl(this.webAppUrl, flow.state, codeChallenge, redirectUri))
      return this.state
    } catch (error) {
      this.stopLoopbackCallback()
      this.accessToken = ''
      await this.removeFile(this.pendingPath)
      return this.setState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Could not open the browser.'
      })
    }
  }

  /** End the desktop session without touching the user's local conversations. */
  async signOut(): Promise<DesktopAuthState> {
    this.stopLoopbackCallback()
    const accessToken = this.accessToken
    if (accessToken) {
      // Revocation is best-effort: signing out locally must still work when the
      // service is temporarily unreachable.
      try {
        await fetch(new URL('/api/desktop-auth/revoke', this.webAppUrl), {
          method: 'POST',
          headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` }
        })
      } catch {}
    }
    await this.clearCredential()
    await this.removeFile(this.pendingPath)
    return this.setState({ status: 'signed-out' })
  }

  /** A 401 from the first-party Chat API invalidates the same desktop session. */
  async invalidateSession(): Promise<DesktopAuthState> {
    this.stopLoopbackCallback()
    await this.clearCredential()
    await this.removeFile(this.pendingPath)
    return this.setState({ status: 'signed-out' })
  }

  async refreshProfile(): Promise<DesktopAuthState> {
    if (!this.accessToken) return this.setState({ status: 'signed-out' })
    try {
      return this.setState({ status: 'signed-in', user: await this.fetchUser(this.accessToken) })
    } catch (error) {
      if (error instanceof InvalidSessionError) {
        await this.clearCredential()
        return this.setState({ status: 'signed-out' })
      }
      throw error
    }
  }

  async updateProfile(input: UpdateDesktopProfileInput): Promise<DesktopAuthState> {
    if (!this.accessToken) return this.setState({ status: 'signed-out' })
    const changes: UpdateDesktopProfileInput = {}
    if (typeof input.name === 'string') changes.name = input.name.trim()
    if (typeof input.image === 'string') changes.image = input.image.trim()
    let response: Response
    try {
      response = await fetch(new URL('/api/desktop-auth/me', this.webAppUrl), {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(changes)
      })
    } catch {
      throw new Error('Could not reach the login service. Check your connection and try again.')
    }

    if (response.status === 401 || response.status === 403) {
      await this.clearCredential()
      return this.setState({ status: 'signed-out' })
    }
    const payload = await response.json().catch(() => null) as ApiEnvelope<{
      user?: Partial<DesktopAuthUser>
    }> | null
    if (!response.ok || !payload?.data?.user) {
      throw new Error(payload?.message || `Login service returned ${response.status}. Try again.`)
    }
    return this.setState({ status: 'signed-in', user: this.requireUser(payload.data.user) })
  }

  async handleCallback(input: string): Promise<DesktopAuthState> {
    const flow = await this.readPendingFlow()
    if (!flow) return this.setState({ status: 'error', error: 'This login request has expired. Start again.' })

    this.setState({ status: 'checking' })
    try {
      const { code } = parseDesktopAuthCallback(input, flow.redirectUri, flow.state)
      const exchanged = await this.exchangeCode(code, flow.codeVerifier)
      this.accessToken = exchanged.accessToken
      await this.saveCredential(exchanged.accessToken)
      await this.removeFile(this.pendingPath)
      return this.setState({ status: 'signed-in', user: exchanged.user })
    } catch (error) {
      this.accessToken = ''
      await this.removeFile(this.pendingPath)
      return this.setState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Login could not be completed.'
      })
    } finally {
      this.stopLoopbackCallback()
    }
  }

  private startLoopbackCallback(expectedState: string): Promise<string> {
    this.stopLoopbackCallback()
    return new Promise((resolve, reject) => {
      const server = createServer((request, response) => {
        const address = server.address()
        if (!request.url || !address || typeof address === 'string') {
          response.writeHead(400).end('Invalid callback')
          return
        }
        const callbackUrl = new URL(request.url, `http://127.0.0.1:${address.port}`)
        if (
          request.method !== 'GET'
          || callbackUrl.pathname !== '/auth/callback'
          || callbackUrl.searchParams.get('state') !== expectedState
          || !/^[A-Za-z0-9_-]{43}$/.test(callbackUrl.searchParams.get('code') || '')
        ) {
          response.writeHead(404).end('Not found')
          return
        }
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        response.end('<!doctype html><meta charset="utf-8"><title>Douchat</title><style>body{font:16px system-ui;display:grid;min-height:90vh;place-items:center;color:#202124}</style><p>登录成功，可以返回 Douchat 了。</p>')
        void this.handleCallback(callbackUrl.toString())
      })
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') {
          server.close()
          reject(new Error('Could not start the desktop login callback.'))
          return
        }
        this.callbackServer = server
        resolve(`http://127.0.0.1:${address.port}/auth/callback`)
      })
    })
  }

  private stopLoopbackCallback(): void {
    this.callbackServer?.close()
    this.callbackServer = null
  }

  private setState(state: DesktopAuthState): DesktopAuthState {
    this.state = state
    this.onChange(state)
    return state
  }

  private async fetchUser(accessToken: string): Promise<DesktopAuthUser> {
    let response: Response
    try {
      response = await fetch(new URL('/api/desktop-auth/me', this.webAppUrl), {
        headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` }
      })
    } catch {
      throw new Error('Could not reach the login service. Check your connection and try again.')
    }

    if (response.status === 401 || response.status === 403) throw new InvalidSessionError()
    if (!response.ok) throw new Error(`Login service returned ${response.status}. Try again.`)
    const payload = await response.json() as ApiEnvelope<{ user?: Partial<DesktopAuthUser> }>
    return this.requireUser(payload.data?.user)
  }

  private async exchangeCode(code: string, codeVerifier: string): Promise<{ accessToken: string; user: DesktopAuthUser }> {
    let response: Response
    try {
      response = await fetch(new URL('/api/desktop-auth/token', this.webAppUrl), {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, codeVerifier, clientId: DESKTOP_AUTH_CLIENT_ID })
      })
    } catch {
      throw new Error('Could not reach the login service. Check your connection and try again.')
    }

    const payload = await response.json().catch(() => null) as ApiEnvelope<{
      accessToken?: string
      user?: Partial<DesktopAuthUser>
    }> | null
    if (!response.ok || !payload?.data) {
      throw new Error(payload?.message || 'The login request expired or was already used. Start again.')
    }
    const accessToken = payload.data.accessToken || ''
    if (!accessToken.startsWith('dch_')) throw new Error('Login service returned an invalid session.')
    return { accessToken, user: this.requireUser(payload.data.user) }
  }

  private requireUser(user: Partial<DesktopAuthUser> | null | undefined): DesktopAuthUser {
    if (!user?.id || !user.email) throw new Error('Login service returned an invalid user.')
    return {
      id: user.id,
      name: user.name || user.email,
      email: user.email,
      image: this.normalizedImage(user.image)
    }
  }

  private normalizedImage(value: string | undefined): string | undefined {
    if (!value) return undefined
    if (value.startsWith('data:image/')) return value
    try { return new URL(value, this.webAppUrl).toString() }
    catch { return undefined }
  }

  private async saveCredential(accessToken: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure credential storage is unavailable on this computer.')
    }
    const stored: StoredCredential = {
      version: 1,
      encryptedAccessToken: safeStorage.encryptString(accessToken).toString('base64')
    }
    await this.writeJson(this.credentialPath, stored)
  }

  private async readCredential(): Promise<{ accessToken: string } | null> {
    try {
      const stored = JSON.parse(await readFile(this.credentialPath, 'utf8')) as StoredCredential
      if (stored.version !== 1 || !safeStorage.isEncryptionAvailable()) {
        await this.removeFile(this.credentialPath)
        return null
      }
      const accessToken = safeStorage.decryptString(Buffer.from(stored.encryptedAccessToken, 'base64'))
      if (!accessToken.startsWith('dch_')) {
        await this.removeFile(this.credentialPath)
        return null
      }
      return { accessToken }
    } catch {
      await this.removeFile(this.credentialPath)
      return null
    }
  }

  private async readPendingFlow(): Promise<PendingFlow | null> {
    try {
      const flow = JSON.parse(await readFile(this.pendingPath, 'utf8')) as PendingFlow
      const valid = /^[A-Za-z0-9_-]{43}$/.test(flow.state)
        && /^[A-Za-z0-9_-]{43,128}$/.test(flow.codeVerifier)
        && this.validRedirectUri(flow.redirectUri)
        && Number.isFinite(flow.createdAt)
        && Date.now() - flow.createdAt <= FLOW_MAX_AGE_MS
      if (!valid) {
        await this.removeFile(this.pendingPath)
        return null
      }
      return flow
    } catch {
      return null
    }
  }

  private validRedirectUri(value: string): boolean {
    if (value === `${this.scheme}://auth/callback`) return true
    try {
      const url = new URL(value)
      return url.protocol === 'http:' && url.hostname === '127.0.0.1' && Boolean(url.port) && url.pathname === '/auth/callback'
    } catch {
      return false
    }
  }

  private async clearCredential(): Promise<void> {
    this.accessToken = ''
    await this.removeFile(this.credentialPath)
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const temporaryPath = `${path}.${process.pid}.tmp`
    await writeFile(temporaryPath, JSON.stringify(value), { mode: 0o600 })
    await rename(temporaryPath, path)
  }

  private async removeFile(path: string): Promise<void> {
    try { await unlink(path) } catch {}
  }
}

class InvalidSessionError extends Error {}
