import { expect, it, vi } from 'vitest'
import { GroupWorkflowJournal } from './groupWorkflow'
import type { GroupWorkflow } from '../shared/groupWorkflow'

const initial = (): GroupWorkflow => ({ id: 'task', ownerId: 'owner', conversationId: 'group', topicId: 'topic', runId: 'run', group: { id: 'group', name: 'Team', members: [] }, user: { id: 'user', role: 'user', content: 'work' }, history: [], privateMessages: [], status: 'running', calls: {}, updatedAt: 1 })
it('replays completed steps and re-evaluates only a new decision after a restart', async () => {
  let saved = initial()
  const save = (state: GroupWorkflow) => { saved = structuredClone(state) }
  const journal = new GroupWorkflowJournal(saved, save)
  const operation = vi.fn(async () => ({ text: 'Project review completed' }))
  await journal.call('reply:1', 'reply', operation)
  const reopened = new GroupWorkflowJournal(saved, save)
  expect(await reopened.call('reply:1', 'reply', operation)).toEqual({ text: 'Project review completed' })
  expect(operation).toHaveBeenCalledTimes(1)
  const decision = vi.fn(async () => ({ mode: 'none' }))
  await reopened.call('decision:2', 'decision', decision)
  expect(decision).toHaveBeenCalledTimes(1)
})
it('never retries an interrupted tool-bearing step, while retrying an interrupted decision is safe', async () => {
  const state = initial()
  state.calls.work = { kind: 'reply', status: 'running' }
  state.calls.route = { kind: 'decision', status: 'running' }
  const journal = new GroupWorkflowJournal(state, () => {})
  const work = vi.fn()
  await expect(journal.call('work', 'reply', work)).rejects.toThrow('will not be repeated automatically')
  expect(work).not.toHaveBeenCalled()
  expect(await journal.call('route', 'decision', async () => 'route')).toBe('route')
})
