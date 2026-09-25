import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Conversation } from '../shared/types'
import { emptyUserMemory, validateUserMemory, type UserMemoryDocument, type UserMemoryEdit } from '../shared/userMemory'

/** Group memory is local to an account, shared by its agents, and never a private user profile. */
export class GroupMemoryStore {
  constructor(private db: DatabaseSync, private currentUser: () => string, private conversation: (id: string) => Conversation | undefined, private agentOwner: (id: string) => string | undefined) {
    db.exec('CREATE TABLE IF NOT EXISTS group_memories (userId TEXT NOT NULL, groupId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, data TEXT NOT NULL, PRIMARY KEY (userId, groupId))')
  }
  private authorize(groupId: string, expectedUser = this.currentUser()): string {
    if (!expectedUser || this.currentUser() !== expectedUser) throw new Error('Account changed. Reopen memory settings.')
    const group = this.conversation(groupId)
    if (!group || group.type !== 'group' || group.ownerId !== expectedUser) throw new Error('Group not found')
    return expectedUser
  }
  private audience(groupId: string): string {
    const group = this.conversation(groupId)!
    return !group.remoteRoomId && !group.socialRoom && !group.person && group.agentIds.every(id => this.agentOwner(id) === group.ownerId)
      ? 'internal' : `external:${group.remoteRoomId ?? group.socialRoom?.id ?? groupId}`
  }
  read(groupId: string, expectedUser?: string): UserMemoryDocument {
    const userId = this.authorize(groupId, expectedUser)
    const row = this.db.prepare('SELECT data FROM group_memories WHERE userId = ? AND groupId = ?').get(userId, groupId) as { data: string } | undefined
    const saved = row ? JSON.parse(row.data) : undefined
    // Linking an internal group to a shared room must not publish its old memory.
    const audience = this.audience(groupId)
    const document = saved?.audiences?.[audience] ?? (saved && !saved.audiences && audience === 'internal' ? saved : emptyUserMemory(userId))
    return { ...document, userId, groupId, agentId: undefined, audienceId: audience }
  }
  save(input: UserMemoryDocument, groupId: string, expectedUser?: string): UserMemoryDocument {
    const userId = this.authorize(groupId, expectedUser)
    if (input?.userId !== userId || input.groupId !== groupId || input.agentId !== undefined) throw new Error('Account or memory scope changed. Reopen memory settings.')
    if (input.audienceId !== this.audience(groupId)) throw new Error('Group audience changed. Reopen memory settings.')
    const document = validateUserMemory(input), current = this.read(groupId, userId)
    if (document.revision !== current.revision) throw new Error('Memory changed. Reload before saving to avoid overwriting newer information.')
    const next = { ...document, audienceId: this.audience(groupId), revision: current.revision + 1, updatedAt: Date.now() }
    const row = this.db.prepare('SELECT data FROM group_memories WHERE userId = ? AND groupId = ?').get(userId, groupId) as { data: string } | undefined
    const saved = row ? JSON.parse(row.data) : undefined
    const audiences = saved?.audiences ?? (saved ? { internal: saved } : {})
    this.db.prepare('INSERT INTO group_memories (userId, groupId, data) VALUES (?, ?, ?) ON CONFLICT(userId, groupId) DO UPDATE SET data = excluded.data').run(userId, groupId, JSON.stringify({ audiences: { ...audiences, [this.audience(groupId)]: next } }))
    return next
  }
  remember(input: UserMemoryEdit, groupId: string, agentId: string, speaker: { id: string; name: string }, humanText: string, expectedUser: string): void {
    this.authorize(groupId, expectedUser)
    if (this.agentOwner(agentId) !== expectedUser) throw new Error('Agent not found')
    if (!speaker.id || !input || input.scope !== 'group' || !['remember', 'forget'].includes(input.action)
      || typeof input.key !== 'string' || !input.key.trim() || input.key.length > 100
      || typeof input.evidence !== 'string' || !input.evidence.trim() || input.evidence.length > 2000 || !humanText.includes(input.evidence)) throw new Error('Group memory must be supported by the current human message')
    const document = this.read(groupId, expectedUser)
    if (!document.autoRemember) throw new Error('Automatic group memory is disabled')
    // The model never selects a user ID. Identical keys from different speakers cannot collide.
    const key = createHash('sha256').update(JSON.stringify([speaker.id, input.key])).digest('hex')
    const facts = document.facts.filter(fact => fact.key !== key)
    if (input.action === 'remember') {
      if (typeof input.text !== 'string' || !input.text.trim()) throw new Error('Memory text is required')
      facts.push({ key, memoryKey: input.key, text: input.text, evidence: input.evidence, sourceAgentId: agentId, subjectId: speaker.id, subjectName: speaker.name })
    }
    this.save({ ...document, facts }, groupId, expectedUser)
  }
}
