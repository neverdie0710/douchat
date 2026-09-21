import { describe, expect, it, vi } from 'vitest'
import { groupConversationPrompt, runGroupConversation, type BotGroup, type GroupMessage } from './group'
import { privateContext, type PrivateDelivery } from './privateMessages'

const group: BotGroup = { id: 'g', name: 'Team', leadMemberId: 'a', members: [
  { id: 'a', name: 'Leader' }, { id: 'b', name: 'Writer' }, { id: 'c', name: 'Reviewer' }
] }
const stop = { mode: 'none', memberIds: [], triggerMessageIds: [] }
const user: GroupMessage = { id: 'u', role: 'user', content: 'Work together' }
const message = (id: string, content = 'Done'): GroupMessage => ({ id: `${id}-reply`, role: 'assistant', sender: { id, name: id }, content })
const signal = () => new AbortController().signal

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
    await runGroupConversation({ group, user: { ...user, content: '@Leader start the game' }, signal: signal(), decide: async () => stop,
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
      decide: async () => ({ mode: 'single', memberIds: ['b'], triggerMessageIds: ['u'] }),
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
    expect(result).toEqual({ limited: false, failed: false, unavailableMemberIds: [] })
  })
})

describe('hosted activities', () => {
  it('opens with only the leader even when the proposed plan includes all players', async () => {
    const decide = vi.fn().mockResolvedValue({ leaderFirst: true, mode: 'parallel', memberIds: ['a', 'b', 'c'], triggerMessageIds: ['u'] })
    const spoke: string[] = []
    await runGroupConversation({ group, user: { ...user, content: '来玩谁是卧底吧' }, signal: signal(), decide,
      reply: async (member) => { spoke.push(member.id); return [message(member.id, 'I will host. Choose the rules.')] } })
    expect(spoke).toEqual(['a'])
    expect(decide).toHaveBeenCalledTimes(1)
  })

  it('activates players only after the host actually assigns them work', async () => {
    const spoke: string[] = []
    await runGroupConversation({ group, user, signal: signal(),
      decide: async () => ({ leaderFirst: true, mode: 'parallel', memberIds: ['a', 'b', 'c'], triggerMessageIds: ['u'] }),
      reply: async (member) => {
        spoke.push(member.id)
        return [message(member.id, member.id === 'a' ? '@Writer describe your word first. @Reviewer follow.' : 'My description')]
      } })
    expect(spoke).toEqual(['a', 'b', 'c'])
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
