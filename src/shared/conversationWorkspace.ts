import type { AgentConfig, Conversation } from './types'

type Member = Pick<AgentConfig, 'id' | 'ownerId'>
type Target = Pick<Conversation, 'type' | 'agentIds' | 'ownerId' | 'remoteRoomId' | 'person' | 'socialRoom'>

/** Workspaces are available only to the owner's agents in private, unshared chats. */
export function canAssignConversationWorkspace(conversation: Target | undefined, agents: readonly Member[], accountId = conversation?.ownerId): boolean {
  if (!conversation || !accountId || conversation.ownerId !== accountId) return false
  if (conversation.remoteRoomId || conversation.person || conversation.socialRoom) return false
  if (!conversation.agentIds.length || (conversation.type === 'direct' && conversation.agentIds.length !== 1)) return false
  return conversation.agentIds.every((id) => {
    const agent = agents.find((item) => item.id === id)
    return agent?.ownerId === accountId
  })
}
