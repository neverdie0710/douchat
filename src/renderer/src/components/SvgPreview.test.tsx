// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
vi.mock('../preferences', () => ({ t: (text: string) => text }))
import { sanitizeSvgMarkup } from './SvgPreview'

describe('SVG preview sanitization', () => {
  it('keeps drawing primitives and removes executable or remote content', () => {
    const svg = sanitizeSvgMarkup(`
      <svg viewBox="0 0 100 100" onload="alert(1)">
        <script>alert(1)</script>
        <foreignObject><iframe src="https://example.com"></iframe></foreignObject>
        <image href="https://example.com/tracker.png" />
        <circle cx="50" cy="50" r="40" fill="url(#paint)" onclick="alert(1)" />
      </svg>
    `)
    expect(svg).toContain('<circle')
    expect(svg).toContain('fill="url(#paint)"')
    expect(svg).not.toMatch(/script|foreignObject|iframe|image|onload|onclick|https:/i)
  })

  it('rejects non-SVG and malformed input', () => {
    expect(sanitizeSvgMarkup('<div>not svg</div>')).toBeNull()
    expect(sanitizeSvgMarkup('<svg><g></svg>')).toBeNull()
  })
})
