import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { authorizeTokenDance } from './tokenDanceAuth'

it('uses a loopback callback with state and S256, rejects unrelated callbacks, and exchanges once', async () => {
  const controller = new AbortController()
  let opened!: (url: string) => void
  const ready = new Promise<string>(resolve => { opened = resolve })
  const exchange = vi.fn(async () => new Response(JSON.stringify({ key: 'fixture-key' })))
  const flow = authorizeTokenDance(async url => opened(url), controller.signal, exchange)
  try {
    const auth = new URL(await ready)
    expect(auth.origin + auth.pathname).toBe('https://tokendance.space/auth')
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256')
    expect(auth.searchParams.get('app_url')).toBe('https://douchat.ai')
    const callback = new URL(auth.searchParams.get('callback_url')!)
    expect(callback.hostname).toBe('127.0.0.1')
    const wrong = new URL(callback); wrong.searchParams.set('state', 'wrong'); wrong.searchParams.set('code', 'code')
    expect((await fetch(wrong)).status).toBe(404)
    expect(exchange).not.toHaveBeenCalled()
    callback.searchParams.set('code', 'fixture-code')
    expect((await fetch(callback)).status).toBe(200)
    expect(await flow).toBe('fixture-key')
    expect(exchange).toHaveBeenCalledTimes(1)
    const [endpoint, options] = (exchange.mock.calls as unknown as [string, RequestInit][])[0]
    expect(endpoint).toBe('https://tokendance.space/portal/api/v1/auth/keys')
    const body = JSON.parse(options.body as string)
    expect(body.code).toBe('fixture-code')
    expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    expect(createHash('sha256').update(body.code_verifier).digest('base64url')).toBe(auth.searchParams.get('code_challenge'))
    expect(options.redirect).toBe('error')
  } finally { controller.abort() }
})

it('cancels and closes the listener without exchanging a key', async () => {
  const controller = new AbortController()
  let opened!: (url: string) => void
  const ready = new Promise<string>(resolve => { opened = resolve })
  const exchange = vi.fn()
  const flow = authorizeTokenDance(async url => opened(url), controller.signal, exchange)
  const failure = expect(flow).rejects.toThrow('cancelled')
  const auth = new URL(await ready)
  controller.abort()
  await failure
  await expect(fetch(auth.searchParams.get('callback_url')!)).rejects.toThrow()
  expect(exchange).not.toHaveBeenCalled()
})

it.each([403, 200])('sanitizes exchange failures with HTTP %s', async status => {
  const controller = new AbortController()
  let opened!: (url: string) => void
  const ready = new Promise<string>(resolve => { opened = resolve })
  const flow = authorizeTokenDance(async url => opened(url), controller.signal, async () => new Response('upstream-secret', { status }))
  const failure = expect(flow).rejects.toThrow('TokenDance authorization failed. Please try again.')
  const callback = new URL(new URL(await ready).searchParams.get('callback_url')!)
  callback.searchParams.set('code', 'test')
  expect((await fetch(callback)).status).toBe(502)
  await failure
})

it('handles browser launch failure', async () => {
  await expect(authorizeTokenDance(async () => { throw new Error('private details') }, new AbortController().signal)).rejects.toThrow('Could not open the authorization page.')
})

it('handles denial without exchanging a key', async () => {
  let opened!: (url: string) => void
  const ready = new Promise<string>(resolve => { opened = resolve })
  const exchange = vi.fn()
  const flow = authorizeTokenDance(async url => opened(url), new AbortController().signal, exchange)
  const failure = expect(flow).rejects.toThrow('declined')
  const callback = new URL(new URL(await ready).searchParams.get('callback_url')!)
  callback.searchParams.set('error', 'access_denied')
  await fetch(callback)
  await failure
  expect(exchange).not.toHaveBeenCalled()
})

it('expires abandoned authorizations', async () => {
  vi.useFakeTimers()
  try {
    let opened!: () => void
    const ready = new Promise<void>(resolve => { opened = resolve })
    const flow = authorizeTokenDance(async () => opened(), new AbortController().signal)
    const failure = expect(flow).rejects.toThrow('timed out')
    await ready
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    await failure
  } finally { vi.useRealTimers() }
})
