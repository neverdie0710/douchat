import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../preferences', () => ({
  t: (text: string) => text,
  tr: (text: string, values: Record<string, string | number>) => Object.entries(values).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
    text
  )
}))
import { MessageMarkdown, localFilePathFromHref, messageMarkdownControls, messageMarkdownPlugins } from './MessageMarkdown'
import { CodeArtifact } from './CodeArtifact'
const render = (text: string): string => renderToStaticMarkup(<MessageMarkdown text={text} />)

describe('message Markdown', () => {
  it('renders Chinese emphasis, lists and inline filenames', () => {
    const html = render('共找到 **23 个视频文件**：\n\n- **文稿 Documents（8 个）**：`App.mp4`、`App2.mp4`\n- **影片**：`movie.mov`')
    expect(html).toContain('<strong')
    expect(html).not.toContain('**')
    expect(html).toContain('<ul')
    expect(html).toContain('<li')
    expect(html).toContain('data-streamdown="inline-code">App.mp4</code>')
  })
  it('preserves code blocks and renders GFM tables in a scroll container', () => {
    const html = render('```js\nconst video = "App.mp4";\n```\n\n| 文件 | 数量 |\n| --- | --- |\n| 视频 | 23 |')
    expect(html).toContain('data-streamdown="code-block"')
    expect(html).toContain('data-language="js"')
    expect(html).toContain('markdown-table-scroll')
    expect(html).toContain('<table>')
  })
  it('collapses file-sized code into a compact artifact card', () => {
    const source = Array.from({ length: 20 }, (_, index) => `<div>row ${index + 1}</div>`).join('\n')
    const html = renderToStaticMarkup(<CodeArtifact code={source} language="html" isIncomplete={false} />)
    expect(html).toContain('data-streamdown="code-artifact"')
    expect(html).toContain('index.html')
    expect(html).toContain('20 lines')
    expect(html).not.toContain('data-streamdown="code-block-body"')
  })
  it('recognizes Mermaid and SVG fenced blocks as diagrams', () => {
    expect(messageMarkdownPlugins.mermaid?.language).toBe('mermaid')
    expect(messageMarkdownPlugins.renderers?.[0]?.language).toEqual(['svg', 'xml-svg'])
    expect(messageMarkdownPlugins.renderers?.[1]?.language).toContain('html')
    expect(messageMarkdownControls.mermaid).toEqual({ copy: false, download: false, fullscreen: true, panZoom: true })
    expect(render('```mermaid\nflowchart TD\n  A --> B\n```')).not.toContain('language-mermaid')
    expect(render('```svg\n<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" /></svg>\n```')).not.toContain('language-svg')
  })
  it('opens web links externally and excludes executable HTML and unsafe links', () => {
    const html = render('[文档](https://example.com)\n\n[unsafe](javascript:alert%281%29)\n\n<script>alert(1)</script>\n\n<iframe src="https://example.com"></iframe>')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<iframe')
  })
  it('renders verified local-file references as reopen controls', () => {
    const href = 'douchat-file:///Users/idoubi/Documents/技术顾问合作协议.docx'
    const html = render(`[技术顾问合作协议.docx](<${href}>)`)
    expect(html).toContain('message-local-file')
    expect(html).toContain('技术顾问合作协议.docx')
    expect(html).toContain('/Users/idoubi/Documents/技术顾问合作协议.docx')
    expect(localFilePathFromHref('douchat-file:///C:/Users/Alice/Documents/agreement.docx', 'win32'))
      .toBe('C:/Users/Alice/Documents/agreement.docx')
  })
})
