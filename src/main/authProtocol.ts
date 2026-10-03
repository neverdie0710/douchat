export const AUTH_CALLBACK_HOST = 'auth'
export const AUTH_CALLBACK_PATH = '/callback'
export const CREDITS_CALLBACK_HOST = 'payment'
export const CREDITS_CALLBACK_PATH = '/callback'
export const DESKTOP_AUTH_CLIENT_ID = 'douchat-desktop'
export const DOUCHAT_PRODUCTION_ORIGIN = 'https://douchat.ai'
/** Registered only by the development host, so its browser returns never open the packaged app. */
export const DEVELOPMENT_APP_SCHEME = 'douchat-dev'

export interface AuthCallbackPayload {
  code: string
}

export function desktopAuthScheme(): 'douchat' {
  return 'douchat'
}

export function normalizeWebAppUrl(value: string | undefined, development: boolean): string {
  // Development also defaults to douchat.ai so a fresh source checkout can sign
  // in without running the service; set DOUCHAT_SERVICE_URL to use another one.
  const fallback = DOUCHAT_PRODUCTION_ORIGIN
  // Packaged builds deliberately ignore ambient environment variables so a
  // shell-level override cannot redirect account tokens away from douchat.ai.
  if (!development) return fallback
  try {
    const url = new URL(value?.trim() || fallback)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return fallback
    return url.origin
  } catch {
    return fallback
  }
}

export function chatApiBaseUrl(webAppUrl: string): string {
  return new URL('/v1', webAppUrl).toString().replace(/\/$/, '')
}

export function createDesktopLoginUrl(webAppUrl: string, state: string, codeChallenge: string, redirectUri: string): string {
  const authorize = new URL('/desktop-auth', webAppUrl)
  authorize.searchParams.set('client_id', DESKTOP_AUTH_CLIENT_ID)
  authorize.searchParams.set('state', state)
  authorize.searchParams.set('code_challenge', codeChallenge)
  authorize.searchParams.set('redirect_uri', redirectUri)
  return authorize.toString()
}

export function parseDesktopAuthCallback(input: string, expectedRedirectUri: string, expectedState: string): AuthCallbackPayload {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('Invalid login callback')
  }

  const expected = new URL(expectedRedirectUri)
  if (url.protocol !== expected.protocol || url.hostname !== expected.hostname || url.port !== expected.port || url.pathname !== expected.pathname) {
    throw new Error('Unexpected login callback')
  }
  if (!expectedState || url.searchParams.get('state') !== expectedState) {
    throw new Error('Login callback could not be verified')
  }

  const code = url.searchParams.get('code')?.trim() || ''
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw new Error('Login callback did not include a valid authorization code')
  return { code }
}

export function isDesktopAuthUrl(input: string, scheme: string): boolean {
  try {
    const url = new URL(input)
    return url.protocol === `${scheme}:` && url.hostname === AUTH_CALLBACK_HOST && url.pathname === AUTH_CALLBACK_PATH
  } catch {
    return false
  }
}

export function isDesktopCreditsUrl(input: string, scheme: string): boolean {
  try {
    const url = new URL(input)
    return url.protocol === `${scheme}:`
      && url.hostname === CREDITS_CALLBACK_HOST
      && url.pathname === CREDITS_CALLBACK_PATH
      && url.searchParams.get('status') === 'paid'
  } catch {
    return false
  }
}

export function parseDesktopGroupUrl(input: string): string | undefined {
  try {
    const url = new URL(input)
    const room = url.searchParams.get('room') ?? ''
    if (url.protocol === 'douchat:' && url.hostname === 'group' && url.pathname === '/open' && !url.username && !url.password && !url.port && /^[A-Za-z0-9_-]{1,200}$/.test(room)) return room
  } catch { /* Ignore unrelated app links. */ }
  return undefined
}

/** douchat://connectors/callback?connany_session_id=… opened by the backend's
 * return page after a connector authorization. Returns the (untrusted) session ID. */
export function parseDesktopConnectorsUrl(input: string, scheme = 'douchat'): string | undefined {
  try {
    const url = new URL(input)
    const id = url.searchParams.get('connany_session_id') ?? ''
    if (url.protocol === `${scheme}:` && url.hostname === 'connectors' && url.pathname === '/callback' && !url.username && !url.password && !url.port && /^[A-Za-z0-9_-]{0,200}$/.test(id)) return id
  } catch { /* Ignore unrelated app links. */ }
  return undefined
}
