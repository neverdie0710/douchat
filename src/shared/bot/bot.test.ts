import { describe, expect, it, vi } from 'vitest'
import { addressesEveryone, insertMention, mentionedMembers, mentionQuery } from './mentions'
import { BOT_MESSAGE_BREAK, splitBotReply } from './messages'
import {
  explicitGroupDecision,
  groupMemberSessionId,
  runGroupConversation,
  validateGroupDecision,
  type BotGroup,
  type GroupMessage
} from './group'
import { parsePrivateReply, privateReplyDeliveries } from './privateMessages'
import { a2aReplyMessages } from './a2a'
import { latestAssistantPreview, markdownPreview } from './preview'
import { contactSection, contactSections, matchesContactQuery } from './contacts'
import { summarizeRuntimeError } from './errors'

const members = [
  { id: 'a', name: 'Ann' },
  { id: 'b', name: 'Anna' },
  { id: 'c', name: '我的 codex' }
]
const group: BotGroup = { id: 'g', name: 'Crew', leadMemberId: 'a', members }

describe('mentions', () => {
  it('prefers the longest matching name', () => {
    expect(mentionedMembers('@Anna please take this', members).map((member) => member.id)).toEqual(['b'])
    expect(mentionedMembers('@Ann please take this', members).map((member) => member.id)).toEqual(['a'])
  })

  it('ignores mentions inside code, quotes and links', () => {
    expect(mentionedMembers('`@Ann`', members)).toHaveLength(0)
    expect(mentionedMembers('> @Ann said so', members)).toHaveLength(0)
    expect(mentionedMembers('[@Ann](https://example.com/@Ann)', members)).toHaveLength(0)
  })

  it('recognizes an address to everyone', () => {
    expect(addressesEveryone('@all ship it')).toBe(true)
    expect(addressesEveryone('@大家 ship it')).toBe(true)
    expect(addressesEveryone('mail me at a@allstate.com')).toBe(false)
  })

  it('keeps spaces inside an incomplete member name', () => {
    const value = '@我的 cod'
    expect(mentionQuery(value, value.length, members)?.query).toBe('我的 cod')
    const finished = '@all now'
    expect(mentionQuery(finished, finished.length, members)).toBeNull()
  })

  it('inserts a mention with a trailing space', () => {
    const query = mentionQuery('@An', 3, members)!
    expect(insertMention('@An', query, 'Anna')).toEqual({ value: '@Anna ', cursor: 6 })
  })
})

describe('reply bubbles', () => {
  it('honours explicit separators', () => {
    expect(splitBotReply(`one\n${BOT_MESSAGE_BREAK}\ntwo`)).toEqual(['one', 'two'])
  })

  it('never splits fenced code or structured markdown', () => {
    const code = 'Here:\n\n```js\nconst a = 1\n\nconst b = 2\n```'
    expect(splitBotReply(code)).toHaveLength(2)
    expect(splitBotReply('- one\n\n- two')).toHaveLength(1)
  })

  it('caps a turn at four bubbles', () => {
    expect(splitBotReply(['a', 'b', 'c', 'd', 'e'].join('\n\n'))).toHaveLength(4)
  })
})

describe('group dispatch', () => {
  it('routes explicit mentions without the controller', () => {
    expect(explicitGroupDecision('@Ann @Anna go', group, 'u1')).toEqual({
      mode: 'parallel',
      memberIds: ['a', 'b'],
      triggerMessageIds: ['u1']
    })
    expect(explicitGroupDecision('no address here', group, 'u1')).toBeNull()
  })

  it('rejects a decision that names an unknown member or message', () => {
    const context = { messages: [{ id: 'u1', role: 'user' as const, content: 'hi' }], privateDeliveries: [], completedTurns: [] }
    expect(() => validateGroupDecision({ mode: 'single', memberIds: ['zz'], triggerMessageIds: ['u1'] }, group, context)).toThrow()
    expect(() => validateGroupDecision({ mode: 'single', memberIds: ['a'], triggerMessageIds: ['nope'] }, group, context)).toThrow()
    expect(validateGroupDecision({ mode: 'none', memberIds: [], triggerMessageIds: [] }, group, context).mode).toBe('none')
  })

  it('puts the lead in front of the controller route, then stops on none', async () => {
    const user: GroupMessage = { id: 'u1', role: 'user', content: 'plan the launch' }
    const spoke: string[] = []
    const decide = vi
      .fn()
      .mockResolvedValueOnce({ mode: 'single', memberIds: ['b'], triggerMessageIds: ['u1'] })
      .mockResolvedValue({ mode: 'none', memberIds: [], triggerMessageIds: [] })
    const result = await runGroupConversation({
      group,
      user,
      signal: new AbortController().signal,
      decide,
      reply: async (member, turn) => {
        spoke.push(member.id)
        return [{ id: `${member.id}:${turn.round}`, role: 'assistant', sender: { id: member.id, name: member.name }, content: 'done' }]
      }
    })

    expect(spoke).toEqual(['a', 'b'])
    expect(result).toEqual({ limited: false, failed: false, unavailableMemberIds: [] })
  })

  it('fails over to another member when one cannot reply', async () => {
    const user: GroupMessage = { id: 'u1', role: 'user', content: '@Ann take this' }
    const spoke: string[] = []
    const result = await runGroupConversation({
      group,
      user,
      signal: new AbortController().signal,
      decide: async () => ({ mode: 'none', memberIds: [], triggerMessageIds: [] }),
      reply: async (member, turn) => {
        spoke.push(member.id)
        if (member.id === 'a') return { messages: [], failed: true }
        return [{ id: `${member.id}:${turn.round}`, role: 'assistant', sender: { id: member.id, name: member.name }, content: 'ok' }]
      }
    })

    expect(spoke[0]).toBe('a')
    expect(spoke).toContain('b')
    expect(result.failed).toBe(false)
    expect(result.unavailableMemberIds).toEqual(['a'])
  })

  it('isolates every member session per group topic', () => {
    expect(groupMemberSessionId('g', 'a', 't1')).not.toBe(groupMemberSessionId('g', 'a', 't2'))
  })
})

describe('private and agent-to-agent transport', () => {
  it('removes private blocks from the public text', () => {
    const parsed = parsePrivateReply('public [[private:b]]secret[[/private]] tail')
    expect(parsed.publicText).toBe('public  tail')
    expect(parsed.deliveries).toEqual([{ to: 'b', content: 'secret' }])
  })

  it('withholds a partially streamed opening marker', () => {
    expect(parsePrivateReply('visible [[priv').publicText).toBe('visible ')
    expect(parsePrivateReply('visible [[priv').incomplete).toBe(true)
  })

  it('drops every delivery when one recipient is unknown', () => {
    const delivery = privateReplyDeliveries('[[private:nobody]]hi[[/private]]', members[0], members, 'r1')
    expect(delivery.invalid).toBe(true)
    expect(delivery.messages).toHaveLength(0)
  })

  it('accepts the human as a private address', () => {
    const delivery = privateReplyDeliveries('[[private:human]]just for you[[/private]]', members[0], members, 'r1', 't1')
    expect(delivery.messages).toHaveLength(1)
    expect(delivery.messages[0].recipient.id).toBe('human')
    expect(delivery.messages[0].topicId).toBe('t1')
  })

  it('accepts only opaque ids for agent-to-agent delivery', () => {
    expect(a2aReplyMessages('[[a2a:b]]look at this[[/a2a]]', members[0], members.slice(1), 'r1').messages).toHaveLength(1)
    expect(a2aReplyMessages('[[a2a:Anna]]look at this[[/a2a]]', members[0], members.slice(1), 'r1').invalid).toBe(true)
  })
})

describe('inbox preview', () => {
  it('flattens markdown into one line', () => {
    expect(markdownPreview('# Title\n\n- one `code`\n- [two](https://x.dev)')).toBe('Title one code two')
  })

  it('shows the newest bot line with its speaker', () => {
    const preview = latestAssistantPreview([
      { authorId: 'user', authorName: 'You', text: 'hi', createdAt: 1 },
      { authorId: 'a', authorName: 'Ann', text: '**done**', createdAt: 2 }
    ])
    expect(preview).toEqual({ text: 'done', authorId: 'a', authorName: 'Ann' })
  })
})

describe('contact index', () => {
  it('files Han names under their pinyin initial', () => {
    expect(contactSection('张小鱼')).toBe('Z')
    expect(contactSection('欧阳智')).toBe('O')
    expect(contactSection('李木')).toBe('L')
    expect(contactSection('阿明')).toBe('A')
  })

  it('files latin names under their own letter and everything else under #', () => {
    expect(contactSection('nova')).toBe('N')
    expect(contactSection('  Dobi')).toBe('D')
    expect(contactSection('🤖 helper')).toBe('#')
    expect(contactSection('')).toBe('#')
  })

  it('builds sections in index order with # last', () => {
    const sections = contactSections([
      { id: '1', name: '张小鱼' },
      { id: '2', name: 'Nova' },
      { id: '3', name: '+1 bot' },
      { id: '4', name: 'nine' },
      { id: '5', name: '欧阳智' }
    ])
    expect(sections.map((section) => section.letter)).toEqual(['N', 'O', 'Z', '#'])
    expect(sections[0].contacts.map((contact) => contact.name)).toEqual(['nine', 'Nova'])
  })

  it('matches a search query case-insensitively', () => {
    expect(matchesContactQuery('Nova', 'nov')).toBe(true)
    expect(matchesContactQuery('Nova', '  ')).toBe(true)
    expect(matchesContactQuery('Nova', 'lin')).toBe(false)
  })
})

describe('summarizeRuntimeError', () => {
  const codexDump =
    'Codex: :"ef5a1e03","to":"everyone","content":"Hey"}],"completedTurns":[] ' +
    'ERROR: Reconnecting... 1/5 ERROR: Reconnecting... 2/5 ERROR: Reconnecting... 3/5 ' +
    'ERROR: unexpected status 401 Unauthorized: CC Switch local proxy failed while handling ' +
    'Codex endpoint /responses. Provider: OpenRouter; model: gpt-5.2; upstream_status: HTTP 401; ' +
    'cause: User not found., url: http://127.0.0.1:5000/v1/responses ' +
    'ERROR: unexpected status 401 Unauthorized: CC Switch local proxy failed while handling ' +
    'Codex endpoint /responses. Provider: OpenRouter; model: gpt-5.2; upstream_status: HTTP 401; ' +
    'cause: User not found., url: http://127.0.0.1:5000/v1/responses'

  it('reduces a CLI dump to one actionable line and keeps the original', () => {
    const { title, detail } = summarizeRuntimeError(codexDump)
    expect(title).toBe(
      'The model endpoint rejected the request · HTTP 401 · OpenRouter · gpt-5.2 · User not found · after 3 retries'
    )
    // The echoed transcript never reaches the headline.
    expect(title).not.toContain('completedTurns')
    expect(detail).toBe(codexDump)
  })

  it('names the common transport and status failures', () => {
    expect(summarizeRuntimeError('ERROR: fetch failed ECONNREFUSED 127.0.0.1:8080').title).toContain(
      'Could not reach the model endpoint'
    )
    expect(summarizeRuntimeError('ERROR: unexpected status 429 Too Many Requests').title).toContain(
      'rate limiting'
    )
    expect(summarizeRuntimeError('ERROR: unexpected status 503 Service Unavailable').title).toContain(
      'server error'
    )
    expect(summarizeRuntimeError('ERROR: Reconnecting... 1/5 ERROR: Reconnecting... 2/5').title).toBe(
      'Lost the connection to the model endpoint · after 2 retries'
    )
  })

  it('passes a plain message through and never returns an empty headline', () => {
    expect(summarizeRuntimeError('Dobi finished without a text response.').title).toBe(
      'Dobi finished without a text response'
    )
    expect(summarizeRuntimeError('   ').title).toBe('The conversation could not finish.')
  })

  it('caps a runaway headline', () => {
    const { title } = summarizeRuntimeError('x'.repeat(500))
    expect(title.length).toBeLessThanOrEqual(180)
    expect(title.endsWith('…')).toBe(true)
  })
})
