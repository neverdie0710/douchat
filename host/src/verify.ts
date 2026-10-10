import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { canonicalJson, ownerSignedBytes, sha256Hex, type OwnerEnvelope, type SignedCommand } from '../../src/main/remote/ownerSigning'
import type { SeenRequests, TrustState } from './state'

export const HOST_SIGNATURE_DOMAIN = 'douchat-host-v1\n'
/** The service and the host accept owner signatures valid for at most 15 minutes. */
const MAX_LIFETIME_MS = 15 * 60 * 1000
const CLOCK_SKEW_MS = 60 * 1000
const KEY = /^[A-Za-z0-9_-]{43}$/
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/

export class VerifyError extends Error {}

export function generateHostKey(): { signKey: string; signPublicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const jwk = publicKey.export({ format: 'jwk' }) as { x?: string }
  if (!jwk.x || !KEY.test(jwk.x)) throw new Error('Could not create the host key.')
  return { signKey: (privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer).toString('base64url'), signPublicKey: jwk.x }
}

export function signAsHost(signKey: string, value: unknown): string {
  const key = createPrivateKey({ key: Buffer.from(signKey, 'base64url'), format: 'der', type: 'pkcs8' })
  return sign(null, Buffer.from(HOST_SIGNATURE_DOMAIN + canonicalJson(value), 'utf8'), key).toString('base64url')
}

export function verifyEd25519(publicKey: string, message: string, signature: string): boolean {
  if (!KEY.test(publicKey) || typeof signature !== 'string' || !SIGNATURE.test(signature)) return false
  try {
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' })
    return verify(null, Buffer.from(message, 'utf8'), key, Buffer.from(signature, 'base64url'))
  } catch {
    return false
  }
}

/** Same short fingerprint the desktop shows next to the install command. */
export { deviceFingerprint } from './fingerprint'

export interface OwnerCheck {
  origin: string
  ownerId: string
  hostId: string
  method: string
  trust: TrustState
  now?: number
}

/**
 * Verifies an owner-device command against the local trust anchor. The
 * service already checked it; this is the host's own, independent check.
 */
export function verifyOwnerCommand<T = Record<string, unknown>>(input: unknown, check: OwnerCheck): SignedCommand<T> {
  const signed = input as SignedCommand<T>
  const envelope = signed?.envelope as OwnerEnvelope | undefined
  if (!envelope || typeof envelope !== 'object' || !signed.payload || typeof signed.payload !== 'object' || Array.isArray(signed.payload))
    throw new VerifyError('Malformed owner signature.')
  const now = check.now ?? Date.now()
  if (envelope.v !== 1) throw new VerifyError('Unsupported signature version.')
  if (envelope.origin !== check.origin) throw new VerifyError('Signed for a different Douchat service.')
  if (envelope.ownerId !== check.ownerId) throw new VerifyError('Signed by a different owner.')
  if (envelope.hostId !== check.hostId) throw new VerifyError('Signed for a different host.')
  if (envelope.method !== check.method) throw new VerifyError('Signed for a different operation.')
  if (typeof envelope.requestId !== 'string' || envelope.requestId.length < 8 || envelope.requestId.length > 100) throw new VerifyError('Malformed owner signature.')
  if (!Number.isSafeInteger(envelope.issuedAt) || !Number.isSafeInteger(envelope.expiresAt)) throw new VerifyError('Malformed owner signature.')
  if (envelope.issuedAt > now + CLOCK_SKEW_MS || envelope.expiresAt <= now || envelope.expiresAt - envelope.issuedAt > MAX_LIFETIME_MS)
    throw new VerifyError('The owner signature expired. Check the clocks of both computers.')
  if (envelope.payloadHash !== sha256Hex(canonicalJson(signed.payload))) throw new VerifyError('Signed content does not match.')
  const device = check.trust.devices.find(item => item.deviceId === envelope.deviceId)
  if (!device) throw new VerifyError('Signed by a device this host does not trust.')
  if (!verifyEd25519(device.publicKey, ownerSignedBytes(envelope), signed.signature)) throw new VerifyError('Invalid owner signature.')
  return signed
}

/** verifyOwnerCommand plus single use: a replayed requestId is rejected. */
export function acceptOwnerCommand<T = Record<string, unknown>>(input: unknown, check: OwnerCheck, seen: SeenRequests): SignedCommand<T> {
  const signed = verifyOwnerCommand<T>(input, check)
  if (seen.has(signed.envelope.requestId)) throw new VerifyError('This request was already used.')
  seen.add(signed.envelope.requestId, signed.envelope.expiresAt)
  return signed
}

/**
 * Applies a newer device list only when a device the host already trusts
 * signed it (6.8.4). Returns the new list, or undefined when it is not newer
 * or cannot be verified.
 */
export function nextTrust(current: TrustState, distributed: unknown, check: Omit<OwnerCheck, 'method' | 'trust'>): TrustState | undefined {
  const value = distributed as { revision?: unknown; signed?: unknown } | null
  if (!value || typeof value.revision !== 'number' || value.revision <= current.revision || !value.signed) return undefined
  const signed = verifyOwnerCommand<{ revision?: unknown; devices?: unknown }>(value.signed, { ...check, method: 'host.devices', trust: current })
  const { revision, devices } = signed.payload
  if (revision !== value.revision || !Array.isArray(devices) || !devices.length || devices.length > 20) throw new VerifyError('Invalid device list.')
  const list = devices.map(item => {
    const device = item as { deviceId?: unknown; publicKey?: unknown }
    if (typeof device.deviceId !== 'string' || typeof device.publicKey !== 'string' || !KEY.test(device.publicKey)) throw new VerifyError('Invalid device list.')
    return { deviceId: device.deviceId, publicKey: device.publicKey }
  })
  return { revision, devices: list }
}
