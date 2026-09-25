import type { Root, RootContent } from 'mdast'

/** Some document exports use a standalone <title> instead of a Markdown heading.
 * Convert only that block to text in an h1; never enable arbitrary HTML or touch code. */
export function remarkSkillTitles() {
  return (tree: Root) => {
    const visit = (parent: { children: RootContent[] }) => {
      parent.children = parent.children.map(node => {
        const value = node.type === 'html' ? node.value : node.type === 'paragraph'
          && node.children.every(child => child.type === 'text' || child.type === 'html')
          ? node.children.map(child => 'value' in child ? child.value : '').join('') : undefined
        const title = value?.match(/^\s*<title>\s*([^<>]+?)\s*<\/title>\s*$/i)
        if (title) return { type: 'heading', depth: 1, children: [{ type: 'text', value: title[1] }] }
        if ('children' in node) visit(node as { children: RootContent[] })
        return node
      })
    }
    visit(tree)
  }
}

/** Normalize the exporter's callout wrapper before Markdown parsing. Raw HTML
 * blocks otherwise swallow the Markdown inside. Fenced examples stay literal. */
export function normalizeSkillCallouts(source: string): string {
  const output: string[] = []
  let depth = 0
  let fence: { marker: string; length: number } | undefined
  const emit = (line: string) => output.push(`${'> '.repeat(depth)}${line}`)
  for (const line of source.split(/\r?\n/)) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence) {
      emit(line)
      if (delimiter && delimiter[1][0] === fence.marker && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = undefined
      continue
    }
    if (delimiter) {
      fence = { marker: delimiter[1][0], length: delimiter[1].length }
      emit(line)
      continue
    }
    const opening = /^ {0,3}<callout(?:\s+emoji=(?:"([^"<>]*)"|'([^'<>]*)'))?\s*>[ \t]*(.*)$/i.exec(line)
    let content = line
    if (opening) {
      emit('')
      depth++
      const emoji = opening[1] ?? opening[2]
      // Escape Markdown punctuation in attribute values; never interpret attributes as HTML.
      if (emoji) { emit(emoji.replace(/[\\`*_{}\[\]()#+.!<>|~-]/g, '\\$&')); emit('') }
      content = opening[3]
    }
    const closing = depth ? /^(.*?)<\/callout>\s*$/i.exec(content) : null
    if (closing) {
      emit(closing[1]); depth--; emit('')
    } else emit(content)
  }
  return output.join('\n')
}
