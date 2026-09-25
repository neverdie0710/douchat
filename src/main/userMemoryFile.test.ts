import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { UserMemoryStore } from './userMemoryStore'
import { UserMemoryFiles } from './userMemoryFile'
import { emptyUserMemory } from '../shared/userMemory'

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach(dispose => dispose()))
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'douchat-memory-file-'))
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE agents (id TEXT PRIMARY KEY); INSERT INTO agents VALUES (\'reader\')')
  cleanup.push(() => { db.close(); rmSync(directory, { recursive: true, force: true }) })
  return { directory, db }
}
it('migrates existing database memory, reads Markdown edits, and detects stale UI saves', () => {
  const { directory, db } = setup()
  const legacy = new UserMemoryStore(db, () => 'owner', () => 'owner')
  legacy.save({ ...emptyUserMemory('owner', 'reader'), notes: 'Reading partner', facts: [{ key: 'workflow', text: 'Summarize articles', evidence: 'Please summarize articles' }] }, 'reader')
  const store = new UserMemoryStore(db, () => 'owner', () => 'owner', directory)
  const before = store.read('reader')
  expect(readFileSync(before.memoryFilePath!, 'utf8')).toContain('Summarize articles')
  writeFileSync(before.memoryFilePath!, readFileSync(before.memoryFilePath!, 'utf8').replace('Summarize articles', 'Summarize and collect articles'))
  expect(() => store.save(before, 'reader')).toThrow('Memory changed')
  const next = store.read('reader')
  expect(next.facts[0]).toMatchObject({ key: 'workflow', text: 'Summarize and collect articles', evidence: 'Please summarize articles' })
  expect(next.revision).toBeGreaterThan(before.revision)
  store.save({ ...next, notes: '', facts: [] }, 'reader')
  expect(readFileSync(next.memoryFilePath!, 'utf8')).not.toContain('Summarize')
  store.removeAgent('reader')
  expect(existsSync(next.memoryFilePath!)).toBe(false)
})
it('isolates scopes and preserves malformed files instead of silently overwriting them', () => {
  const { directory, db } = setup()
  const store = new UserMemoryStore(db, () => 'owner', () => 'owner', directory)
  const personal = store.read('reader')
  expect(personal.filePath).not.toBe(store.read().filePath)
  expect(new UserMemoryFiles(directory).path('../other', '../../reader').startsWith(directory + '/')).toBe(true)
  expect(new UserMemoryFiles(directory).path('other', 'reader')).not.toBe(personal.filePath)
  writeFileSync(personal.filePath!, '# Broken metadata\nKeep my content')
  expect(() => store.read('reader')).toThrow('metadata is missing')
  expect(() => store.save(personal, 'reader')).toThrow('metadata is missing')
  expect(readFileSync(personal.filePath!, 'utf8')).toContain('Keep my content')
})
