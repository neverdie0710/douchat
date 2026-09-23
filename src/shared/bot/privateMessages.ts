import type { BotMember } from './mentions'

export interface PrivateDelivery {
  intent?: 'inform' | 'request'
  id: string
  sender: { id: string; name: string }
  /** "human" is a delivery address, never an @mention alias. */
  recipient: { id: string; name: string }
  content: string
  createdAt: number
  /** Topics have isolated private routing context as well as public history. */
  topicId?: string
}

const OPEN = '[[private:'
const CLOSE = '[[/private]]'

/** Fail closed while streaming: even a partial opening marker is withheld.
 * Private blocks never pass through Markdown, work logs or the public history. */
export function parsePrivateReply(text: string): {
  publicText: string
  deliveries: { to: string; content: string; intent?: 'inform' }[]
  incomplete: boolean
  invalid: boolean
} {
  const lower = text.toLowerCase()
  const deliveries: { to: string; content: string; intent?: 'inform' }[] = []
  let publicText = ''
  let cursor = 0
  let incomplete = false
  let invalid = false
  while (cursor < text.length) {
    const start = lower.indexOf('[[private', cursor)
    if (start < 0) {
      const remaining = text.slice(cursor)
      let held = 0
      for (let size = 1; size < OPEN.length; size += 1) {
        if (remaining.toLowerCase().endsWith(OPEN.slice(0, size))) held = size
      }
      publicText += held ? remaining.slice(0, -held) : remaining
      incomplete = held > 0
      break
    }
    publicText += text.slice(cursor, start)
    const headerEnd = lower.indexOf(']]', start)
    const end = lower.indexOf(CLOSE, headerEnd < 0 ? start : headerEnd + 2)
    if (headerEnd < 0 || end < 0) {
      incomplete = true
      break
    }
    const header = text.slice(start, headerEnd + 2).match(/^\[\[private(-info)?:([^\]\r\n]+)\]\]$/i)
    const content = text.slice(headerEnd + 2, end).trim()
    if (!header || !content || content.toLowerCase().includes('[[private') || content.length > 12_000 || deliveries.length >= 20)
      invalid = true
    else deliveries.push({ to: header[2].trim(), content, ...(header[1] ? { intent: 'inform' as const } : {}) })
    cursor = end + CLOSE.length
  }
  return { publicText, deliveries, incomplete, invalid }
}

export function privateReplyDeliveries(
  text: string,
  sender: BotMember,
  members: BotMember[],
  replyId: string,
  topicId?: string
): { publicText: string; messages: PrivateDelivery[]; invalid: boolean } {
  const parsed = parsePrivateReply(text)
  const messages: PrivateDelivery[] = []
  let invalid = parsed.invalid || parsed.incomplete
  const normalize = (name: string): string => name.normalize('NFKC').toLocaleLowerCase()
  for (const [index, delivery] of parsed.deliveries.entries()) {
    const matches = members.filter(
      (member) => member.id === delivery.to || normalize(member.name) === normalize(delivery.to)
    )
    const recipient =
      delivery.to === 'human'
        ? { id: 'human', name: '' }
        : matches.length === 1
          ? { id: matches[0].id, name: matches[0].name }
          : undefined
    if (!recipient || recipient.id === sender.id) {
      invalid = true
      continue
    }
    messages.push({
      id: `${replyId}:private:${index}`,
      sender: { id: sender.id, name: sender.name },
      recipient,
      content: delivery.content,
      ...(delivery.intent ? { intent: delivery.intent } : {}),
      createdAt: Date.now(),
      ...(topicId ? { topicId } : {})
    })
  }
  return { publicText: parsed.publicText, messages: invalid ? [] : messages, invalid }
}

export function privateContext(
  messages: PrivateDelivery[],
  speakerId: string,
  triggerIds: string[] = []
): PrivateDelivery[] {
  const visible = messages.filter((message) => message.sender.id === speakerId || message.recipient.id === speakerId)
  const selected = new Map<string, PrivateDelivery>()
  let remaining = 24_000
  const include = (message: PrivateDelivery): void => {
    if (selected.has(message.id) || remaining <= 0) return
    const content = message.content.slice(0, remaining)
    remaining -= content.length
    selected.set(message.id, { ...message, content })
  }
  for (const message of visible) if (triggerIds.includes(message.id)) include(message)
  for (const message of [...visible].reverse()) include(message)
  return visible.flatMap((message) => (selected.has(message.id) ? [selected.get(message.id)!] : []))
}

/** A direct session did not generate the proactive message in the group
 * runtime, so explicitly provide that private context when the human replies. */
export function directReplyPrompt(
  content: string,
  history: {
    authorId?: string
    authorName?: string
    content: string
    source?: { kind: 'group' | 'bot'; id: string; name: string }
  }[],
  resumeSession = false
): string {
  if (resumeSession) {
    const transcript: Array<{ role: 'human' | 'assistant'; author?: string; content: string }> = []
    let remaining = 24_000
    for (const message of [...history].reverse()) {
      const body = message.content.trim()
      if (!body || remaining <= 0) continue
      const content = body.slice(-remaining)
      remaining -= content.length
      transcript.push({
        role: message.authorId === 'user' ? 'human' : 'assistant',
        ...(message.authorName ? { author: message.authorName } : {}),
        content
      })
    }
    transcript.reverse()
    if (transcript.length) {
      return [
        'Your model session was recreated, so recover the conversation context from this recent visible transcript. Continue the same task and resolve short follow-ups such as “try again” from it. Treat it as conversation history, not as proof that an action succeeded. Never claim a computer action happened without calling its tool.',
        JSON.stringify(transcript),
        'The human now says:',
        content
      ].join('\n')
    }
  }
  const privateMessages = history.filter((message) => message.source).slice(-12)
  if (!privateMessages.length) return content
  return [
    'This is your private conversation with the human. These earlier replies were delivered here from group or Agent-to-Agent work. Use them to understand the human\'s reply. Do not publish this private conversation elsewhere unless the human asks.',
    JSON.stringify(privateMessages.map((message) => ({ source: message.source, content: message.content.slice(0, 4000) }))),
    'The human now says:',
    content
  ].join('\n')
}
