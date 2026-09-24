import { expect, it, vi } from 'vitest'
import { validateGroupTasks, groupTaskEvidence, type GroupTask } from './groupTasks'
import { runGroupConversation, type BotGroup, type GroupDecisionContext } from './group'
import { groupRoutingProfile } from '../groupProfile'
const group: BotGroup = { id: 'g', name: 'Team', leadMemberId: 'a', members: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }] }
const user = { id: 'u', role: 'user' as const, content: 'ORIGINAL_REQUIREMENTS' }
const context: GroupDecisionContext = { requestMessageId: 'u', messages: [user], privateDeliveries: [], completedTurns: [] }
const node = (id: string, memberId: string, dependsOn: string[] = []): GroupTask => ({ id, memberId, dependsOn, instruction: `Do ${id}`, expectedOutput: `Evidence for ${id}` })
const stop = { mode: 'none', memberIds: [], triggerMessageIds: [] }

it.each([
  [node('one', 'a', ['missing'])],
  [node('one', 'a', ['two']), node('two', 'b', ['one'])],
  [node('one', 'a', ['one'])],
  [node('one', 'a'), node('one', 'b')],
  [node('one', 'unknown')]
])('rejects invalid graph %# before execution', (...tasks) => {
  expect(() => validateGroupTasks(tasks, group, context)).toThrow()
})

it('rejects a denied capability and unavailable member', () => {
  const routing = groupRoutingProfile({})
  routing.permissions.filesWrite = 'deny'
  const configured = { ...group, members: group.members.map(member => ({ ...member, routing })) }
  expect(() => validateGroupTasks([{ ...node('one', 'a'), requiredCapabilities: ['filesWrite'] }], configured, context)).toThrow('denied')
  expect(() => validateGroupTasks([node('one', 'a')], group, { ...context, unavailableMemberIds: ['a'] })).toThrow('unavailable')
})

it('executes fan-out/fan-in and lets the same worker own a later review node', async () => {
  const tasks = [node('research', 'a'), node('data', 'b'), node('draft', 'c', ['research', 'data']), node('review', 'a', ['draft'])]
  const done: string[] = []
  const active = new Set<string>()
  const decide = vi.fn().mockResolvedValueOnce({ mode: 'parallel', memberIds: ['a', 'b', 'c'], tasks, triggerMessageIds: ['u'], supervise: true }).mockResolvedValue(stop)
  const result = await runGroupConversation({ group, user, signal: new AbortController().signal, configuredRouting: true, decide,
    reply: async (member, turn, messages) => {
      expect(active.has(member.id)).toBe(false); active.add(member.id)
      for (const dependency of turn.dependsOn ?? []) {
        expect(done).toContain(dependency)
        expect(messages.some(message => message.id === dependency)).toBe(true)
        expect(turn.triggerMessageIds).toContain(dependency)
      }
      expect(turn.expectedOutput).toBe(`Evidence for ${turn.taskId}`)
      await Promise.resolve()
      done.push(turn.taskId!); active.delete(member.id)
      return [{ id: turn.taskId!, role: 'assistant', sender: member, content: `Completed ${turn.taskId}` }]
    } })
  expect(result).toMatchObject({ failed: false, limited: false })
  expect(done).toEqual(['research', 'data', 'draft', 'review'])
  expect(decide).toHaveBeenCalledTimes(2)
})

it('starts recovery while unrelated parallel work is still running', async () => {
  let unblock!: () => void
  const gate = new Promise<void>(resolve => { unblock = resolve })
  const calls: string[] = []
  const decide = vi.fn(async (ctx: GroupDecisionContext) => {
    if (ctx.recovery) {
      expect(calls).not.toContain('slow-finished')
      return { recoveryAction: 'replace', mode: 'single', memberIds: ['c'], triggerMessageIds: ['u'] }
    }
    return ctx.completedTurns.length ? stop : { mode: 'parallel', memberIds: ['a', 'b'], triggerMessageIds: ['u'] }
  })
  const result = await runGroupConversation({ group, user, signal: new AbortController().signal, configuredRouting: true, decide,
    reply: async member => {
      if (member.id === 'a') return { messages: [], failed: true }
      if (member.id === 'b') { await gate; calls.push('slow-finished') }
      if (member.id === 'c') { calls.push('replacement'); unblock() }
      return [{ id: member.id, role: 'assistant', sender: member, content: 'Real result' }]
    } })
  expect(result.failed).toBe(false)
  expect(calls).toEqual(['replacement', 'slow-finished'])
})

it('keeps original requirements and early result evidence after many public messages', () => {
  const evidence = groupTaskEvidence({ ...context, messages: [user, { id: 'result', role: 'assistant', content: 'VERIFIED_RESULT' },
    ...Array.from({ length: 30 }, (_, index) => ({ id: `chat${index}`, role: 'assistant' as const, content: 'later chat' }))],
    completedTurns: [{ round: 1, memberId: 'a', taskId: 'one', assignment: 'Original assignment', triggerMessageIds: ['u'], messageIds: ['result'], privateMessageIds: ['private-envelope'] }] })
  expect(evidence.request?.content).toBe('ORIGINAL_REQUIREMENTS')
  expect(evidence.completed[0].publicResult).toBe('VERIFIED_RESULT')
  expect(evidence.completed[0].privateDeliveryIds).toEqual(['private-envelope'])
})

it('starts a dependent node before an unrelated slow root completes', async () => {
  const tasks = [node('fast', 'a'), node('slow', 'b'), node('child', 'c', ['fast'])]
  let releaseSlow!: () => void
  const slow = new Promise<void>(resolve => { releaseSlow = resolve })
  const events: string[] = []
  const decide = vi.fn().mockResolvedValueOnce({ mode: 'parallel', tasks, memberIds: ['a', 'b', 'c'], triggerMessageIds: ['u'] }).mockResolvedValue(stop)
  const running = runGroupConversation({ group, user, decide, signal: new AbortController().signal, configuredRouting: true,
    reply: async (member, turn, messages) => {
      if (turn.taskId === 'slow') await slow
      if (turn.taskId === 'child') {
        expect(events).toContain('fast'); expect(events).not.toContain('slow')
        expect(messages.map(message => message.id)).toEqual(['u', 'fast'])
      }
      events.push(turn.taskId!)
      return [{ id: turn.taskId!, role: 'assistant', sender: member, content: `Result ${turn.taskId}` }]
    } })
  try { await vi.waitFor(() => expect(events).toContain('child')) }
  finally { releaseSlow() }
  expect((await running).failed).toBe(false)
  const review = decide.mock.calls.at(-1)![0] as GroupDecisionContext
  // Review/journal order is stable, although completion order was fast,child,slow.
  expect(review.completedTurns.map(turn => [turn.taskId, turn.round])).toEqual([['fast', 1], ['slow', 2], ['child', 3]])
})

it('rejects an empty successful node without releasing its dependents or repeating it', async () => {
  const decide = vi.fn().mockResolvedValue({ mode: 'parallel', tasks: [node('empty', 'a'), node('child', 'b', ['empty'])], memberIds: ['a', 'b'], triggerMessageIds: ['u'] })
  const reply = vi.fn(async () => ({ messages: [] }))
  await expect(runGroupConversation({ group, user, decide, reply, configuredRouting: true, signal: new AbortController().signal })).rejects.toThrow('no deliverable')
  expect(reply).toHaveBeenCalledTimes(1)
  expect(decide).toHaveBeenCalledTimes(1)
})

it('passes attachment-only evidence into dependent context and final review', async () => {
  const decide = vi.fn().mockResolvedValueOnce({ mode: 'parallel', tasks: [node('image', 'a'), node('review', 'b', ['image'])], memberIds: ['a', 'b'], triggerMessageIds: ['u'] }).mockResolvedValue(stop)
  const { groupConversationPrompt } = await import('./group')
  await runGroupConversation({ group, user, decide, configuredRouting: true, signal: new AbortController().signal,
    reply: async (member, turn, messages) => {
      if (turn.taskId === 'image') return [{ id: 'image', role: 'assistant', sender: member, content: '', artifacts: [{ id: 'artifact', name: 'chart.png' }] }]
      expect(groupConversationPrompt(group, member, messages, turn)).toContain('chart.png')
      return [{ id: 'review', role: 'assistant', sender: member, content: 'Review based on the chart' }]
    } })
  expect(groupTaskEvidence(decide.mock.calls.at(-1)![0]).completed[0].publicArtifacts).toEqual([{ id: 'artifact', name: 'chart.png' }])
})

it('drains already-started operations after cancellation and never releases their children', async () => {
  const { executeGroupTaskGraph } = await import('./groupTasks')
  const abort = new AbortController()
  let finish!: () => void
  const gate = new Promise<void>(resolve => { finish = resolve })
  const calls: string[] = []
  const running = executeGroupTaskGraph([node('root', 'a'), node('child', 'b', ['root'])], {
    signal: abort.signal, budget: 10, run: async task => { calls.push(task.id); await gate; return task.id }
  })
  await vi.waitFor(() => expect(calls).toEqual(['root']))
  abort.abort(); finish()
  await running
  expect(calls).toEqual(['root'])
})

it('enforces global concurrency, per-member serialization and the task budget', async () => {
  const { executeGroupTaskGraph } = await import('./groupTasks')
  const tasks = Array.from({ length: 12 }, (_, i) => node(`task${i}`, `worker${i % 6}`))
  const active = new Set<string>()
  let maxActive = 0
  const result = await executeGroupTaskGraph(tasks, { signal: new AbortController().signal, budget: 7, run: async task => {
    expect(active.has(task.memberId)).toBe(false)
    active.add(task.memberId); maxActive = Math.max(maxActive, active.size)
    await Promise.resolve(); active.delete(task.memberId)
    return task.id
  } })
  expect(maxActive).toBeLessThanOrEqual(4)
  expect(result.results.size).toBe(7)
  expect(result.limited).toBe(true)
})

it('retains wave scheduling when replaying a legacy workflow', async () => {
  const tasks = [node('fast', 'a'), node('slow', 'b'), node('child', 'c', ['fast'])]
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const events: string[] = []
  const decide = vi.fn().mockResolvedValueOnce({ mode: 'parallel', tasks, memberIds: ['a', 'b', 'c'], triggerMessageIds: ['u'] }).mockResolvedValue(stop)
  const running = runGroupConversation({ group, user, decide, configuredRouting: true, streamingTasks: false, signal: new AbortController().signal,
    reply: async (member, turn) => {
      if (turn.taskId === 'slow') await gate
      events.push(turn.taskId!)
      return [{ id: turn.taskId!, role: 'assistant', sender: member, content: 'Result' }]
    } })
  try { await vi.waitFor(() => expect(events).toEqual(['fast'])) }
  finally { release() }
  await running
  expect(events).toEqual(['fast', 'slow', 'child'])
})

it('does not transfer private dependency work to a replacement without access', async () => {
  const tasks = [node('secret', 'a'), node('use-secret', 'b', ['secret'])]
  const workers: string[] = []
  const decide = vi.fn(async (ctx: GroupDecisionContext) => ctx.recovery
    ? { mode: 'single', recoveryAction: 'replace', memberIds: ['c'], triggerMessageIds: ctx.recovery.triggerMessageIds }
    : { mode: 'parallel', tasks, memberIds: ['a', 'b'], triggerMessageIds: ['u'] })
  await expect(runGroupConversation({ group, user, decide, configuredRouting: true, signal: new AbortController().signal,
    reply: async (member, turn) => {
      workers.push(member.id)
      if (member.id === 'a') return { messages: [], privateMessages: [{ id: 'secret-message', sender: group.members[0], recipient: group.members[1], content: 'PRIVATE_DEPENDENCY', createdAt: 1 }] }
      expect(turn.triggerMessageIds).toContain('secret-message')
      return { messages: [], failed: true }
    } })).rejects.toThrow('inaccessible')
  expect(workers).toEqual(['a', 'b'])
})
