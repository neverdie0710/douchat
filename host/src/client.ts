import type { HostState } from './state'

export class UnauthorizedError extends Error {}
/** The service answered with an error message (HTTP 400/409). */
export class ServiceError extends Error {}

/** JSON over POST /api/host/channel, authenticated with the host token. */
export async function callChannel<T>(serviceUrl: string, token: string | undefined, body: object, signal?: AbortSignal, timeoutMs = 30_000): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const response = await fetch(new URL('/api/host/channel', serviceUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  })
  if (response.status === 401) throw new UnauthorizedError('This host is no longer registered with Douchat.')
  const payload = await response.json().catch(() => null) as { code?: number; message?: string; data?: T } | null
  if (response.ok && payload?.code === 0 && payload.data !== undefined) return payload.data
  const message = payload?.message || `Douchat service error (HTTP ${response.status}).`
  if (response.status >= 400 && response.status < 500) throw new ServiceError(message)
  throw new Error(message)
}

export class HostClient {
  constructor(private state: HostState) {}
  update(state: HostState): void { this.state = state }
  get current(): HostState { return this.state }
  call<T>(body: object, signal?: AbortSignal, timeoutMs?: number): Promise<T> {
    return callChannel<T>(this.state.serviceUrl, this.state.hostToken, body, signal, timeoutMs)
  }
}
