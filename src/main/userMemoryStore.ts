import type { DatabaseSync } from 'node:sqlite'
import { emptyUserMemory, validateUserMemory, type UserMemoryDocument, type UserMemoryEdit } from '../shared/userMemory'

/** Documents are scoped to the signed-in user; the renderer never supplies a user ID. */
export class UserMemoryStore {
  constructor(private db: DatabaseSync, private currentUser: () => string, private agentOwner: (id: string) => string | undefined) {
    db.exec(`CREATE TABLE IF NOT EXISTS user_profiles (userId TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_user_memories (userId TEXT NOT NULL, agentId TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE, data TEXT NOT NULL, PRIMARY KEY (userId, agentId));`)
  }
  private authorize(agentId?: string, expectedUser = this.currentUser()): string {
    if (!expectedUser || this.currentUser() !== expectedUser) throw new Error('Account changed. Reopen memory settings.')
    if (agentId !== undefined && (!agentId || this.agentOwner(agentId) !== expectedUser)) throw new Error('Agent not found')
    return expectedUser
  }
  read(agentId?: string, expectedUser?: string): UserMemoryDocument {
    const userId = this.authorize(agentId, expectedUser)
    const row = (agentId
      ? this.db.prepare('SELECT data FROM agent_user_memories WHERE userId = ? AND agentId = ?').get(userId, agentId)
      : this.db.prepare('SELECT data FROM user_profiles WHERE userId = ?').get(userId)) as { data: string } | undefined
    return row ? { ...JSON.parse(row.data), userId, agentId } : emptyUserMemory(userId, agentId)
  }
  save(input: UserMemoryDocument, agentId?: string, expectedUser?: string): UserMemoryDocument {
    const userId = this.authorize(agentId, expectedUser)
    if (input?.userId !== userId || input.agentId !== agentId || input.groupId !== undefined) throw new Error('Account or memory scope changed. Reopen memory settings.')
    const document = validateUserMemory(input)
    const current = this.read(agentId, userId)
    if (document.revision !== current.revision) throw new Error('Memory changed. Reload before saving to avoid overwriting newer information.')
    const next = { ...document, revision: current.revision + 1, updatedAt: Date.now() }
    if (agentId) this.db.prepare('INSERT INTO agent_user_memories (userId, agentId, data) VALUES (?, ?, ?) ON CONFLICT(userId, agentId) DO UPDATE SET data = excluded.data').run(userId, agentId, JSON.stringify(next))
    else this.db.prepare('INSERT INTO user_profiles (userId, data) VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET data = excluded.data').run(userId, JSON.stringify(next))
    return next
  }
  remember(input: UserMemoryEdit, agentId: string, humanText: string, expectedUser: string): void {
    this.authorize(agentId, expectedUser)
    if (!input || !['shared', 'agent'].includes(input.scope) || !['remember', 'forget'].includes(input.action)
      || typeof input.key !== 'string' || !input.key.trim() || input.key.length > 100
      || typeof input.evidence !== 'string' || !input.evidence.trim() || input.evidence.length > 2000 || !humanText.includes(input.evidence)) throw new Error('Memory must be supported by the current human message')
    const shared = this.read(undefined, expectedUser), personal = this.read(agentId, expectedUser)
    if (!shared.autoRemember || !personal.autoRemember) throw new Error('Automatic memory is disabled')
    const document = input.scope === 'shared' ? shared : personal
    const facts = document.facts.filter(fact => fact.key !== input.key)
    if (input.action === 'remember') {
      if (typeof input.text !== 'string' || !input.text.trim()) throw new Error('Memory text is required')
      facts.push({ key: input.key, text: input.text, evidence: input.evidence, sourceAgentId: agentId })
    }
    this.save({ ...document, facts }, input.scope === 'agent' ? agentId : undefined, expectedUser)
  }
}
