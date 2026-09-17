export const AUTH_CALLBACK_HOST = 'auth'
export const AUTH_CALLBACK_PATH = '/callback'
export const DESKTOP_AUTH_CLIENT_ID = 'douchat-desktop'
export const DOUCHAT_PRODUCTION_ORIGIN = 'https://douchat.ai'

export interface AuthCallbackPayload {
  code: string
}

export function desktopAuthScheme(): 'douchat' {
  return 'douchat'
}

export function normalizeWebAppUrl(value: string | undefined, development: boolean): string {
  const fallback = development ? 'http://localhost:3000' : DOUCHAT_PRODUCTION_ORIGIN
  // Local development may point auth and Chat API traffic at another origin.
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
