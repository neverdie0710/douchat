import type { BotMember } from './mentions'

export interface A2AMessage {
  id: string
  sender: { id: string; name: string }
  recipient: { id: string; name: string }
  content: string
  createdAt: number
}

const OPEN = '[[a2a:'
const CLOSE = '[[/a2a]]'

/** A delegated bot keeps continuity per source/target pair without borrowing
 * either bot's private direct session or any group-chat session. */
export function directA2ASessionId(sourceBotId: string, targetBotId: string, topicId?: string): string {
  const base = `a2a:${encodeURIComponent(sourceBotId)}:bot:${encodeURIComponent(targetBotId)}`
  return topicId ? `${base}:topic:${encodeURIComponent(topicId)}` : base
}

/** Hide transport envelopes from the visible reply, including a partial
 * opening marker while the response is still streaming. */
export function parseA2AReply(text: string): {
  publicText: string
  deliveries: { to: string; content: string }[]
  incomplete: boolean
  invalid: boolean
} {
  const lower = text.toLowerCase()
  const deliveries: { to: string; content: string }[] = []
  let publicText = ''
  let cursor = 0
  let incomplete = false
  let invalid = false
  while (cursor < text.length) {
    const start = lower.indexOf('[[a2a', cursor)
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
    const header = text.slice(start, headerEnd + 2).match(/^\[\[a2a:([^\]\r\n]+)\]\]$/i)
    const content = text.slice(headerEnd + 2, end).trim()
    if (!header || !content || content.toLowerCase().includes('[[a2a') || content.length > 12_000 || deliveries.length >= 8)
      invalid = true
    else deliveries.push({ to: header[1].trim(), content })
    cursor = end + CLOSE.length
  }
  return { publicText, deliveries, incomplete, invalid }
}

export function a2aReplyMessages(
  text: string,
  sender: BotMember,
  peers: BotMember[],
  replyId: string
): { publicText: string; messages: A2AMessage[]; invalid: boolean } {
  const parsed = parseA2AReply(text)
  let invalid = parsed.invalid || parsed.incomplete
  const messages: A2AMessage[] = parsed.deliveries.flatMap((delivery, index) => {
    // Recipient intent belongs to the model. The transport layer accepts only
    // the opaque id it was given in availableBots; it never guesses names.
    const recipient = peers.find((peer) => peer.id === delivery.to)
    const normalizedName = recipient?.name.trim().normalize('NFKC').toLocaleLowerCase()
    const duplicateName =
      recipient &&
      peers.some(
        (peer) => peer.id !== recipient.id && peer.name.trim().normalize('NFKC').toLocaleLowerCase() === normalizedName
      )
    if (!recipient || recipient.id === sender.id || duplicateName) {
      invalid = true
      return []
    }
    return [
      {
        id: `${replyId}:a2a:${index}`,
        sender: { id: sender.id, name: sender.name },
        recipient: { id: recipient.id, name: recipient.name },
        content: delivery.content,
        createdAt: Date.now()
      }
    ]
  })
  return { publicText: parsed.publicText, messages: invalid ? [] : messages, invalid }
}

export function directA2ASourcePrompt(
  content: string,
  source: BotMember,
  peers: BotMember[],
  privateContextPrompt = ''
): string {
  if (!peers.length) return privateContextPrompt || content
  return [
    privateContextPrompt,
    'You can send a private Agent-to-Agent message to another bot in this workspace.',
    'You—not client-side name-matching rules—must infer which bot the human intends from the complete availableBots list and the conversation context. Names are arbitrary user input: never assume naming patterns, numeric suffixes, aliases, or prefixes.',
    'If exactly one bot is clearly intended, use that entry\'s exact opaque id with this transport syntax: [[a2a:RECIPIENT_ID]]message for that bot[[/a2a]]. Never put a display name, nickname, partial name, or invented value in RECIPIENT_ID.',
    'If the intent is unclear, no bot is a reliable match, or multiple bots could match—including bots with the same display name—do not emit any A2A envelope. Ask the human one concise question identifying the possible bots so they can clarify.',
    'Use A2A only when the human asks you to contact, tell, ask, reply to, or delegate to another bot. Resolve follow-up references from the conversation context. The app hides the envelope; put a short sending confirmation outside it only after choosing one unambiguous bot.',
    'Never claim this capability is unavailable. Never expose or quote the transport syntax to the human.',
    JSON.stringify({
      currentBot: { id: source.id, name: source.name },
      availableBots: peers.map((peer) => ({ id: peer.id, name: peer.name, description: peer.description ?? '' }))
    }),
    'Human request:',
    content
  ]
    .filter(Boolean)
    .join('\n')
}

export function directA2ATargetPrompt(delivery: A2AMessage, target: BotMember): string {
  return [
    'You received a private Agent-to-Agent message from another bot in this workspace.',
    `It came from ${JSON.stringify(delivery.sender.name)} for you, ${JSON.stringify(target.name)}.`,
    'Complete the request and respond directly to the human as yourself. Your response will be delivered to your own conversation inbox.',
    'Message:',
    delivery.content
  ].join('\n')
}
