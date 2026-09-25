import { useMemo } from 'react'
import hljs from 'highlight.js/lib/common'

// Carry multiline token spans across visual rows without changing the source text.
function highlightedLines(html: string): string[] {
  const spans: string[] = []
  return html.split('\n').map(line => {
    const opening = spans.join('')
    for (const match of line.matchAll(/<\/?span\b[^>]*>/g)) {
      if (match[0].startsWith('</')) spans.pop()
      else spans.push(match[0])
    }
    return opening + line + '</span>'.repeat(spans.length)
  })
}

export function SkillSourceCode({ source, path }: { source: string; path: string }) {
  const language = path.split('.').at(-1)?.toLowerCase() ?? ''
  const highlighted = useMemo(() => {
    // Keep large files responsive and unknown formats readable without guessing.
    if (source.length > 100_000 || !hljs.getLanguage(language)) return undefined
    try { return hljs.highlight(source, { language, ignoreIllegals: true }).value }
    catch { return undefined }
  }, [source, language])
  const lines = useMemo(() => highlighted === undefined ? source.split('\n') : highlightedLines(highlighted), [source, highlighted])
  return <div className="skill-code-view">
    <pre className="skill-code-content"><code>{lines.map((line, index) => <span className="skill-code-line" key={index}>
      <span className="skill-code-gutter" aria-hidden="true" data-line={index + 1} />
      <span className="skill-code-text">{highlighted === undefined ? line : <span dangerouslySetInnerHTML={{ __html: line }} />}{index < lines.length - 1 ? '\n' : ''}</span>
    </span>)}</code></pre>
  </div>
}
