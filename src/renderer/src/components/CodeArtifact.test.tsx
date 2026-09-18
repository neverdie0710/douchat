// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
vi.mock('../preferences', () => ({ t: (text: string) => text, tr: (text: string) => text, usePreferences: vi.fn() }))
import { inferArtifactName, isFileSizedCode } from './CodeArtifact'
import { secureHtmlDocument } from './CodeArtifactWindow'

describe('code artifacts', () => {
  it('keeps small examples inline and treats long or named blocks as files', () => {
    expect(isFileSizedCode('const answer = 42')).toBe(false)
    expect(isFileSizedCode(Array.from({ length: 18 }, () => 'line').join('\n'))).toBe(true)
    expect(isFileSizedCode('short', 'filename="demo.ts"')).toBe(true)
  })

  it('uses safe basename metadata and sensible language extensions', () => {
    expect(inferArtifactName('typescript')).toBe('index.ts')
    expect(inferArtifactName('html', 'filename="examples/tetris.html"')).toBe('tetris.html')
  })

  it('injects a restrictive policy before previewing HTML', () => {
    const output = secureHtmlDocument('<html><head><meta http-equiv="refresh" content="0; https://example.com"><title>Demo</title></head><body><script>fetch("https://example.com")</script></body></html>')
    const document = new DOMParser().parseFromString(output, 'text/html')
    const policy = document.head.querySelector('meta[http-equiv="Content-Security-Policy"]')
    expect(document.head.firstElementChild).toBe(policy)
    expect(policy?.getAttribute('content')).toContain("default-src 'none'")
    expect(policy?.getAttribute('content')).toContain("connect-src 'none'")
    expect(policy?.getAttribute('content')).toContain("form-action 'none'")
    expect(document.querySelector('meta[http-equiv="refresh"]')).toBeNull()
  })
})
