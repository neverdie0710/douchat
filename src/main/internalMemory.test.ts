import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DouchatStore } from './store'
import { internalMemorySnapshot, isInternalConversation } from './internalMemory'

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach(dispose => dispose()))
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'internal-memory-'))
  const store = new DouchatStore(join(directory, 'state.db'))
  store.setCurrentAccountId('owner')
  cleanup.push(() => { store.close(); rmSync(directory, { recursive: true, force: true }) })
  const agent = store.createAgent({ name: '小丽', role: '', instructions: '', provider: 'test', model: 'test', color: '' })
  const group = store.createGroup({ name: '内部群', agentIds: [agent.id] })
  return { store, agent, group }
}

it('retrieves private assignments and other internal group memory with provenance', () => {
  const { store, agent, group } = fixture()
  store.userMemories.save({ ...store.userMemories.read(agent.id), memoryNotes: '下周三去杭州两天，待确认会议。' }, agent.id)
  store.groupMemories.save({ ...store.groupMemories.read(group.id), notes: '内部项目进度' }, group.id)
  const direct = store.conversation(`direct-${agent.id}`)!
  store.addMessage({ conversationId: direct.id, topicId: direct.activeTopicId, kind: 'message', authorId: 'user', authorName: 'Owner', text: '对接人微信 zhongtai' })
  const result = internalMemorySnapshot(store, 'owner', '待办')
  expect(result.sources).toEqual(expect.arrayContaining([
    expect.objectContaining({ source: `agent:${agent.id}`, text: expect.stringContaining('下周三去杭州') }),
    expect.objectContaining({ source: `group:${group.id}`, text: '内部项目进度' }),
    expect.objectContaining({ source: `conversation:${direct.id}:${direct.activeTopicId}`, text: expect.stringContaining('zhongtai'), historical: true })
  ]))
  expect(result.truncated).toBe(false)
})

it('isolates external audiences, preserves internal memory on linking, and rejects account changes', () => {
  const { store, agent, group } = fixture()
  store.groupMemories.save({ ...store.groupMemories.read(group.id), notes: 'INTERNAL_SECRET' }, group.id)
  const internal = store.groupMemories.read(group.id)
  expect(isInternalConversation(store, group, 'owner')).toBe(true)
  store.linkSharedGroup(group.id, 'remote')
  expect(isInternalConversation(store, store.conversation(group.id), 'owner')).toBe(false)
  expect(store.groupMemories.read(group.id).notes).toBe('')
  expect(() => store.groupMemories.save(internal, group.id)).toThrow('audience changed')
  store.groupMemories.save({ ...store.groupMemories.read(group.id), notes: 'EXTERNAL_ONLY' }, group.id)
  expect(JSON.stringify(internalMemorySnapshot(store, 'owner'))).not.toContain('EXTERNAL_ONLY')
  expect(store.groupMemories.read(group.id).notes).toBe('EXTERNAL_ONLY')
  store.setCurrentAccountId('other')
  expect(() => internalMemorySnapshot(store, 'owner')).toThrow('Account changed')
  expect(internalMemorySnapshot(store, 'other').sources).toEqual([])
  expect(isInternalConversation(store, { ...group, agentIds: [agent.id] }, 'other')).toBe(false)
})
