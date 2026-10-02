import { describe, expect, it } from 'vitest'
import {
  parseDesktopGroupUrl,
  parseDesktopConnectorsUrl,
  chatApiBaseUrl,
  createDesktopLoginUrl,
  desktopAuthScheme,
  isDesktopAuthUrl,
  isDesktopCreditsUrl,
  normalizeWebAppUrl,
  parseDesktopAuthCallback
} from './authProtocol'

describe('desktop auth protocol', () => {
  it('accepts only valid group open links', () => {
    expect(parseDesktopGroupUrl('douchat://group/open?room=group-123')).toBe('group-123')
    expect(parseDesktopGroupUrl('https://group/open?room=group-123')).toBeUndefined()
    expect(parseDesktopGroupUrl('douchat://group/join?room=group-123')).toBeUndefined()
    expect(parseDesktopGroupUrl('douchat://group/open?room=../secret')).toBeUndefined()
    expect(parseDesktopGroupUrl('douchat://group/open')).toBeUndefined()
  })

  it('accepts only connector return links', () => {
    expect(parseDesktopConnectorsUrl('douchat://connectors/callback?connany_session_id=cs_1')).toBe('cs_1')
    expect(parseDesktopConnectorsUrl('douchat://connectors/callback')).toBe('')
    expect(parseDesktopConnectorsUrl('https://connectors/callback?connany_session_id=cs_1')).toBeUndefined()
    expect(parseDesktopConnectorsUrl('douchat://connectors/other?connany_session_id=cs_1')).toBeUndefined()
    expect(parseDesktopConnectorsUrl('douchat://connectors/callback?connany_session_id=../x')).toBeUndefined()
    // The development host listens on its own scheme only.
    expect(parseDesktopConnectorsUrl('douchat-dev://connectors/callback?connany_session_id=cs_1', 'douchat-dev')).toBe('cs_1')
    expect(parseDesktopConnectorsUrl('douchat://connectors/callback?connany_session_id=cs_1', 'douchat-dev')).toBeUndefined()
    expect(parseDesktopConnectorsUrl('douchat-dev://connectors/callback?connany_session_id=cs_1')).toBeUndefined()
  })

  it('uses the Douchat scheme and environment-specific web origin', () => {
    expect(desktopAuthScheme()).toBe('douchat')
    expect(normalizeWebAppUrl(undefined, true)).toBe('https://douchat.ai')
    expect(normalizeWebAppUrl('', true)).toBe('https://douchat.ai')
    expect(normalizeWebAppUrl('ftp://example.com', true)).toBe('https://douchat.ai')
    expect(normalizeWebAppUrl(undefined, false)).toBe('https://douchat.ai')
    expect(normalizeWebAppUrl('https://staging.example.com', false)).toBe('https://douchat.ai')
    expect(normalizeWebAppUrl('http://example.com', false)).toBe('https://douchat.ai')
    expect(normalizeWebAppUrl('file:///tmp/login', false)).toBe('https://douchat.ai')
    expect(normalizeWebAppUrl('http://localhost:3004/path', true)).toBe('http://localhost:3004')
    expect(chatApiBaseUrl('http://localhost:3004')).toBe('http://localhost:3004/v1')
    expect(chatApiBaseUrl('https://douchat.ai')).toBe('https://douchat.ai/v1')
  })

  it('builds the PKCE authorization URL', () => {
    const state = 'a'.repeat(43)
    const challenge = 'b'.repeat(43)
    const login = new URL(createDesktopLoginUrl('https://douchat.ai', state, challenge, 'douchat://auth/callback'))
    expect(login.origin).toBe('https://douchat.ai')
    expect(login.pathname).toBe('/desktop-auth')
    expect(login.searchParams.get('client_id')).toBe('douchat-desktop')
    expect(login.searchParams.get('state')).toBe(state)
    expect(login.searchParams.get('code_challenge')).toBe(challenge)
    expect(login.searchParams.get('redirect_uri')).toBe('douchat://auth/callback')
  })

  it('accepts only the expected scheme, route, state and code', () => {
    const code = 'c'.repeat(43)
    const url = `douchat://auth/callback?state=nonce-1&code=${code}`
    expect(isDesktopAuthUrl(url, 'douchat')).toBe(true)
    expect(parseDesktopAuthCallback(url, 'douchat://auth/callback', 'nonce-1')).toEqual({ code })
    expect(() => parseDesktopAuthCallback(url, 'douchat://auth/callback', 'nonce-2')).toThrow(/verified/)
    expect(() => parseDesktopAuthCallback(url, 'douchat-dev://auth/callback', 'nonce-1')).toThrow(/Unexpected/)
  })

  it('accepts only the fixed credits-updated callback', () => {
    expect(isDesktopCreditsUrl('douchat://payment/callback?status=paid', 'douchat')).toBe(true)
    expect(isDesktopCreditsUrl('douchat://payment/callback?status=pending', 'douchat')).toBe(false)
    expect(isDesktopCreditsUrl('douchat://payment/callback?status=failed', 'douchat')).toBe(false)
    expect(isDesktopCreditsUrl('douchat://payment/updated?status=paid', 'douchat')).toBe(false)
    expect(isDesktopCreditsUrl('douchat-dev://payment/callback?status=paid', 'douchat')).toBe(false)
    expect(isDesktopCreditsUrl('https://douchat.ai/payment/callback?status=paid', 'douchat')).toBe(false)
  })
})
