import { describe, expect, it, vi } from 'vitest'
import { groupDecisionPrompt, groupConversationPrompt, runGroupConversation, validateGroupDecision, type BotGroup, type GroupMessage } from './group'
import { privateContext, type PrivateDelivery } from './privateMessages'

const group: BotGroup = { id: 'g', name: 'Team', leadMemberId: 'a', members: [
  { id: 'a', name: 'Leader' }, { id: 'b', name: 'Writer' }, { id: 'c', name: 'Reviewer' }
] }
const stop = { mode: 'none', memberIds: [], triggerMessageIds: [] }
const user: GroupMessage = { id: 'u', role: 'user', content: 'Work together' }
const message = (id: string, content = 'Done'): GroupMessage => ({ id: `${id}-reply`, role: 'assistant', sender: { id, name: id }, content })
const signal = () => new AbortController().signal

it.each([
  [{ mode: 'ordered', memberIds: ['a'] }, 'mode must be'],
  [{ mode: 'single', memberIds: { a: true } }, 'expected an array'],
  [{ mode: 'single', memberIds: [{ id: 'a' }] }, 'each entry must be an ID string']
])('identifies the exact invalid planning field %#', (fields, reason) => {
  expect(() => validateGroupDecision({ ...fields, triggerMessageIds: ['u'] }, group,
    { messages: [user], privateDeliveries: [], completedTurns: [] })).toThrow(reason)
})

it('accepts unused null decision fields without discarding valid assignments', () => {
  const context = { messages: [user], privateDeliveries: [], completedTurns: [] }
  const raw = { mode: 'single', memberIds: ['b'], triggerMessageIds: ['u'], participantScope: null,
    publicDeliverables: null, assignments: { a: null, b: 'Write the answer', c: '' } }
  expect(validateGroupDecision(raw, group, context)).toMatchObject({ mode: 'single', assignments: { b: 'Write the answer' } })
  expect(raw.assignments.a).toBeNull()
  expect(() => validateGroupDecision({ ...raw, assignments: { unknown: null } }, group, context)).toThrow('Invalid member assignments')
  expect(() => validateGroupDecision({ ...raw, participantScope: 'everyone' }, group, context)).toThrow('Invalid participant scope')
})

it('preserves assignments across handoffs and requires a real final leader turn', async () => {
  const calls: { id: string; assignment?: string; finalize?: boolean }[] = []
  const decide = vi.fn().mockResolvedValueOnce({ mode: 'single', leaderFirst: true, supervise: true, requireSummary: true,
    memberIds: ['a'], triggerMessageIds: ['u'], assignments: { b: 'Write the requirements', c: 'Review the requirements' } }).mockResolvedValue(stop)
  const result = await runGroupConversation({ group, user, signal: signal(), decide, reply: async (member, turn) => {
    calls.push({ id: member.id, assignment: turn.assignment, finalize: turn.finalize })
    return [message(member.id, turn.finalize ? 'Final result referencing @Writer without delegating' : member.id === 'a' ? '@Writer begin' : member.id === 'b' ? 'Requirements. @Reviewer review' : 'Review completed')]
  } })
  expect(calls).toEqual([{ id: 'a' }, { id: 'b', assignment: 'Write the requirements' }, { id: 'c', assignment: 'Review the requirements' }, { id: 'a', finalize: true }])
  expect(result).toMatchObject({ failed: false, limited: false })
})

it('persists a human checkpoint encountered after work has already begun', async () => {
  const decide = vi.fn().mockResolvedValueOnce({ mode: 'single', memberIds: ['a'], triggerMessageIds: ['u'] })
    .mockResolvedValueOnce({ mode: 'single', memberIds: ['b'], triggerMessageIds: ['u'], waitForHuman: true })
  const result = await runGroupConversation({ group, user, signal: signal(), decide, reply: async member => [message(member.id)] })
  expect(result.waitingForHuman).toBe(true)
  expect(decide).toHaveBeenCalledTimes(2)
})

it('ends after a handoff returns completed work to the leader for consolidation', async () => {
  const decide = vi.fn().mockResolvedValueOnce({ mode: 'single', memberIds: ['a'], triggerMessageIds: ['u'], supervise: true, requireSummary: true,
    assignments: { b: 'Requirements', c: 'Review' } }).mockRejectedValue(new Error('No decision should run after the final result'))
  const calls: string[] = []
  const result = await runGroupConversation({ group, user, signal: signal(), decide, reply: async (member, turn) => {
    calls.push(member.id)
    if (calls.length === 4) expect(turn.finalize).toBe(true)
    return [message(member.id, turn.finalize ? 'Final deliverable' : member.id === 'a' ? '@Writer begin' : member.id === 'b' ? 'Requirements. @Reviewer review' : 'Review. @Leader consolidate')]
  } })
  expect(calls).toEqual(['a', 'b', 'c', 'a'])
  expect(decide).toHaveBeenCalledTimes(1)
  expect(result).toMatchObject({ failed: false, limited: false })
})

it('automatically consolidates once every declared contributor has delivered', async () => {
  const decide = vi.fn().mockResolvedValueOnce({ mode: 'single', memberIds: ['a'], triggerMessageIds: ['u'], leaderFirst: true,
    assignments: { b: 'Requirements', c: 'Review' } }).mockRejectedValue(new Error('All known work is already committed'))
  const calls: string[] = []
  await runGroupConversation({ group, user, signal: signal(), decide, reply: async (member, turn) => {
    calls.push(member.id)
    return [message(member.id, turn.finalize ? 'Consolidated deliverables' : member.id === 'a' ? '@Writer requirements. @Reviewer review afterwards.' : 'Substantive contribution')]
  } })
  expect(calls).toEqual(['a', 'b', 'c', 'a'])
  expect(decide).toHaveBeenCalledTimes(1)
})

it('rejects assignments for non-members and oversized instructions', () => {
  const context = { messages: [user], privateDeliveries: [], completedTurns: [] }
  const base = { mode: 'single', memberIds: ['a'], triggerMessageIds: ['u'] }
  expect(() => validateGroupDecision({ ...base, assignments: { stranger: 'work' } }, group, context)).toThrow('assignments')
  expect(() => validateGroupDecision({ ...base, assignments: { a: 'x'.repeat(2001) } }, group, context)).toThrow('assignments')
})

it('does not force an earlier confidential task into a public deliverable on continuation', async () => {
  const decide = vi.fn().mockResolvedValueOnce({ mode: 'single', memberIds: ['b'], triggerMessageIds: ['u'], assignments: { b: '整理需求' } }).mockResolvedValue(stop)
  await runGroupConversation({ group, user: { ...user, content: '继续' }, history: [{ id: 'earlier', role: 'user', content: '请私下整理需求，不要公开。' }], signal: signal(), decide,
    reply: async (member, turn) => { expect(turn.publicDeliverable).toBeUndefined(); return [message(member.id)] } })
})

it('does not treat a negated @mention as permission to reply', async () => {
  const reply = vi.fn()
  const decide = vi.fn().mockResolvedValue(stop)
  await runGroupConversation({ group, user: { ...user, content: '@Leader 不用回复，这条消息是发给真人的。' }, signal: signal(), decide, reply })
  expect(decide).toHaveBeenCalledTimes(1)
  expect(reply).not.toHaveBeenCalled()
})

it('routes a classified single response without waking the unselected leader', async () => {
  const decide = vi.fn().mockResolvedValue({ mode: 'single', memberIds: ['b'], triggerMessageIds: ['u'],
    assignments: { a: 'Leader 不用回复。', b: '回答问题' } })
  const calls: string[] = []
  await runGroupConversation({ group, user, signal: signal(), decide,
    reply: async member => { calls.push(member.id); return [message(member.id)] } })
  expect(calls).toEqual(['b'])
  expect(decide).toHaveBeenCalledTimes(1)
})

it.each(['sequential', 'parallel'] as const)('skips an unavailable participant without impersonation or extra leader turns: %s', async mode => {
  const calls: string[] = [], absent: string[] = []
  const decide = vi.fn().mockResolvedValue({ mode, participationOnly: true, memberIds: ['a', 'b', 'c'], triggerMessageIds: ['u'] })
  const result = await runGroupConversation({ group, user, signal: signal(), decide, onUnavailable: id => absent.push(id),
    reply: async member => { calls.push(member.id); return member.id === 'b' ? { messages: [], failed: true } : [message(member.id)] } })
  expect(calls).toEqual(['a', 'b', 'c'])
  expect(absent).toEqual(['b'])
  expect(decide).toHaveBeenCalledTimes(1)
  expect(result).toMatchObject({ failed: false, unavailableMemberIds: ['b'] })
})

it('uses the ranked replacement to complete the missing assignment', async () => {
  const calls: string[] = []
  await runGroupConversation({ group, user: { ...user, content: '@Writer write the implementation' }, signal: signal(), decide: async context => context.completedTurns.length ? stop : { mode: 'single', memberIds: ['b'], triggerMessageIds: ['u'] },
    rankCandidates: members => [...members].reverse(),
    reply: async member => { calls.push(member.id); return member.id === 'b' ? { messages: [], failed: true } : [message(member.id)] } })
  expect(calls).toEqual(['b', 'c', 'a']) // C replaces B, then A reviews the member failure.
})

describe('group collaboration', () => {
  it('preserves the ordered worker plan and final leader consolidation without duplicate handoffs', async () => {
    const calls: string[] = []
    const decide = vi.fn().mockResolvedValueOnce({ mode: 'sequential', memberIds: ['b', 'c', 'a'], triggerMessageIds: ['u'] }).mockResolvedValue(stop)
    await runGroupConversation({ group, user, signal: signal(), decide, reply: async (member, turn, visible) => {
      calls.push(member.id)
      if (calls.length === 1) {
        expect(turn.delegationPlan).toEqual({ mode: 'sequential', memberIds: ['b', 'c', 'a'] })
        return [message('a', '@Writer draft it. @Reviewer review it.')]
      }
      if (member.id === 'c') expect(visible.some((item) => item.id === 'b-reply')).toBe(true)
      return [message(member.id)]
    } })
    expect(calls).toEqual(['a', 'b', 'c', 'a'])
  })

  it.each(['大家每人讲个笑话', '@all tell a joke each'])('starts independent replies concurrently: %s', async (content) => {
    const started: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const decide = vi.fn().mockResolvedValueOnce({ mode: 'parallel', memberIds: ['a', 'b', 'c'], triggerMessageIds: ['u'] }).mockResolvedValue(stop)
    const result = await runGroupConversation({ group, user: { ...user, content }, signal: signal(), decide, reply: async (member, _turn, visible) => {
      started.push(member.id)
      expect(visible).toEqual([{ ...user, content }])
      if (started.length === 3) release()
      await gate
      return [message(member.id)]
    } })
    expect(started).toEqual(['a', 'b', 'c'])
    expect(result.failed).toBe(false)
  })

  it('honours dependencies even when the human mentions everyone', async () => {
    const order: string[] = []
    const decide = vi.fn().mockResolvedValue({ mode: 'sequential', memberIds: ['b', 'c'], triggerMessageIds: ['u'] })
    await runGroupConversation({ group, user: { ...user, content: '@all Writer drafts, then Reviewer checks' }, signal: signal(), decide,
      reply: async (member, _turn, visible) => {
        order.push(member.id)
        if (member.id === 'c') expect(visible.at(-1)?.sender?.id).toBe('b')
        return [message(member.id)]
      } })
    expect(order).toEqual(['b', 'c'])
  })

  it('delivers private triggers in order and keeps other members out of each inbox', async () => {
    const deliveries: PrivateDelivery[] = []
    const order: string[] = []
    await runGroupConversation({ group, user: { ...user, content: '@Leader start the game' }, signal: signal(), decide: async context => context.completedTurns.length ? stop : { mode: 'single', memberIds: ['a'], triggerMessageIds: ['u'] },
      reply: async (member, turn) => {
        order.push(member.id)
        if (member.id === 'a') {
          deliveries.push(...['b', 'c', 'human'].map((id) => ({ id: `secret-${id}`, sender: { id: 'a', name: 'Leader' }, recipient: { id, name: id }, content: `word-${id}`, createdAt: 1 })))
          return { messages: [message('a', 'Words delivered')], privateMessages: deliveries }
        }
        expect(turn.triggerMessageIds).toEqual([`secret-${member.id}`])
        expect(privateContext(deliveries, member.id).map((item) => item.content)).toEqual([`word-${member.id}`])
        const prompt = groupConversationPrompt(group, member, [user], turn, deliveries)
        expect(prompt).not.toContain('word-human')
        expect(prompt).not.toContain(member.id === 'b' ? 'word-c' : 'word-b')
        return [message(member.id, 'Ready')]
      } })
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('does not start deferred workers after cancellation', async () => {
    const abort = new AbortController()
    const calls: string[] = []
    await runGroupConversation({ group, user, signal: abort.signal,
      decide: async () => ({ mode: 'sequential', memberIds: ['b', 'c'], triggerMessageIds: ['u'] }),
      reply: async (member) => { calls.push(member.id); abort.abort(); return [message(member.id)] } })
    expect(calls).toEqual(['a'])
  })
})

describe('ambiguous group messages', () => {
  it.each(['亲', '在吗', '帮我弄一下'])('lets only the leader answer %s, then waits for the human', async (content) => {
    // Even a contradictory multi-member plan must not fan out when the
    // controller identifies that it needs human input.
    const decide = vi.fn().mockResolvedValue({ waitForHuman: true, mode: 'parallel', memberIds: ['a', 'b', 'c'], triggerMessageIds: ['u'] })
    const spoke: string[] = []
    const result = await runGroupConversation({ group, user: { ...user, content }, signal: signal(), decide,
      reply: async (member) => {
        spoke.push(member.id)
        return [message(member.id, 'What would you like to do? @Writer')]
      } })
    expect(spoke).toEqual(['a'])
    expect(decide).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ limited: false, failed: false, unavailableMemberIds: [], waitingForHuman: true })
  })
})

describe('hosted activities', () => {
  it('opens with only the leader even when the proposed plan includes all players', async () => {
    const decide = vi.fn().mockResolvedValueOnce({ leaderFirst: true, mode: 'parallel', memberIds: ['a', 'b', 'c'], triggerMessageIds: ['u'] }).mockResolvedValue(stop)
    const spoke: string[] = []
    await runGroupConversation({ group, user: { ...user, content: '来玩谁是卧底吧' }, signal: signal(), decide,
      reply: async (member) => { spoke.push(member.id); return [message(member.id, 'I will host. Choose the rules.')] } })
    expect(spoke).toEqual(['a'])
    expect(decide).toHaveBeenCalledTimes(2)
  })

  it('activates players only after the host actually assigns them work', async () => {
    const spoke: string[] = []
    await runGroupConversation({ group, user, signal: signal(),
      decide: async context => context.completedTurns.length ? stop : ({ leaderFirst: true, mode: 'parallel', memberIds: ['a', 'b', 'c'], triggerMessageIds: ['u'] }),
      reply: async (member) => {
        spoke.push(member.id)
        return [message(member.id, member.id === 'a' && spoke.length === 1 ? '@Writer describe your word first. @Reviewer follow.' : 'My description')]
      } })
    expect(spoke).toEqual(['a', 'b', 'c', 'a'])
  })
})

describe('conversational addressees', () => {
  it('lets the contextual addressee reply without inserting the leader or the named third party', async () => {
    const decide = vi.fn().mockResolvedValue({ addressedMemberId: 'b', mode: 'single', memberIds: ['a'], triggerMessageIds: ['u'], leaderFirst: true })
    const spoke: string[] = []
    await runGroupConversation({ group, user: { ...user, content: '那你给 Leader 发个消息，让他给我讲个笑话' },
      history: [{ id: 'previous', role: 'user', content: 'Tell me a joke' }, message('b', 'Here is my joke')],
      signal: signal(), decide, reply: async (member) => { spoke.push(member.id); return [message(member.id)] } })
    expect(spoke).toEqual(['b'])
    expect(decide).toHaveBeenCalledTimes(1)
  })

  it('schedules the third party only after a real private delivery from the addressee', async () => {
    const spoke: string[] = []
    await runGroupConversation({ group, user, signal: signal(),
      decide: async () => ({ addressedMemberId: 'b', mode: 'single', memberIds: ['b'], triggerMessageIds: ['u'] }),
      reply: async (member, turn) => {
        spoke.push(member.id)
        if (member.id === 'b') return { messages: [], privateMessages: [{ id: 'handoff', sender: { id: 'b', name: 'Writer' }, recipient: { id: 'a', name: 'Leader' }, content: 'Tell the human a joke', createdAt: 1 }] }
        expect(turn.triggerMessageIds).toEqual(['handoff'])
        return [message(member.id)]
      } })
    expect(spoke).toEqual(['b', 'a'])
  })
})

it('bounds a 50-member independent batch to four active executions without waking other agents', async () => {
  const crew: BotGroup = { id: 'large', name: 'Large group', members: Array.from({ length: 50 }, (_, index) => ({ id: `member-${index}`, name: `Member ${index}` })) }
  let active = 0
  let peak = 0
  const spoken: string[] = []
  await runGroupConversation({ group: crew, user: { id: 'u', role: 'user', content: 'Each member contribute independently.' }, maxTurns: 60,
    signal: new AbortController().signal,
    decide: async context => context.completedTurns.length ? { mode: 'none', memberIds: [], triggerMessageIds: [] }
      : { mode: 'parallel', memberIds: crew.members.map(member => member.id), triggerMessageIds: ['u'] },
    reply: async member => {
      active++; peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 1))
      spoken.push(member.id); active--
      return [{ id: member.id, role: 'assistant', sender: member, content: 'Contribution' }]
    }
  })
  expect(peak).toBe(4)
  expect(new Set(spoken).size).toBe(50)
})

it('routes explicit addressing and unplanned handoffs through the configured policy', async () => {
  const decide = vi.fn().mockResolvedValueOnce({ mode: 'single', memberIds: ['b'], triggerMessageIds: ['u'] }).mockResolvedValue(stop)
  const reply = vi.fn(async (member: { id: string }) => [message(member.id, '@Reviewer please continue')])
  await runGroupConversation({ group: structuredClone(group), user: { ...user, content: '@Writer start' }, signal: signal(), configuredRouting: true, decide, reply })
  expect(decide).toHaveBeenCalledTimes(2)
  expect(reply).toHaveBeenCalledTimes(1)
  expect(decide.mock.calls[1][0].messages.at(-1).content).toContain('@Reviewer')
})

it('does not invent an opening before the configured sequential plan', async () => {
  const decide = vi.fn().mockResolvedValueOnce({ mode: 'sequential', memberIds: ['b', 'c'], triggerMessageIds: ['u'] }).mockResolvedValue(stop)
  const speakers: string[] = []
  await runGroupConversation({ group, user, signal: signal(), configuredRouting: true, decide, reply: async member => { speakers.push(member.id); return [message(member.id)] } })
  expect(speakers).toEqual(['b', 'c'])
})

it.each(['skip', 'replace', 'pause'] as const)('validates recovery action %s against task semantics and unavailable members', action => {
  const c = { messages: [user], privateDeliveries: [], completedTurns: [], unavailableMemberIds: ['a'],
    recovery: { failedMemberId: 'a', participationOnly: action === 'skip', triggerMessageIds: ['u'] } }
  const decision = { leaderMemberId: 'b', recoveryAction: action, mode: action === 'replace' ? 'single' : 'none', memberIds: action === 'replace' ? ['c'] : [], triggerMessageIds: action === 'replace' ? ['u'] : [] }
  expect(validateGroupDecision(decision, group, c).recoveryAction).toBe(action)
  expect(() => validateGroupDecision({ ...decision, leaderMemberId: 'a' }, group, c)).toThrow('unavailable leader')
  if (action === 'replace') {
    expect(() => validateGroupDecision({ ...decision, memberIds: ['a'] }, group, c)).toThrow('available replacement')
    expect(() => validateGroupDecision(decision, group, { ...c, recovery: { ...c.recovery, participationOnly: true } })).toThrow('impersonated')
  }
  if (action === 'skip') expect(() => validateGroupDecision(decision, group, { ...c, recovery: { ...c.recovery, participationOnly: false } })).toThrow('cannot be silently skipped')
})

it('pauses when the configured recovery policy says to pause without running a heuristic replacement', async () => {
  const decide = vi.fn().mockResolvedValueOnce({ mode: 'single', memberIds: ['b'], triggerMessageIds: ['u'] })
    .mockResolvedValue({ ...stop, recoveryAction: 'pause', leaderMemberId: 'c' })
  const reply = vi.fn(async () => ({ messages: [], failed: true }))
  await expect(runGroupConversation({ group, user, signal: signal(), configuredRouting: true, decide, reply })).rejects.toThrow('pause')
  expect(reply).toHaveBeenCalledTimes(1)
})

it('rejects contradictory hosting flags rather than truncating the participation roster', () => {
  const context = { messages: [user], privateDeliveries: [], completedTurns: [] }
  for (const flag of ['leaderFirst', 'waitForHuman', 'requireSummary']) {
    expect(() => validateGroupDecision({ participationOnly: true, [flag]: true, mode: 'sequential', memberIds: ['a', 'b', 'c'], triggerMessageIds: ['u'] }, group, context)).toThrow('keep the full participant roster')
  }
})

it('rejects duplicate personal participation slots even in sequential mode', () => {
  expect(() => validateGroupDecision({ mode: 'sequential', participationOnly: true, memberIds: ['a', 'a'], triggerMessageIds: ['u'] }, group,
    { messages: [user], privateDeliveries: [], completedTurns: [] })).toThrow()
})

it.each(['sequential', 'parallel'] as const)('skips cached absences without calling the member or making another recovery decision: %s', async mode => {
  const calls: string[] = []
  const decide = vi.fn(async () => ({ leaderMemberId: 'a', mode, participationOnly: true, memberIds: ['a', 'b', 'c'], triggerMessageIds: ['u'] }))
  const unavailable = vi.fn()
  const result = await runGroupConversation({ group, user, signal: signal(), configuredRouting: true, initiallyUnavailable: ['b'], decide,
    onUnavailable: unavailable, reply: async member => { calls.push(member.id); return [message(member.id)] } })
  expect(calls).toEqual(['a', 'c'])
  expect(decide).toHaveBeenCalledTimes(1)
  expect(unavailable).toHaveBeenCalledWith('b', true)
  expect(result).toMatchObject({ failed: false, unavailableMemberIds: ['b'] })
})

it('rejects ordinary work assigned to a cached unavailable member, including explicit addressing', () => {
  const context = { messages: [user], privateDeliveries: [], completedTurns: [], unavailableMemberIds: ['b'] }
  for (const extra of [{}, { addressedMemberId: 'b' }]) expect(() => validateGroupDecision({ mode: 'single', leaderMemberId: 'a', memberIds: ['b'], triggerMessageIds: ['u'], ...extra }, group, context)).toThrow(/unavailable/)
  expect(validateGroupDecision({ mode: 'single', leaderMemberId: 'a', memberIds: ['c'], triggerMessageIds: ['u'] }, group, context).memberIds).toEqual(['c'])
})

it.each(['@Writer 不用回复', '@Writer do not reply', '@Writer no respondas', '@Writer 返信しないでください'])('lets the configured policy decide agent-posted silence in any language: %s', async content => {
  const decide = vi.fn().mockResolvedValue(stop)
  const reply = vi.fn()
  await runGroupConversation({ group, user: { ...user, role: 'assistant', sender: { id: 'a', name: 'Leader' }, content }, configuredRouting: true, signal: signal(), decide, reply })
  expect(decide).toHaveBeenCalledOnce()
  expect(decide.mock.calls[0][0].messages.at(-1).content).toBe(content)
  expect(reply).not.toHaveBeenCalled()
})


it('keeps production planning and worker instructions independent of acceptance scenarios', () => {
  const context = { messages: [user], privateDeliveries: [], completedTurns: [] }
  const prompts = [groupDecisionPrompt(group, context), groupConversationPrompt(group, group.members[0], [user])]
  for (const prompt of prompts) expect(prompt).not.toMatch(/undercover|werewolf|roll[_ -]?call|jokes?|狼人杀|谁是卧底|报数|讲笑话/i)
})

it('carries only successful current-request progress through a failed sequential contribution', async () => {
  const seen: unknown[] = []
  const decide = vi.fn().mockResolvedValueOnce({ mode: 'sequential', participationOnly: true, participantScope: 'all', memberIds: ['a', 'b', 'c'], triggerMessageIds: ['u'] })
    .mockResolvedValue({ ...stop, recoveryAction: 'skip', leaderMemberId: 'a' })
  const result = await runGroupConversation({ group, user: { ...user, content: 'Append one letter per successful contribution, beginning with A.' },
    history: [message('old', 'XYZ')], signal: signal(), configuredRouting: true, decide,
    reply: async (member, turn) => {
      seen.push(turn.progress)
      if (member.id === 'b') return { messages: [], failed: true }
      return [message(member.id, turn.progress!.completedContributions ? 'AB' : 'A')]
    } })
  expect(result.failed).toBe(false)
  expect(seen).toEqual([
    { completedContributions: 0, publicMessageIds: [] },
    { completedContributions: 1, publicMessageIds: ['a-reply'] },
    { completedContributions: 1, publicMessageIds: ['a-reply'] }
  ])
})
