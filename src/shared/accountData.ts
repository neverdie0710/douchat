import type { ChatMessage } from './types'
import type { UserMemoryDocument } from './userMemory'

/** Transport-neutral, account-bound data access. Identity comes from the host,
 * never from a user-supplied ownerId. A future HTTP adapter implements this API. */
export interface AccountDataApi {
  getGroupMemory(conversationId: string): Promise<UserMemoryDocument>
  saveGroupMemory(document: UserMemoryDocument, conversationId: string): Promise<UserMemoryDocument>
  getUserMemory(agentId?: string): Promise<UserMemoryDocument>
  saveUserMemory(document: UserMemoryDocument, agentId?: string): Promise<UserMemoryDocument>
  searchMessages(conversationId: string, query: string): Promise<ChatMessage[]>
  getMessagePage(conversationId: string, topicId: string, before?: string): Promise<{ messages: ChatMessage[]; hasMore: boolean }>
}

/** Runtime session binding, not an authentication token or a cloud tenant ID. */
export interface AccountContext {
  readonly ownerId: string
  readonly sessionId: string
}
