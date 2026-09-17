export interface ConversationActivity {
  createdAt: number
  updatedAt: number
  pinned?: boolean
  sortOrder?: number
}

/** Identity/settings edits must not move a conversation ahead of a newer reply. */
/** Running conversations lead the section; idle conversations follow newest-first. */
export function compareConversationActivity(
  left: ConversationActivity,
  right: ConversationActivity,
  leftWorking: boolean,
  rightWorking: boolean,
  lastMessageAt: (conversation: ConversationActivity) => number
): number {
  if (leftWorking !== rightWorking) return leftWorking ? -1 : 1
  return lastMessageAt(right) - lastMessageAt(left)
}

/** Manual order applies only inside the same visual section. Conversations
 * without a manual position retain the caller's recency order. */
export function compareConversationOrganization(left: ConversationActivity, right: ConversationActivity): number {
  const leftOrder = left.sortOrder
  const rightOrder = right.sortOrder
  if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder
  if (leftOrder !== undefined) return -1
  if (rightOrder !== undefined) return 1
  return 0
}
