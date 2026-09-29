import { describe, it, expect } from 'vitest'
import { updateSelectedMentions, resolveMentionedMembers } from './mentions'

describe('selected mentions', () => {
  const mention = { id: 'second', name: 'Alex', start: 0, end: 5 }
  const members = [{ id: 'first', name: 'Alex' }, { id: 'second', name: 'Alex' }]
  it('moves ranges with surrounding edits and drops edited mentions', () => {
    expect(updateSelectedMentions('@Alex help', 'Hi @Alex help', [mention])).toEqual([{ ...mention, start: 3, end: 8 }])
    expect(updateSelectedMentions('@Alex help', '@Alex please help', [mention])).toEqual([mention])
    expect(updateSelectedMentions('@Alex help', '@Alexa help', [mention])).toEqual([mention])
    expect(resolveMentionedMembers('@Alexa help', members, [mention])).toEqual([])
    expect(updateSelectedMentions('@Alex help', '@Al help', [mention])).toEqual([])
    expect(updateSelectedMentions('@Alex help', 'help', [mention])).toEqual([])
  })
  it('does not turn quoted or code mentions into recipients', () => {
    expect(resolveMentionedMembers('> @Alex', members, [{ ...mention, start: 2, end: 7 }])).toEqual([])
    expect(resolveMentionedMembers('`@Alex`', members, [{ ...mention, start: 1, end: 6 }])).toEqual([])
    expect(resolveMentionedMembers('@Alex', members, [mention])).toEqual([members[1]])
  })
})
