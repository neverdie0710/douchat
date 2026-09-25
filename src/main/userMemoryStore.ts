import { UserMemoryFiles, memoryMarkdown, type MemoryWriteOptions } from './userMemoryFile'
import type { DatabaseSync } from 'node:sqlite'
import { emptyUserMemory, validateUserMemory, type UserMemoryDocument, type UserMemoryEdit, type MemorySearchHit } from '../shared/userMemory'

/** Documents are scoped to the signed-in user; the renderer never supplies a user ID. */
export class UserMemoryStore {
  private files?: UserMemoryFiles
  constructor(private db: DatabaseSync, private currentUser: () => string, private agentOwner: (id: string) => string | undefined, directory?: string, legacyDirectory?: string) {
    db.exec(`CREATE TABLE IF NOT EXISTS user_profiles (userId TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_user_memories (userId TEXT NOT NULL, agentId TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE, data TEXT NOT NULL, PRIMARY KEY (userId, agentId));`)
    if (directory) {
      this.files = new UserMemoryFiles(directory)
      const legacy = legacyDirectory ? new UserMemoryFiles(legacyDirectory) : undefined
      for (const table of ['user_profiles', 'agent_user_memories']) {
        for (const row of db.prepare(`SELECT * FROM ${table}`).all() as { userId: string; agentId?: string; data: string }[]) {
          if (!this.files.exists(row.userId, row.agentId)) this.files.write((this.files.hasLayout(row.userId, row.agentId) ? undefined : legacy?.read(row.userId, row.agentId)) ?? { ...JSON.parse(row.data), userId: row.userId, agentId: row.agentId })
        }
      }
    }
  }
  private put(document: UserMemoryDocument): void {
    if (document.agentId) this.db.prepare('INSERT INTO agent_user_memories (userId, agentId, data) VALUES (?, ?, ?) ON CONFLICT(userId, agentId) DO UPDATE SET data = excluded.data').run(document.userId, document.agentId, JSON.stringify(document))
    else this.db.prepare('INSERT INTO user_profiles (userId, data) VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET data = excluded.data').run(document.userId, JSON.stringify(document))
  }
  removeAgent(agentId: string): void {
    const userId = this.authorize(agentId)
    this.files?.remove(userId, agentId)
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
    let document: UserMemoryDocument = row ? { ...JSON.parse(row.data), userId, agentId } : emptyUserMemory(userId, agentId)
    if (this.files) {
      const saved = this.files.read(userId, agentId)
      if (saved && memoryMarkdown(saved) !== memoryMarkdown(document)) {
        // A newer file revision already committed its history batch before a DB interruption.
        // Only external edits at the same/older revision need a new history transaction.
        const committed = saved.revision > document.revision
        const previous = document
        document = committed ? saved : { ...saved, revision: document.revision + 1, updatedAt: Date.now() }
        if (!committed) this.files.write(document, previous)
        this.put(document)
      } else if (!saved) this.files.write(document)
      return { ...document, ...this.files.locations(userId, agentId) }
    }
    return document
  }
  save(input: UserMemoryDocument, agentId?: string, expectedUser?: string, options: MemoryWriteOptions = {}): UserMemoryDocument {
    const userId = this.authorize(agentId, expectedUser)
    if (input?.userId !== userId || input.agentId !== agentId || input.groupId !== undefined) throw new Error('Account or memory scope changed. Reopen memory settings.')
    const document = validateUserMemory(input)
    const current = this.read(agentId, userId)
    if (document.revision !== current.revision) throw new Error('Memory changed. Reload before saving to avoid overwriting newer information.')
    const next = { ...document, revision: current.revision + 1, updatedAt: Date.now() }
    this.files?.write(next, current, { ...options, clearHistory: options.clearHistory || input.clearHistory === true })
    this.put(next)
    return this.files ? { ...next, ...this.files.locations(userId, agentId) } : next
  }

  search(query: string, agentId: string, expectedUser?: string): { hits: MemorySearchHit[]; truncated: boolean } {
    const userId = this.authorize(agentId, expectedUser)
    if (typeof query !== 'string' || !query.trim() || query.length > 500) throw new Error('Search requires 1–500 characters')
    const words = [...new Set([...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(query.normalize('NFKC').toLowerCase())].filter(part => part.isWordLike).map(part => part.segment))]
    const results: (MemorySearchHit & { score: number })[] = []
    let truncated = false
    for (const id of [undefined, agentId]) {
      const scope = id ? 'agent' : 'shared'
      const current = this.read(id, userId)
      const add = (key: string, text: string, path: string, timestamp: string, historical: boolean) => {
        if (!text.trim()) return
        const normalized = `${key} ${path} ${timestamp} ${text}`.normalize('NFKC').toLowerCase()
        const score = words.filter(word => normalized.includes(word)).length
        if (!score) return
        const body = text.normalize('NFKC').toLowerCase()
        const at = Math.max(0, body.indexOf(words.find(word => body.includes(word)) ?? '') - 150)
        results.push({ scope, key, text: text.slice(at, at + 1000), path, timestamp, historical, score })
      }
      for (const fact of current.facts) add(fact.key, fact.text, fact.kind === 'profile' ? 'USER.md' : 'MEMORY.md', new Date(current.updatedAt).toISOString(), false)
      add('__profile_notes', current.notes, 'USER.md', '', false)
      add('__memory_notes', current.memoryNotes ?? '', 'MEMORY.md', '', false)
      const dates = this.files?.dates(userId, id) ?? []
      truncated ||= dates.length > 5000
      for (const date of dates.slice(0, 5000)) {
        for (const entry of this.files!.entries(userId, id, date)) {
          if (current.facts.some(f => f.key === entry.key && f.text === entry.text)) continue
          add(entry.key, entry.text, `memory/${date}`, entry.timestamp, true)
        }
      }
    }
    results.sort((a, b) => b.score - a.score || Number(a.historical) - Number(b.historical) || b.timestamp.localeCompare(a.timestamp))
    return { hits: results.slice(0, 8).map(({ score: _score, ...hit }) => hit), truncated: truncated || results.length > 8 }
  }

  readHistory(scope: 'shared' | 'agent', date: string, agentId: string, offset = 0, expectedUser?: string): { text: string; nextOffset?: number } {
    const userId = this.authorize(agentId, expectedUser)
    if (!['shared', 'agent'].includes(scope) || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid memory history request')
    this.read(scope === 'agent' ? agentId : undefined, userId)
    const entries = this.files?.entries(userId, scope === 'agent' ? agentId : undefined, date) ?? []
    const text = entries.map(entry => `${entry.timestamp} [${entry.key}]\n${entry.text}`).join('\n\n')
    return { text: text.slice(offset, offset + 8000), ...(text.length > offset + 8000 ? { nextOffset: offset + 8000 } : {}) }
  }

  remember(input: UserMemoryEdit, agentId: string, humanText: string, expectedUser: string): void {
    this.authorize(agentId, expectedUser)
    if (!input || !['shared', 'agent'].includes(input.scope) || !['remember', 'forget'].includes(input.action)
      || typeof input.key !== 'string' || !input.key.trim() || input.key.length > 100
      || typeof input.evidence !== 'string' || !input.evidence.trim() || input.evidence.length > 2000 || !humanText.includes(input.evidence)) throw new Error('Memory must be supported by the current human message')
    if (input.kind !== undefined && !['profile', 'memory'].includes(input.kind)) throw new Error('Invalid memory kind')
    if (input.scope === 'shared' && input.action === 'remember' && input.shareWithAll !== true) throw new Error('Shared memory requires an explicit request to share with other agents')
    const shared = this.read(undefined, expectedUser), personal = this.read(agentId, expectedUser)
    if (!shared.autoRemember || !personal.autoRemember) throw new Error('Automatic memory is disabled')
    const document = input.scope === 'shared' ? shared : personal
    const facts = document.facts.filter(fact => fact.key !== input.key)
    if (input.action === 'remember') {
      if (input.key.startsWith('__')) throw new Error('Reserved memory key')
      if (typeof input.text !== 'string' || !input.text.trim()) throw new Error('Memory text is required')
      facts.push({ key: input.key, text: input.text, kind: input.kind ?? 'memory', savedAt: Date.now(), evidence: input.evidence, sourceAgentId: agentId })
    }
    // Retain a bounded current summary; evicted memory remains searchable by date.
    if (input.action === 'forget' && input.key === '__profile_notes') document.notes = ''
    if (input.action === 'forget' && input.key === '__memory_notes') document.memoryNotes = ''
    const archived: string[] = []
    const size = () => document.notes.length + (document.memoryNotes?.length ?? 0) + facts.reduce((total, fact) => total + fact.text.length, 0)
    while (facts.length > 100 || size() > 20000) {
      const oldest = facts.filter(fact => fact.key !== input.key && fact.kind !== 'profile').sort((a, b) => (a.savedAt ?? 0) - (b.savedAt ?? 0))[0]
      const index = oldest ? facts.indexOf(oldest) : -1
      if (index < 0) throw new Error('User profile is full; consolidate existing profile facts first')
      archived.push(facts.splice(index, 1)[0].key)
    }
    this.save({ ...document, facts }, input.scope === 'agent' ? agentId : undefined, expectedUser, {
      retainRemovedKeys: archived, forgetKeys: input.action === 'forget' ? [input.key] : undefined
    })
  }
}
