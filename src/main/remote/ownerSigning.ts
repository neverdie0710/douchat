import { createHash, randomUUID } from 'node:crypto'

/**
 * Owner-device signatures (remote-connections.md 6.8.4). The encoding must
 * match douchat-tanstack `signing.ts` and douchat-host byte for byte: the
 * server checks it for normal authorization and the host verifies it again
 * against its local trust anchor before applying anything.
 */
export const OWNER_SIGNATURE_DOMAIN = 'douchat-owner-v1\n'
/** Signatures are valid for 10 minutes; the server and host accept at most 15. */
export const SIGNATURE_LIFETIME_MS = 10 * 60 * 1000

/** Deterministic JSON: sorted keys, no whitespace, finite numbers only. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid signed content.')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  throw new Error('Invalid signed content.')
}

export const sha256Hex = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex')

export interface OwnerEnvelope {
  v: 1
  origin: string
  ownerId: string
  hostId: string
  deviceId: string
  method: string
  requestId: string
  issuedAt: number
  expiresAt: number
  payloadHash: string
}
export interface SignedCommand<T = Record<string, unknown>> {
  envelope: OwnerEnvelope
  payload: T
  signature: string
}

/** What signing needs from DesktopAuth; the private key never leaves it. */
export interface OwnerSigner {
  getDeviceId(): string | undefined
  signAsDevice(message: string): string
}

export const ownerSignedBytes = (envelope: OwnerEnvelope): string => OWNER_SIGNATURE_DOMAIN + canonicalJson(envelope)

/** Signs one owner command for one host (or '' for a desktop executor). */
export function signCommand<T extends Record<string, unknown>>(signer: OwnerSigner, input: { serviceUrl: string; ownerId: string; hostId: string; method: string; payload: T; now?: number }): SignedCommand<T> {
  const deviceId = signer.getDeviceId()
  if (!deviceId) throw new Error('请重新登录 Douchat 以启用设备身份。')
  // Round-trip so the signed payload is exactly what will be serialized.
  const payload = JSON.parse(JSON.stringify(input.payload)) as T
  const issuedAt = input.now ?? Date.now()
  const envelope: OwnerEnvelope = {
    v: 1,
    origin: new URL(input.serviceUrl).origin,
    ownerId: input.ownerId,
    hostId: input.hostId,
    deviceId,
    method: input.method,
    requestId: randomUUID(),
    issuedAt,
    expiresAt: issuedAt + SIGNATURE_LIFETIME_MS,
    payloadHash: sha256Hex(canonicalJson(payload))
  }
  return { envelope, payload, signature: signer.signAsDevice(ownerSignedBytes(envelope)) }
}
