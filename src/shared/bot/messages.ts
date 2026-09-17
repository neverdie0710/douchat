export const BOT_MESSAGE_BREAK = '<!-- message_break -->'

const MAX_REPLY_MESSAGES = 4
const TARGET_REPLY_MESSAGE_LENGTH = 160
const MESSAGE_BREAK_PATTERN = /^\s*<!--\s*message_break\s*-->\s*$/i

const toggleCodeFence = (line: string, inCodeBlock: boolean): boolean =>
  /^\s{0,3}(?:`{3,}|~{3,})/.test(line) ? !inCodeBlock : inCodeBlock

function explicitReplyMessages(reply: string): string[] | null {
  const blocks: string[] = []
  let current: string[] = []
  let inCodeBlock = false
  let foundBreak = false
  const flush = (): void => {
    const value = current.join('\n').trim()
    if (value) blocks.push(value)
    current = []
  }
  for (const line of reply.trim().split('\n')) {
    if (!inCodeBlock && MESSAGE_BREAK_PATTERN.test(line)) {
      foundBreak = true
      flush()
      continue
    }
    current.push(line)
    inCodeBlock = toggleCodeFence(line, inCodeBlock)
  }
  flush()
  return foundBreak ? blocks : null
}

function replyParagraphs(reply: string): string[] {
  const blocks: string[] = []
  let current: string[] = []
  let inCodeBlock = false
  const flush = (): void => {
    const value = current.join('\n').trim()
    if (value) blocks.push(value)
    current = []
  }
  for (const line of reply.trim().split('\n')) {
    if (!line.trim() && !inCodeBlock) flush()
    else current.push(line)
    inCodeBlock = toggleCodeFence(line, inCodeBlock)
  }
  flush()
  return blocks
}

function hasStructuredMarkdown(reply: string): boolean {
  return reply
    .split('\n')
    .some(
      (line) =>
        /^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+|>\s+|#{1,6}\s+)/.test(line) ||
        /^\s*\|.*\|\s*$/.test(line) ||
        /^\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+$/.test(line)
    )
}

function splitLongReplyBlock(block: string): string[] {
  if (block.length <= TARGET_REPLY_MESSAGE_LENGTH || block.includes('```') || block.includes('~~~') || block.includes('\n'))
    return [block]
  const sentences = block
    .split(/(?<=[。！？!?；;])\s*|(?<=\.)\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
  if (sentences.length < 2) return [block]
  const parts: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > TARGET_REPLY_MESSAGE_LENGTH) {
      parts.push(current)
      current = sentence
    } else current = current ? `${current} ${sentence}` : sentence
  }
  if (current) parts.push(current)
  return parts
}

function limitReplyMessages(parts: string[]): string[] {
  if (parts.length <= MAX_REPLY_MESSAGES) return parts
  return [...parts.slice(0, MAX_REPLY_MESSAGES - 1), parts.slice(MAX_REPLY_MESSAGES - 1).join('\n\n')]
}

/** Split one model turn into conversational bubbles without breaking fenced
 * code. Explicit separators win; otherwise paragraphs and long prose provide
 * natural boundaries. */
export function splitBotReply(reply: string): string[] {
  const body = reply.trim()
  if (!body) return []
  const explicit = explicitReplyMessages(body)
  const automatic = hasStructuredMarkdown(body) ? [body] : replyParagraphs(body).flatMap(splitLongReplyBlock)
  const blocks = limitReplyMessages(explicit ?? automatic)
  return blocks.length ? blocks : [body]
}

/** Give every bot the same compact messenger response contract. */
export function botReplyPrompt(prompt: string): string {
  return [
    "Reply like a capable person in a messaging app. Match the human's language and answer directly.",
    'A simple answer is one compact message. A richer answer is usually 2–3 messages and never more than 4. Each message should carry one conversational beat and usually contain 1–3 short sentences.',
    `When separate bubbles improve the rhythm, put a line containing exactly ${BOT_MESSAGE_BREAK} between them. Keep code blocks, tables, and tightly related lists in one message. Never put the separator inside a code block or hidden transport block, quote it, or explain it.`,
    'Avoid unnecessary headings, repeated introductions, and generic offers to do more.',
    'Request and conversation context:',
    prompt
  ].join('\n')
}
