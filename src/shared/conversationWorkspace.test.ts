import { describe, expect, it } from 'vitest'
import { canAssignConversationWorkspace } from './conversationWorkspace'
import type { AgentConfig, Conversation } from './types'

const agents = [
  { id: 'codex', ownerId: 'me', localAgentId: 'codex' },
  { id: 'claude', ownerId: 'me', localAgentId: 'claude' },
  { id: 'cloud', ownerId: 'me' },
  { id: 'theirs', ownerId: 'bob', localAgentId: 'codex' }
] as AgentConfig[]
const chat = (input: Partial<Conversation>): Conversation => ({ id: 'c', type: 'group', name: 'c', agentIds: [], topics: [], activeTopicId: '', unread: 0, readAt: 0, createdAt: 0, updatedAt: 0, ownerId: 'me', ...input })

describe('canAssignConversationWorkspace', () => {
  it('allows a direct chat or group made only of my agents', () => {
    expect(canAssignConversationWorkspace(chat({ type: 'direct', agentIds: ['codex'] }), agents)).toBe(true)
    expect(canAssignConversationWorkspace(chat({ agentIds: ['codex', 'claude'] }), agents)).toBe(true)
    expect(canAssignConversationWorkspace(chat({ type: 'direct', agentIds: ['cloud'] }), agents)).toBe(true)
    expect(canAssignConversationWorkspace(chat({ agentIds: ['codex', 'cloud'] }), agents)).toBe(true)
  })
  it('rejects other owners, people, shared rooms and foreign chats', () => {
    expect(canAssignConversationWorkspace(chat({ agentIds: ['codex', 'theirs'] }), agents)).toBe(false)
    expect(canAssignConversationWorkspace(chat({ agentIds: ['codex', 'missing'] }), agents)).toBe(false)
    expect(canAssignConversationWorkspace(chat({ agentIds: [] }), agents)).toBe(false)
    expect(canAssignConversationWorkspace(chat({ agentIds: ['codex'], remoteRoomId: 'room' }), agents)).toBe(false)
    expect(canAssignConversationWorkspace(chat({ type: 'direct', agentIds: [], person: { id: 'bob', name: 'Bob', email: 'b@x' } }), agents)).toBe(false)
    expect(canAssignConversationWorkspace(chat({ agentIds: ['codex'] }), agents, 'someone-else')).toBe(false)
    expect(canAssignConversationWorkspace(undefined, agents)).toBe(false)
  })
})
