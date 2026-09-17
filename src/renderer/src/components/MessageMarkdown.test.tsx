import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MessageMarkdown } from './MessageMarkdown'
const render = (text: string): string => renderToStaticMarkup(<MessageMarkdown text={text} />)

describe('message Markdown', () => {
  it('renders Chinese emphasis, lists and inline filenames', () => {
    const html = render('共找到 **23 个视频文件**：\n\n- **文稿 Documents（8 个）**：`App.mp4`、`App2.mp4`\n- **影片**：`movie.mov`')
    expect(html).toContain('<strong')
    expect(html).not.toContain('**')
    expect(html).toContain('<ul')
    expect(html).toContain('<li')
    expect(html).toContain('<code>App.mp4</code>')
  })
  it('preserves code blocks and renders GFM tables in a scroll container', () => {
    const html = render('```js\nconst video = "App.mp4";\n```\n\n| 文件 | 数量 |\n| --- | --- |\n| 视频 | 23 |')
    expect(html).toContain('<pre>')
    expect(html).toContain('language-js')
    expect(html).toContain('markdown-table-scroll')
    expect(html).toContain('<table>')
  })
  it('opens web links externally and excludes executable HTML and unsafe links', () => {
    const html = render('[文档](https://example.com)\n\n[unsafe](javascript:alert%281%29)\n\n<script>alert(1)</script>\n\n<iframe src="https://example.com"></iframe>')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<iframe')
  })
})
