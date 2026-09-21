import type { AppSnapshot, DesktopAuthUser } from '../../shared/types'

/**
 * The signed-in account owns the person's public identity. Runtime snapshots
 * retain local fields for offline prompts and migration, but UI surfaces must
 * never let that cache disagree with the account avatar shown in the app rail.
 */
export function withAccountIdentity(snapshot: AppSnapshot, user: DesktopAuthUser): AppSnapshot {
  const userName = user.name.trim() || snapshot.userName
  const userAvatar = user.image?.trim() || ''
  if (snapshot.userName === userName && snapshot.userAvatar === userAvatar) return snapshot
  return { ...snapshot, userName, userAvatar }
}
