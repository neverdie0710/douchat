import { describe, expect, it } from 'vitest'
import { userDataDirectoryName } from './userData'

describe('user data directory', () => {
  it('isolates an unpackaged development build', () => {
    expect(userDataDirectoryName(true)).toBe('douchat-dev')
  })

  it('keeps packaged builds on the stable production directory', () => {
    expect(userDataDirectoryName(false)).toBe('douchat')
  })
})
