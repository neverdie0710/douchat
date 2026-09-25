import { atomicProfileWrite, profileDirectory } from './profileFiles'
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { validateUserMemory, type UserMemoryDocument, type UserMemoryFact } from '../shared/userMemory'

const marker = '<!-- douchat-memory:'
const entryMarker = '<!-- douchat-entry:'
const json = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item).replace(/</g, '\\u003c')
const metadata = (value: unknown) => `${marker}${json(value)} -->`
type Section = 'profile' | 'memory'
export interface MemoryWriteOptions { retainRemovedKeys?: string[]; forgetKeys?: string[]; clearHistory?: boolean }
export interface MemoryHistoryEntry { key: string; text: string; timestamp: string; kind?: Section; evidence?: string; sourceAgentId?: string }

/** The combined representation is also used to compare database and file snapshots. */
export function memoryMarkdown(document: UserMemoryDocument, section?: Section): string {
  const { notes, facts, memoryNotes, clearHistory: _clearHistory, filePath: _file, memoryFilePath: _memory, historyDirectory: _history, ...header } = document
  const body = section === 'memory' ? memoryNotes ?? '' : notes
  const selected = (section ? facts.filter(f => (f.kind ?? 'memory') === section) : facts).map(f => ({ ...f, kind: f.kind ?? 'memory' })).sort((a, b) => a.key.localeCompare(b.key))
  if ([body, memoryNotes ?? '', ...selected.map(f => f.text)].some(text => text.includes(marker) || text.includes(entryMarker))) throw new Error('Memory text cannot contain reserved douchat-memory comments')
  return [
    section === 'memory' ? '# MEMORY.md' : '# USER.md',
    'Edit the text below; keep the douchat-memory comments intact.',
    metadata({ ...header, ...(!section && memoryNotes ? { memoryNotes } : {}), format: section ? 2 : 1, ...(section ? { section } : {}) }),
    body,
    ...selected.flatMap(({ text, ...fact }) => [metadata({ fact }), text]), ''
  ].join('\n\n')
}
export function parseMemoryMarkdown(text: string, userId: string, agentId?: string): UserMemoryDocument {
  if (text.length > 500_000) throw new Error('Memory file exceeds the size limit')
  const chunks = [...text.matchAll(/<!-- douchat-memory:(.*?) -->/g)]
  if (!chunks.length) throw new Error('Memory metadata is missing. Restore its douchat-memory comments.')
  const header = JSON.parse(chunks[0][1])
  if ((header.format === 2 && !['profile', 'memory'].includes(header.section)) || ![1, 2].includes(header.format) || header.userId !== userId || header.agentId !== agentId || header.groupId !== undefined) throw new Error('Memory account or agent does not match')
  const body = (index: number) => text.slice(chunks[index].index! + chunks[index][0].length, chunks[index + 1]?.index ?? text.length).trim()
  const document = validateUserMemory({ ...header, notes: body(0), facts: chunks.slice(1).map((chunk, index) => {
    const entry = JSON.parse(chunk[1])
    if (!entry.fact) throw new Error('Invalid memory fact metadata')
    return { ...entry.fact, ...(header.format === 2 ? { kind: header.section === 'profile' ? 'profile' : 'memory' } : {}), text: body(index + 1) }
  }) })
  return { ...document, updatedAt: typeof header.updatedAt === 'number' ? header.updatedAt : 0 }
}
function localDate(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
function historyMarkdown(entries: MemoryHistoryEntry[]): string {
  return ['# Memory history', 'Historical records may be superseded by current MEMORY.md and USER.md.', ...entries.flatMap(({ text, ...entry }) => [`${entryMarker}${json(entry)} -->`, text]), ''].join('\n\n')
}
function historyEntries(text: string): MemoryHistoryEntry[] {
  const chunks = [...text.matchAll(/<!-- douchat-entry:(.*?) -->/g)]
  return chunks.map((chunk, i) => {
    const entry = JSON.parse(chunk[1])
    if (typeof entry.key !== 'string' || typeof entry.timestamp !== 'string') throw new Error('Invalid memory history metadata')
    return { ...entry, text: text.slice(chunk.index! + chunk[0].length, chunks[i + 1]?.index ?? text.length).trim() }
  })
}

export class UserMemoryFiles {
  constructor(private root: string) {}
  private directory(userId: string, agentId?: string): string { return profileDirectory(this.root, userId, agentId) }
  path(userId: string, agentId?: string): string { return join(this.directory(userId, agentId), 'USER.md') }
  memoryPath(userId: string, agentId?: string): string { return join(this.directory(userId, agentId), 'MEMORY.md') }
  historyPath(userId: string, agentId?: string): string { return join(this.directory(userId, agentId), 'memory') }
  locations(userId: string, agentId?: string) { return { filePath: this.path(userId, agentId), memoryFilePath: this.memoryPath(userId, agentId), historyDirectory: this.historyPath(userId, agentId) } }
  hasLayout(userId: string, agentId?: string): boolean { return existsSync(this.memoryPath(userId, agentId)) }
  exists(userId: string, agentId?: string): boolean { return existsSync(this.path(userId, agentId)) }
  private recover(userId: string, agentId?: string): void {
    const directory = this.directory(userId, agentId), path = join(directory, '.pending-memory.json')
    if (!existsSync(path)) return
    const changes = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>
    if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.entries(changes).some(([name, content]) => !/^(?:USER\.md|MEMORY\.md|memory\/\d{4}-\d{2}-\d{2}\.md)$/.test(name) || typeof content !== 'string')) throw new Error('Invalid memory transaction')
    for (const [name, content] of Object.entries(changes)) atomicProfileWrite(join(directory, name), content)
    rmSync(path)
  }
  read(userId: string, agentId?: string): UserMemoryDocument | undefined {
    this.recover(userId, agentId)
    let text: string
    try { text = readFileSync(this.path(userId, agentId), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    const profile = parseMemoryMarkdown(text, userId, agentId)
    if (!/"format":2/.test(text.split('\n').find(line => line.startsWith(marker)) ?? '')) {
      // Old facts were unclassified. Preserve them as memories rather than guessing a user profile.
      this.write(profile)
      return profile
    }
    const memoryText = readFileSync(this.memoryPath(userId, agentId), 'utf8')
    if (!text.includes('\"section\":\"profile\"') || !memoryText.includes('\"section\":\"memory\"')) throw new Error('Memory file sections do not match their filenames')
    const memory = parseMemoryMarkdown(memoryText, userId, agentId)
    const merged = validateUserMemory({ ...profile, ...(memory.notes ? { memoryNotes: memory.notes } : {}), facts: [...profile.facts, ...memory.facts], revision: Math.max(profile.revision, memory.revision) })
    return { ...merged, updatedAt: Math.max(profile.updatedAt, memory.updatedAt) }
  }
  dates(userId: string, agentId?: string): string[] {
    const directory = this.historyPath(userId, agentId)
    return existsSync(directory) ? readdirSync(directory).filter(name => /^\d{4}-\d{2}-\d{2}\.md$/.test(name)).sort().reverse() : []
  }
  entries(userId: string, agentId: string | undefined, date: string): MemoryHistoryEntry[] {
    if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(date)) throw new Error('Invalid memory date')
    const path = join(this.historyPath(userId, agentId), date)
    if (statSync(path).size > 4_000_000) throw new Error('Memory history file is too large')
    return historyEntries(readFileSync(path, 'utf8'))
  }
  write(document: UserMemoryDocument, previous?: UserMemoryDocument, options: MemoryWriteOptions = {}): void {
    const { userId, agentId } = document
    this.recover(userId, agentId)
    const changes: Record<string, string> = {
      'USER.md': memoryMarkdown(document, 'profile'),
      'MEMORY.md': memoryMarkdown(document, 'memory')
    }
    const retained = new Set(options.retainRemovedKeys ?? [])
    const removed = new Set([...(options.forgetKeys ?? []), ...(previous?.facts ?? []).filter(old => !document.facts.some(f => f.key === old.key) && !retained.has(old.key)).map(f => f.key)])
    if (previous?.notes && !document.notes) removed.add('__profile_notes')
    if (previous?.memoryNotes && !document.memoryNotes) removed.add('__memory_notes')
    const now = new Date(), date = `${localDate(now)}.md`
    const updated: MemoryHistoryEntry[] = document.facts.filter(f => {
      const old = previous?.facts.find(item => item.key === f.key)
      return !old || old.text !== f.text || (old.kind ?? 'memory') !== (f.kind ?? 'memory')
    }).map(f => ({ ...f, timestamp: now.toISOString() }))
    for (const [key, content, old, kind] of [
      ['__profile_notes', document.notes, previous?.notes, 'profile'],
      ['__memory_notes', document.memoryNotes, previous?.memoryNotes, 'memory']
    ] as const) if (content && content !== old) updated.push({ key, text: content, kind, timestamp: now.toISOString() })
    const dates = this.dates(userId, agentId)
    if (updated.length && !dates.includes(date)) dates.push(date)
    for (const day of dates) {
      if (!options.clearHistory && !removed.size && day !== date) continue
      const old = this.datesExists(userId, agentId, day) ? this.entries(userId, agentId, day) : []
      const entries = options.clearHistory ? [] : old.filter(entry => !removed.has(entry.key))
      if (day === date) entries.push(...updated)
      if (entries.length !== old.length || day === date || options.clearHistory) changes[`memory/${day}`] = historyMarkdown(entries)
    }
    atomicProfileWrite(join(this.directory(userId, agentId), '.pending-memory.json'), JSON.stringify(changes))
    this.recover(userId, agentId)
  }
  private datesExists(userId: string, agentId: string | undefined, date: string): boolean { return existsSync(join(this.historyPath(userId, agentId), date)) }
  remove(userId: string, agentId: string): void {
    for (const path of [this.path(userId, agentId), this.memoryPath(userId, agentId), this.historyPath(userId, agentId), join(this.directory(userId, agentId), '.pending-memory.json')]) rmSync(path, { force: true, recursive: true })
  }
}
