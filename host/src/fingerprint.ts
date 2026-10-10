import { createHash } from 'node:crypto'

/** Must match `deviceFingerprint` in src/main/remote/daemonClient.ts. */
export function deviceFingerprint(publicKey: string): string {
  const hex = createHash('sha256').update(Buffer.from(publicKey, 'base64url')).digest('hex').slice(0, 16)
  return hex.match(/.{4}/g)!.join('-')
}
