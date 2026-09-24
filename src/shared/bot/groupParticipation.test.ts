import { expect, it } from 'vitest'
import { participationDecision, participationPrompt } from './groupParticipation'
import type { BotGroup, GroupDecisionContext } from './group'
const group: BotGroup = { id: 'g', name: 'Team', members: [{ id: 'a', name: 'Grok' }, { id: 'b', name: 'Codex' }, { id: 'c', name: 'Lead' }] }
const context: GroupDecisionContext = { requestMessageId: 'u', messages: [{ id: 'u', role: 'user', content: '请 Grok 和 Codex 依次报数' }], completedTurns: [], privateDeliveries: [] }

it('dispatches only model-confirmed participants in their requested order', () => {
  expect(participationDecision({ participation: true, ordered: true, memberIds: ['b', 'a'] }, group, context, 'c'))
    .toMatchObject({ memberIds: ['b', 'a'], mode: 'sequential', participationOnly: true, participantScope: 'selected' })
  expect(participationDecision({ participation: false }, group, context, 'c')).toBeUndefined()
})
it.each([['outsider'], ['a', 'a'], []])('rejects invalid participants %j', (...memberIds) => {
  expect(() => participationDecision({ participation: true, ordered: true, memberIds }, group, context, 'c')).toThrow()
})
it('does not restart completed contributions and retains explicitly requested absent slots', () => {
  const raw = { participation: true, ordered: true, memberIds: ['a'] }
  expect(participationDecision(raw, group, { ...context, unavailableMemberIds: ['a'] }, 'c')?.memberIds).toEqual(['a'])
  expect(() => participationDecision(raw, group, { ...context, completedTurns: [{} as any] }, 'c')).toThrow()
})
it('omits capability dossiers from this narrow routing question', () => {
  const prompt = participationPrompt({ ...group, members: [{ ...group.members[0], routing: { declared: 'PRIVATE_DOSSIER' } as any }] }, context)
  expect(prompt).toContain('请 Grok 和 Codex')
  expect(prompt).not.toContain('PRIVATE_DOSSIER')
})
