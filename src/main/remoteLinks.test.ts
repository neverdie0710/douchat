import { describe, expect, it } from 'vitest'
import { plainRemoteLinks } from './runtime'

describe('plainRemoteLinks', () => {
  it('turns local-file links from a remote agent into plain text', () => {
    expect(plainRemoteLinks('see [report](douchat-file:///etc/passwd) now')).toBe('see report now')
    expect(plainRemoteLinks('![x](file:///Users/me/.ssh/id_rsa)')).toBe('x')
    expect(plainRemoteLinks('<file:///tmp/a>')).toBe('/tmp/a')
    expect(plainRemoteLinks('open file:///tmp/a')).toBe('open /tmp/a')
    expect(plainRemoteLinks('[site](https://example.com)')).toBe('[site](https://example.com)')
  })
})
