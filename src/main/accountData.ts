import type { AccountContext, AccountDataApi } from '../shared/accountData'
import type { UserMemoryDocument } from '../shared/userMemory'
import type { DouchatStore } from './store'

/** Desktop adapter. Capture once per operation/turn; never silently follow a
 * later account switch. All checks live here as well as at the IPC boundary. */
export class LocalAccountData implements AccountDataApi {
  constructor(private readonly store: DouchatStore, readonly context: AccountContext = store.captureAccountContext()) {}

  private authorize(conversationId?: string): void {
    this.store.assertAccountContext(this.context)
    if (conversationId !== undefined && this.store.conversation(conversationId)?.ownerId !== this.context.ownerId) {
      throw new Error('Chat not found')
    }
  }

  async getUserMemory(agentId?: string) {
    this.authorize()
    return this.store.userMemories.read(agentId, this.context.ownerId)
  }
  async saveUserMemory(document: UserMemoryDocument, agentId?: string) {
    this.authorize()
    return this.store.userMemories.save(document, agentId, this.context.ownerId)
  }
  async getGroupMemory(conversationId: string) {
    this.authorize(conversationId)
    return this.store.groupMemories.read(conversationId, this.context.ownerId)
  }
  async saveGroupMemory(document: UserMemoryDocument, conversationId: string) {
    this.authorize(conversationId)
    return this.store.groupMemories.save(document, conversationId, this.context.ownerId)
  }
  async searchMessages(conversationId: string, query: string) {
    this.authorize(conversationId)
    return this.store.searchMessages(conversationId, query)
  }
  async getMessagePage(conversationId: string, topicId: string, before?: string) {
    this.authorize(conversationId)
    if (!this.store.conversation(conversationId)?.topics.some(topic => topic.id === topicId)) throw new Error('Topic not found')
    return this.store.messagePage(conversationId, topicId, before)
  }
}
