import { createHash } from 'node:crypto'

/**
 * douchat-host release layout (remote-connections.md 11):
 *   <base>/latest.txt            newest version, never cached
 *   <base>/install.sh            installer for the newest version
 *   <base>/<version>/            immutable: install.sh, douchat-host.mjs, manifest.json
 * Downloads are checked against the sha256 in the version's manifest.
 */
export interface ReleaseManifest {
  version: string
  /** sha256 of douchat-host.mjs */
  sha256: string
  /** sha256 of install.sh */
  installSha256: string
  minNode: number
  builtAt: string
}

const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$/
const HEX = /^[0-9a-f]{64}$/

export class ReleaseError extends Error {}

export const sha256Hex = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex')

export function parseManifest(bytes: Buffer): ReleaseManifest {
  let value: Partial<ReleaseManifest>
  try { value = JSON.parse(bytes.toString('utf8')) } catch { throw new ReleaseError('The release manifest is invalid.') }
  if (!value || typeof value.version !== 'string' || !VERSION.test(value.version) || typeof value.sha256 !== 'string' || !HEX.test(value.sha256)
    || typeof value.installSha256 !== 'string' || !HEX.test(value.installSha256))
    throw new ReleaseError('The release manifest is invalid.')
  return { version: value.version, sha256: value.sha256, installSha256: value.installSha256, minNode: Number(value.minNode) || 20, builtAt: String(value.builtAt ?? '') }
}

/** Local test services may use plain http://localhost; everything else must be HTTPS. */
export function isLocalBase(base: string): boolean {
  try {
    const url = new URL(base)
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch { return false }
}

/** Numeric x.y.z comparison; a pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => { const [core, pre] = v.split('-', 2); return { parts: core.split('.').map(Number), pre } }
  const x = split(a), y = split(b)
  for (let i = 0; i < 3; i++) if (x.parts[i] !== y.parts[i]) return x.parts[i] - y.parts[i]
  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre < y.pre ? -1 : 1
}
