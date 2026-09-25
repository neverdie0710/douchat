import type { AgentConfig, Conversation } from './types'

type Member = Pick<AgentConfig, 'id' | 'ownerId' | 'localAgentId'>
type Target = Pick<Conversation, 'type' | 'agentIds' | 'ownerId' | 'remoteRoomId' | 'person' | 'socialRoom'>

/** A custom folder may only be used when every participant is one of the
 * owner's own local CLI agents. Cloud agents, other people and shared rooms
 * are excluded so nobody else can direct work inside the chosen folder. */
export function canAssignConversationWorkspace(conversation: Target | undefined, agents: readonly Member[], accountId = conversation?.ownerId): boolean {
  if (!conversation || !accountId || conversation.ownerId !== accountId) return false
  if (conversation.remoteRoomId || conversation.person || conversation.socialRoom) return false
  if (!conversation.agentIds.length || (conversation.type === 'direct' && conversation.agentIds.length !== 1)) return false
  return conversation.agentIds.every((id) => {
    const agent = agents.find((item) => item.id === id)
    return Boolean(agent?.localAgentId) && agent!.ownerId === accountId
  })
}
