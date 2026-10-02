// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { SkillDetailDialog } from './SkillDetailDialog'
vi.mock('../preferences', () => ({ usePreferences: () => ({ language: 'en' }), resolveInterfaceLanguage: () => 'en' }))
let container: HTMLDivElement, root: Root
const copy = vi.fn().mockResolvedValue(undefined), close = vi.fn()
beforeEach(async () => {
  vi.clearAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
  Object.defineProperty(window, 'douchat', { configurable: true, value: { copyText: copy } })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root.render(<SkillDetailDialog skill={{ id: 'test', name: 'test', enabled: true, content: '---\nname: test\ndescription: Sample\n---\n# Skill heading\n\n**Read** the guide.\n\n| Stage | Action |\n| --- | --- |\n| First | Review |\n| Next | Ship |\n\n## Delivery\n\nFollowing the table.', files: [
    { path: 'scripts/run.py', data: btoa('print("hello")') },
    { path: 'references/guide.md', data: btoa('# Guide\n\nExample') },
    { path: 'assets/icon.bin', data: 'AP8=' },
    { path: 'references/export.md', data: btoa('<title>First value</title>\n\n> Source reference\n\n## Metrics\n\nNormal text.\n\n```html\n<title>Code example</title>\n```') }
  ] }} onClose={close} />))
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks() })
async function click(selector: string) { await act(async () => document.querySelector<HTMLButtonElement>(selector)!.click()) }
it('renders Markdown and frontmatter, switches nested files, and collapses folders', async () => {
  expect(document.querySelector('.skill-markdown h1')?.textContent).toBe('Skill heading')
  expect(document.querySelector('.skill-yaml-key')?.textContent).toBe('name:')
  await click('[title="scripts/run.py"]')
  expect(document.querySelector('.skill-code-content')?.textContent).toBe('print("hello")')
  await click('[aria-label="Copy file"]')
  expect(copy).toHaveBeenCalledWith('print("hello")')
  await click('[title="scripts"]')
  expect(document.querySelector('.skill-files [title="scripts/run.py"]')).toBeNull()
  await click('[title="references/guide.md"]')
  expect(document.querySelector('.skill-markdown h1')?.textContent).toBe('Guide')
})
it('shows a fallback for binary files and closes with the back button', async () => {
  await click('[title="assets/icon.bin"]')
  expect(document.querySelector('.skill-file-unavailable')?.textContent).toContain('cannot be previewed')
  expect(document.querySelector('[aria-label="Copy file"]')).toBeNull()
  expect(document.querySelector('[aria-label="Download skill ZIP"]')).not.toBeNull()
  await click('[aria-label="Back to skills"]')
  expect(close).toHaveBeenCalledOnce()
})
it('switches between preview and exact source, defaults code to source, and copies the whole current file', async () => {
  const modeButton = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.skill-view-modes button')].find(button => button.textContent === label)!
  expect(modeButton('Preview').getAttribute('aria-pressed')).toBe('true')
  await act(async () => modeButton('Source').click())
  expect(document.querySelector('.skill-markdown')).toBeNull()
  const source = document.querySelector('.skill-code-content')!.textContent!
  expect(source).toContain('---\nname: test')
  expect(source).toContain('**Read** the guide.')
  await click('.skill-file-toolbar [aria-label="Copy file"]')
  expect(copy).toHaveBeenLastCalledWith(source)
  expect(document.querySelector('.skill-detail-header [aria-label="Copy file"]')).toBeNull()
  await click('[title="scripts/run.py"]')
  expect(modeButton('Source').getAttribute('aria-pressed')).toBe('true')
  expect(modeButton('Preview').disabled).toBe(true)
  await click('[title="references/guide.md"]')
  expect(modeButton('Preview').getAttribute('aria-pressed')).toBe('true')
  expect(document.querySelector('.skill-markdown h1')?.textContent).toBe('Guide')
})

it('downloads the complete skill ZIP with original paths and binary resources', async () => {
  const createURL = vi.fn((_blob: Blob) => 'blob:skill-zip')
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  let downloadName = ''
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloadName = this.download })
  await click('[title="scripts/run.py"]')
  await click('[aria-label="Download skill ZIP"]')
  await act(async () => { await vi.waitFor(() => expect(createURL).toHaveBeenCalledOnce()) })
  const blob = createURL.mock.calls[0][0] as Blob
  expect(blob.type).toBe('application/zip')
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob)
  })
  const files = unzipSync(new Uint8Array(buffer))
  expect(strFromU8(files['SKILL.md'])).toContain('# Skill heading')
  expect(strFromU8(files['scripts/run.py'])).toBe('print("hello")')
  expect(strFromU8(files['references/guide.md'])).toBe('# Guide\n\nExample')
  expect(Array.from(files['assets/icon.bin'])).toEqual([0, 255])
  expect(downloadName).toBe('test.zip')
})

it('uses a normal-flow table wrapper before subsequent content', () => {
  const markdown = document.querySelector('.skill-markdown')!
  const wrapper = markdown.querySelector('.skill-table-scroll')!
  expect(wrapper.querySelectorAll('tbody tr')).toHaveLength(2)
  expect(markdown.querySelector('[data-streamdown="table-wrapper"]')).toBeNull()
  expect(wrapper.getAttribute('style')).toBeNull()
  const heading = markdown.querySelector('h2')!
  expect(heading.textContent).toBe('Delivery')
  expect(wrapper.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('renders exported title blocks as headings while preserving code examples and source copying', async () => {
  await click('[title="references/export.md"]')
  expect(document.querySelector('.skill-markdown h1')?.textContent).toBe('First value')
  expect(document.querySelector('.skill-markdown blockquote')?.textContent).toContain('Source reference')
  expect(document.querySelector('.skill-markdown pre')?.textContent).toContain('<title>Code example</title>')
  await click('[aria-label="Copy file"]')
  expect(copy.mock.calls.at(-1)?.[0]).toContain('<title>First value</title>')
})

it('renders exported callouts with Markdown blocks and preserves literal code', async () => {
  const content = '<callout emoji="💡">\nA **strong** observation.\n\n## Trigger strength\n\n> A quoted insight.\n\n- First example\n- Second example\n\n```html\n<callout emoji="x">literal example</callout>\n```\n</callout>\n\n<callout emoji="⚽">\n## Positioning\n\nAnother **callout**.\n</callout>\n\n## Outside'
  await act(async () => root.render(<SkillDetailDialog skill={{ id: 'callouts', name: 'callouts', enabled: true, content }} onClose={close} />))
  const markdown = document.querySelector('.skill-markdown')!
  const callouts = markdown.querySelectorAll(':scope > blockquote')
  expect(callouts).toHaveLength(2)
  expect(callouts[0].textContent).toContain('💡')
  expect(callouts[0].querySelector('h2')?.textContent).toBe('Trigger strength')
  expect(callouts[0].querySelector('strong')?.textContent).toBe('strong')
  expect(callouts[0].querySelectorAll('li')).toHaveLength(2)
  expect(callouts[0].querySelector('blockquote')?.textContent).toContain('A quoted insight.')
  expect(callouts[0].querySelector('pre')?.textContent).toContain('<callout emoji="x">literal example</callout>')
  expect(callouts[1].querySelector('h2')?.textContent).toBe('Positioning')
  expect(markdown.querySelector(':scope > h2')?.textContent).toBe('Outside')
  await click('[aria-label="Copy file"]')
  expect(copy).toHaveBeenLastCalledWith(content)
})

it('loads resource files that the app snapshot left out', async () => {
  const getAgentSkill = vi.fn().mockResolvedValue({ id: 'tool', name: 'tool', enabled: true, content: 'Stored', files: [{ path: 'notes.txt', data: btoa('Loaded on demand') }] })
  Object.defineProperty(window, 'douchat', { configurable: true, value: { copyText: copy, getAgentSkill } })
  await act(async () => root.render(<SkillDetailDialog skill={{ id: 'tool', name: 'tool', enabled: true, content: 'Listed', filesOmitted: true }} agentId="agent-1" onClose={close} />))
  expect(getAgentSkill).toHaveBeenCalledWith('agent-1', 'tool')
  expect(document.querySelector('[role="status"]')).toBeNull()
  await click('[title="notes.txt"]')
  expect(document.querySelector('.skill-file-preview')?.textContent).toContain('Loaded on demand')
})

it('highlights source safely and keeps line numbers separate from copied content', async () => {
  const content = 'def greet():\n    print("<img src=x onerror=alert(1)>")\n\n    return 42\n'
  await act(async () => root.render(<SkillDetailDialog skill={{ id: 'code', name: 'code', enabled: true, content: '', files: [{ path: 'script.py', data: btoa(content) }] }} onClose={close} />))
  await click('[title="script.py"]')
  expect(document.querySelector('.skill-code-content')?.textContent).toBe(content)
  expect(document.querySelector('.skill-code-content .hljs-keyword')?.textContent).toBe('def')
  expect(document.querySelector('.skill-code-content img')).toBeNull()
  expect([...document.querySelectorAll('.skill-code-gutter')].map(row => row.getAttribute('data-line'))).toEqual(['1', '2', '3', '4', '5'])
  expect(document.querySelector('.skill-code-gutter')?.getAttribute('aria-hidden')).toBe('true')
  await click('[aria-label="Copy file"]')
  expect(copy).toHaveBeenLastCalledWith(content)
})
