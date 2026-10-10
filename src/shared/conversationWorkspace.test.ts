import { describe, expect, it } from 'vitest'
import { canAssignAgentWorkspace, canAssignConversationWorkspace, memberWorkspace, ownMemberAgentIds } from './conversationWorkspace'
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

describe('memberWorkspace', () => {
  const local = { executionTargetId: 'local:dev-a', targetRevision: 0, location: 'local' as const }
  const server = { executionTargetId: 'ssh-legacy:abc', targetRevision: 2, location: 'remote' as const }
  it('uses a folder only on the target and revision it was chosen on', () => {
    const conversation = chat({ type: 'direct', agentIds: ['codex'], agentWorkspaces: { codex: { path: '/srv/p', executionTargetId: 'ssh-legacy:abc', targetRevision: 2 } } })
    expect(memberWorkspace(conversation, agents[0], server, agents).binding?.path).toBe('/srv/p')
    const edited = memberWorkspace(conversation, agents[0], { ...server, targetRevision: 3 }, agents)
    expect(edited.binding).toBeUndefined()
    expect(edited).toMatchObject({ eligible: true, stale: { path: '/srv/p' } })
    expect(memberWorkspace(conversation, agents[0], { ...server, executionTargetId: 'ssh-legacy:other' }, agents).binding).toBeUndefined()
    expect(memberWorkspace(conversation, agents[0], local, agents).binding).toBeUndefined()
  })
  it('falls back to the legacy chat folder for local members only', () => {
    const conversation = chat({ agentIds: ['codex', 'claude'], workspacePath: '/Users/me/p' })
    expect(memberWorkspace(conversation, agents[0], local, agents).legacyPath).toBe('/Users/me/p')
    expect(memberWorkspace(conversation, agents[0], server, agents).legacyPath).toBeUndefined()
    // A remote-saved folder never hides the legacy folder from a local member, and the other way round.
    const both = chat({ agentIds: ['codex'], workspacePath: '/Users/me/p', agentWorkspaces: { codex: { path: '/srv/p', executionTargetId: 'ssh-legacy:abc', targetRevision: 2 } } })
    expect(memberWorkspace(both, agents[0], local, agents)).toMatchObject({ legacyPath: '/Users/me/p', stale: { path: '/srv/p' } })
  })
  it('allows the owner to set their own agents in shared rooms, never others', () => {
    const room = { id: 'r', name: 'R', kind: 'group' as const, members: [], createdAt: '', agents: [
      { id: 'server-1', localId: 'codex', ownerId: 'me', name: 'Codex' }, { id: 'server-2', localId: 'theirs', ownerId: 'bob', name: 'Bob agent' }] }
    const shared = chat({ agentIds: ['server-1', 'server-2'], remoteRoomId: 'r', socialRoom: room })
    expect(ownMemberAgentIds(shared)).toEqual(['codex'])
    expect(canAssignAgentWorkspace(shared, agents[0])).toBe(true)
    expect(canAssignAgentWorkspace(shared, agents[3])).toBe(false)
    expect(canAssignAgentWorkspace(shared, agents[0], 'someone-else')).toBe(false)
    // The legacy chat-wide folder never applies in a shared room.
    expect(memberWorkspace({ ...shared, workspacePath: '/Users/me/p' }, agents[0], local, agents).legacyPath).toBeUndefined()
    expect(canAssignAgentWorkspace(chat({ type: 'direct', agentIds: [], person: { id: 'bob', name: 'Bob', email: 'b@x' } }), agents[0])).toBe(false)
  })
})
