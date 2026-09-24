import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'

type Style = 'bold' | 'italic' | 'strikethrough' | 'code' | 'pre'
interface Span { text: string; styles: Style[]; url?: string }
interface Node { type: string; children?: Node[]; value?: string; url?: string; alt?: string | null; identifier?: string; ordered?: boolean | null; start?: number | null; checked?: boolean | null }
export interface IMFormattedMessage {
  text: string
  entities: { type: string; offset: number; length: number; url?: string }[]
  post: { zh_cn: { title: string; content: Record<string, unknown>[][] } }
}

/** Parse before splitting so formatting, links and code survive message limits. */
export function formatIMMessages(markdown: string, limit = 3500, plain = false): IMFormattedMessage[] {
  if (limit < 2) throw new Error('Message limit must be at least 2')
  // Desktop links intentionally accept spaces in angle-bracketed local paths.
  const input = markdown.replace(/\]\(<((?:douchat-file|file):[^>]+)>\)/gi, (_match, url: string) => `](<${encodeURI(url)}>)`)
  const root: Node = fromMarkdown(input, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  const definitions = new Map<string, Node>()
  const collect = (node: Node) => { if (node.type === 'definition' && node.identifier) definitions.set(node.identifier, node); node.children?.forEach(collect) }
  collect(root)
  const spans: Span[] = []
  const add = (text: string, styles: Style[] = [], url?: string) => { if (text) spans.push({ text, styles, url }) }
  const children = (node: Node, styles: Style[], url?: string) => node.children?.forEach(child => render(child, styles, url))
  const render = (node: Node, styles: Style[] = [], url?: string): void => {
    switch (node.type) {
      case 'root': children(node, styles); break
      case 'text': {
        // Models sometimes leave whitespace before a closing bold delimiter.
        const pieces = (node.value ?? '').split(/(\*\*[^\n]+?\*\*)/g)
        for (const piece of pieces) {
          if (piece.startsWith('**') && piece.endsWith('**') && piece.length > 4) add(piece.slice(2, -2).trim(), [...styles, 'bold'], url)
          else add(piece, styles, url)
        }
        break
      }
      case 'strong': children(node, [...styles, 'bold'], url); break
      case 'emphasis': children(node, [...styles, 'italic'], url); break
      case 'delete': children(node, [...styles, 'strikethrough'], url); break
      case 'inlineCode': add(node.value ?? '', ['code']); break
      case 'code': add(node.value ?? '', ['pre']); add('\n\n'); break
      case 'heading': children(node, [...styles, 'bold']); add('\n\n'); break
      case 'paragraph': children(node, styles, url); add('\n\n'); break
      case 'break': add('\n'); break
      case 'link': case 'linkReference': case 'image': case 'imageReference': {
        const target = node.url ?? definitions.get(node.identifier ?? '')?.url ?? ''
        const local = /^(douchat-file|file):/i.test(target)
        const safe = /^(https?:|mailto:)/i.test(target) ? target : undefined
        if (local) add('📄 ')
        if (node.type.startsWith('image')) add(node.alt || '图片', styles, safe)
        else children(node, local ? ['code'] : styles, safe)
        break
      }
      case 'list':
        node.children?.forEach((item, index) => {
          add(node.ordered ? `${(node.start ?? 1) + index}. ` : '• ')
          if (typeof item.checked === 'boolean') add(item.checked ? '☑ ' : '☐ ')
          item.children?.forEach((part, partIndex) => {
            if (partIndex) add('\n  ')
            if (part.type === 'paragraph') children(part, styles)
            else render(part, styles)
          })
          add('\n')
        })
        add('\n'); break
      case 'blockquote': add('│ '); children(node, styles); break
      case 'thematicBreak': add('────────\n\n'); break
      case 'table':
        node.children?.forEach((row, index) => {
          row.children?.forEach((cell, column) => { if (column) add('  |  '); children(cell, index ? styles : [...styles, 'bold']) })
          add('\n')
        }); add('\n'); break
      case 'definition': break
      case 'html': if (!node.value?.startsWith('<!--')) add(node.value ?? ''); break
      default: if (node.children) children(node, styles, url); else add(node.value ?? '', styles, url)
    }
  }
  render(root)
  while (spans.length && !spans[0].text.trim()) spans.shift()
  while (spans.length && !spans.at(-1)!.text.trim()) spans.pop()
  if (spans.length) { spans[0].text = spans[0].text.trimStart(); spans.at(-1)!.text = spans.at(-1)!.text.trimEnd() }
  if (plain) {
    for (let i = spans.length - 1; i >= 0; i--) {
      const url = spans[i].url
      if (url && spans[i + 1]?.url !== url) {
        let label = spans[i].text
        for (let j = i - 1; j >= 0 && spans[j].url === url; j--) label = spans[j].text + label
        if (label !== url) spans.splice(i + 1, 0, { text: ` (${url})`, styles: [] })
      }
    }
  }
  const chunks: Span[][] = []; let chunk: Span[] = []; let size = 0
  for (const span of spans) {
    let remaining = span.text
    while (remaining) {
      let count = Math.min(remaining.length, limit - size)
      // Telegram offsets and limits use UTF-16; never cut a surrogate pair.
      if (count < remaining.length && /[\uD800-\uDBFF]/.test(remaining[count - 1] ?? '')) count--
      if (!count) { chunks.push(chunk); chunk = []; size = 0; continue }
      chunk.push({ ...span, text: remaining.slice(0, count) }); size += count; remaining = remaining.slice(count)
      if (size >= limit) { chunks.push(chunk); chunk = []; size = 0 }
    }
  }
  if (chunk.length) chunks.push(chunk)
  return chunks.filter(parts => parts.some(part => part.text.trim())).map(parts => {
    let text = ''
    const entities: IMFormattedMessage['entities'] = []
    const lines: Record<string, unknown>[][] = [[]]
    for (const part of parts) {
      const offset = text.length; text += part.text
      for (const type of [...new Set(part.styles)]) entities.push({ type, offset, length: part.text.length })
      if (part.url) entities.push({ type: 'text_link', offset, length: part.text.length, url: part.url })
      const style = part.styles.filter(type => type === 'bold' || type === 'italic' || type === 'strikethrough').map(type => type === 'strikethrough' ? 'lineThrough' : type)
      part.text.split('\n').forEach((line, index) => {
        if (index) lines.push([])
        if (line) lines.at(-1)!.push(part.url ? { tag: 'a', text: line, href: part.url } : { tag: 'text', text: line, ...(style.length ? { style } : {}) })
      })
    }
    return { text, entities: entities.slice(0, 100), post: { zh_cn: { title: '', content: lines.map(line => line.length ? line : [{ tag: 'text', text: ' ' }]) } } }
  })
}
