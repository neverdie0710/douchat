import { describe, expect, it } from 'vitest'
import { CONTROL_TEMP_SUFFIX, UNIX_SOCKET_PATH_MAX, controlFingerprint, controlSocketPath } from './remoteTransport'

const resolved = (overrides: Record<string, string> = {}): string => Object.entries({
  user: 'root', hostname: '203.0.113.10', port: '22', proxyjump: 'none', ...overrides
}).map(([key, value]) => `${key} ${value}`).join('\n')

describe('controlFingerprint', () => {
  it('is 16 hex characters and stable for the same target', () => {
    const name = controlFingerprint(resolved())
    expect(name).toMatch(/^[0-9a-f]{16}$/)
    expect(controlFingerprint(resolved())).toBe(name)
  })

  it('changes when the effective user, host, port or jump host changes', () => {
    const base = controlFingerprint(resolved())
    for (const change of <Record<string, string>[]>[{ user: 'ubuntu' }, { hostname: '10.0.0.1' }, { port: '2222' }, { proxyjump: 'bastion' }, { proxycommand: 'nc %h %p' }]) {
      expect(controlFingerprint(resolved(change))).not.toBe(base)
    }
  })

  it('uses the first value like ssh and refuses incomplete output', () => {
    expect(controlFingerprint(`${resolved()}\nuser other`)).toBe(controlFingerprint(resolved()))
    expect(controlFingerprint('hostname a\nport 22')).toBeUndefined()
    expect(controlFingerprint(resolved({ port: '22; rm -rf /' }))).toBeUndefined()
  })
})

describe('controlSocketPath', () => {
  const name = 'a'.repeat(16)

  it('fits the macOS limit together with the temporary listener suffix', () => {
    const user = 'firstname.lastname-x'
    const directory = `/Users/${user}/Library/Application Support/douchat/ssh`
    const path = controlSocketPath(directory, name)
    expect(path).toBe(`${directory}/${name}`)
    expect(Buffer.byteLength(path!) + CONTROL_TEMP_SUFFIX).toBeLessThanOrEqual(UNIX_SOCKET_PATH_MAX)
  })

  it('covers the path from the reported error', () => {
    const path = controlSocketPath('/Users/example/Library/Application Support/douchat/ssh', name)!
    expect(Buffer.byteLength(`${path}.kQauDNYzQILmMy52`)).toBeLessThanOrEqual(UNIX_SOCKET_PATH_MAX)
  })

  it('disables multiplexing instead of failing when the directory is too long', () => {
    expect(controlSocketPath(`/Users/${'x'.repeat(60)}/Library/Application Support/douchat/ssh`, name)).toBeUndefined()
  })

  it('rejects names and directories that ssh would reinterpret', () => {
    expect(controlSocketPath('/tmp/c', '../../etc/passwd')).toBeUndefined()
    expect(controlSocketPath('/tmp/c', 'A'.repeat(16))).toBeUndefined()
    for (const directory of ['relative/ssh', '~/ssh', '/tmp/%h', '/tmp/"x', '/tmp/a\\b', '/tmp/a\nb']) {
      expect(controlSocketPath(directory, name)).toBeUndefined()
    }
  })
})
