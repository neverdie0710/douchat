import { describe, expect, it } from 'vitest'
import { formatIMMessages } from './imFormatting'

describe('channel message formatting', () => {
  it('renders file lists without desktop URL or Markdown syntax', () => {
    const input = '**根目录下 2 个： **\n· [视频 1.mp4](<douchat-file:///Users/me/Downloads/视频 1.mp4>) — 16 MB\n· [other.mp4](<douchat-file:///Users/me/Downloads/other.mp4>) — 2 MB'
    const [message] = formatIMMessages(input)
    expect(message.text).toContain('根目录下 2 个：')
    expect(message.text).toContain('📄 视频 1.mp4 — 16 MB')
    expect(message.text).toContain('\n· 📄 other.mp4')
    expect(message.text).not.toMatch(/douchat-file|Users|\*\*|\]\(/)
    expect(message.entities.some(e => e.type === 'bold')).toBe(true)
    expect(message.entities.filter(e => e.type === 'code').map(e => message.text.slice(e.offset, e.offset + e.length))).toEqual(['视频 1.mp4', 'other.mp4'])
    expect(JSON.stringify(message.post)).not.toContain('douchat-file')
  })
  it('keeps external links and code literal contents', () => {
    const input = '**Bold** and *italic* and ~~gone~~\n\n[Website](https://example.com?a=1&b=2)\n\n```js\nconst x = "**literal** <tag>";\n```'
    const [message] = formatIMMessages(input)
    expect(message.entities.map(e => e.type)).toEqual(expect.arrayContaining(['bold', 'italic', 'strikethrough', 'text_link', 'pre']))
    expect(message.text).toContain('const x = "**literal** <tag>";')
    expect(message.entities.find(e => e.type === 'text_link')?.url).toBe('https://example.com?a=1&b=2')
    const [plain] = formatIMMessages(input, 3500, true)
    expect(plain.text).toContain('Website (https://example.com?a=1&b=2)')
  })
  it('preserves list structure, reference links and table contents', () => {
    const [message] = formatIMMessages('# Title\n\n- one\n- two\n\n[Docs][ref]\n\n[ref]: https://example.com\n\n| Name | Size |\n| --- | --- |\n| video | 16 MB |')
    expect(message.text).toContain('• one\n• two')
    expect(message.text).toContain('Name  |  Size\nvideo  |  16 MB')
    expect(message.entities.find(e => e.type === 'text_link')?.url).toBe('https://example.com')
  })
  it('uses UTF-16 entity offsets and splits without breaking emoji or formatting', () => {
    const parts = formatIMMessages('😀 **' + '文😀'.repeat(20) + '**', 16)
    expect(parts.map(p => p.text).join('')).toBe('😀 ' + '文😀'.repeat(20))
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) {
      expect(part.text.length).toBeLessThanOrEqual(16)
      expect(part.text).not.toMatch(/[\uD800-\uDFFF]/u)
      for (const entity of part.entities) expect(entity.offset + entity.length).toBeLessThanOrEqual(part.text.length)
    }
    expect(parts[0].entities[0].offset).toBe(3)
    expect(parts.at(-1)?.entities[0].type).toBe('bold')
  })
  it('never emits executable or local URLs as external links', () => {
    const [message] = formatIMMessages('[bad](javascript:alert) [file](file:///tmp/test) <b>literal</b>')
    expect(message.entities.some(e => e.type === 'text_link')).toBe(false)
    expect(message.text).toContain('bad 📄 file')
    expect(message.text).toContain('<b>literal</b>')
  })
})
