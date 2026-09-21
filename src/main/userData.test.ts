import { describe, expect, it } from 'vitest'
import { applicationName, userDataDirectoryName } from './userData'

describe('user data directory', () => {
  it('isolates an unpackaged development build', () => {
    expect(applicationName(true)).toBe('Douchat Dev')
    expect(userDataDirectoryName(true)).toBe('douchat-dev')
  })

  it('keeps packaged builds on the stable production directory', () => {
    expect(applicationName(false)).toBe('Douchat')
    expect(userDataDirectoryName(false)).toBe('douchat')
  })
})
