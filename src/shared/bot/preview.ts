const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeText(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
    if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? match
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '�'
  })
}

/** Flatten Markdown into one readable inbox line without links, images or HTML. */
export function markdownPreview(content: string): string {
  return decodeText(
    content
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/~~~[\s\S]*?~~~/g, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>\n]{1,200}>/g, ' ')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, '')
      .replace(/^\s*\|?[\s:|-]{4,}\|?\s*$/gm, ' ')
      .replace(/\|/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/(\*\*|__|\*|_|~~)/g, '')
  )
    .replace(/\s+/g, ' ')
    .trim()
}

export interface PreviewMessage {
  authorId: string
  authorName: string
  text: string
  createdAt: number
  kind?: string
  error?: string
}

/** The inbox row shows the newest bot line, attributed to its speaker. */
export function latestAssistantPreview(
  messages: readonly PreviewMessage[] = []
): { text: string; authorId: string; authorName: string } | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.authorId === 'user') continue
    const text = markdownPreview(message.text.trim() || message.error || '')
    if (text) return { text, authorId: message.authorId, authorName: message.authorName }
  }
  return undefined
}
