import { describe, expect, it } from 'vitest'
import type { AppSnapshot, DesktopAuthUser } from '../../shared/types'
import { withAccountIdentity } from './accountIdentity'

describe('account identity presentation', () => {
  const snapshot = {
    userName: 'Local name',
    userAvatar: 'data:image/png;base64,stale'
  } as AppSnapshot

  it('uses the signed-in account identity on every UI snapshot', () => {
    const user: DesktopAuthUser = {
      id: 'user-1',
      name: 'Dobi',
      email: 'dobi@example.com',
      image: 'https://douchat.ai/avatar.png'
    }

    expect(withAccountIdentity(snapshot, user)).toMatchObject({
      userName: 'Dobi',
      userAvatar: 'https://douchat.ai/avatar.png'
    })
  })

  it('clears a stale local avatar when the account picture was removed', () => {
    const user: DesktopAuthUser = {
      id: 'user-1',
      name: 'Dobi',
      email: 'dobi@example.com'
    }

    expect(withAccountIdentity(snapshot, user).userAvatar).toBe('')
  })
})
