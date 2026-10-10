import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareVersions, isLocalBase, parseManifest, ReleaseError } from '../../../host/src/release'

const root = join(__dirname, '..', '..', '..')
const installScript = readFileSync(join(root, 'host', 'install.sh'), 'utf8')

describe('douchat-host release', () => {
  it('pins sha256 for every Node.js archive install.sh may download', () => {
    const version = /NODE_VERSION="(v[0-9.]+)"/.exec(installScript)?.[1]
    for (const target of ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'])
      expect(installScript).toMatch(new RegExp(`node-${version!.replace(/\./g, '\\.')}-${target}\\) echo [0-9a-f]{64} ;;`))
  })

  it('accepts only well-formed manifests', () => {
    const good = { version: '1.2.3', sha256: 'a'.repeat(64), installSha256: 'b'.repeat(64), minNode: 20, builtAt: 'now' }
    expect(parseManifest(Buffer.from(JSON.stringify(good))).version).toBe('1.2.3')
    expect(() => parseManifest(Buffer.from('nope'))).toThrow(ReleaseError)
    expect(() => parseManifest(Buffer.from(JSON.stringify({ ...good, version: '../1' })))).toThrow(ReleaseError)
    expect(() => parseManifest(Buffer.from(JSON.stringify({ ...good, sha256: 'x' })))).toThrow(ReleaseError)
  })

  it('orders versions and recognises local test services', () => {
    expect(compareVersions('0.1.1', '0.1.0')).toBeGreaterThan(0)
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0)
    expect(isLocalBase('http://localhost:3000/host')).toBe(true)
    expect(isLocalBase('http://127.0.0.1/host')).toBe(true)
    expect(isLocalBase('https://localhost/host')).toBe(false)
    expect(isLocalBase('http://localhost.evil.com/host')).toBe(false)
    expect(isLocalBase('https://cdn.douchat.ai/host')).toBe(false)
  })
})
