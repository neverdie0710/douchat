import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GrokStream } from './grokStream'
import { grokGeneratedImages, localAgentText } from './localAgentRuntime'
import { summarizeRuntimeError } from '../shared/bot/errors'

const sessionId = '01a0ceac-974d-7950-984c-7637568311b7'
const end = { type: 'end', stopReason: 'end_turn', sessionId }
const call = (id = 'image-1') => ({ type: 'tool_call', toolCallId: id, toolName: 'image_gen', status: 'pending' })
const line = (event: object) => JSON.stringify(event) + '\n'
const done = (path: string, id = 'image-1') => ({ type: 'tool_call_update', toolCallId: id, status: 'completed', rawOutput: { type: 'ImageGen', path } })

describe('Grok native progress stream', () => {
  it('handles chunk boundaries, image lifecycle and parallel tools without exposing thoughts or raw input', () => {
    const progress: string[] = []
    const stream = new GrokStream(detail => progress.push(detail))
    const wire = [
      { type: 'thought', data: 'private reasoning' },
      { ...call(), rawInput: { prompt: 'private input' } },
      { type: 'tool_call', toolCallId: 'read-1', toolName: 'read_file', status: 'pending' },
      { type: 'tool_call_update', toolCallId: 'read-1', status: 'completed', rawOutput: { content: 'secret file' } },
      { type: 'tool_call_update', toolCallId: 'image-1', status: null },
      done('/session/images/1.jpg'),
      { type: 'text', data: '图片好了' }, end
    ].map(line).join('').trimEnd()
    for (let i = 0; i < wire.length; i += 7) stream.push(wire.slice(i, i + 7))
    expect(stream.finish()).toEqual({ text: '图片好了', paths: ['/session/images/1.jpg'], sessionId })
    expect(progress.slice(0, 4)).toEqual(Array(4).fill('Generating an image; waiting for the tool result'))
    expect(progress.at(-1)).toBe('Image generated; preparing the result')
    expect(progress.join(' ')).not.toMatch(/private|secret/)
  })

  it('does not turn a model promise into image progress or an attachment', () => {
    const progress: string[] = []
    const stream = new GrokStream(detail => progress.push(detail))
    stream.push(line({ type: 'text', data: '正在画图 images/1.jpg' }) + line(end))
    expect(stream.finish().paths).toEqual([])
    expect(progress).toEqual([])
  })

  it('reports the real denied image call instead of returning the preamble as a successful reply', () => {
    const stream = new GrokStream()
    stream.push([
      { type: 'text', data: 'I will draw it now.' }, call(),
      { type: 'tool_call_update', toolCallId: 'image-1', status: 'failed', content: [
        { type: 'content', content: { type: 'text', text: 'User cancelled the execution for tool `image_gen`' } }
      ] }, { ...end, stopReason: 'cancelled' }
    ].map(line).join(''))
    expect(() => stream.finish()).toThrow('User cancelled the execution')
    expect(summarizeRuntimeError('Grok: Image generation failed. User cancelled the execution').title).toBe('Grok did not generate an image')
  })

  it('treats a completed tier-restriction text result as failure, not an image', () => {
    const stream = new GrokStream()
    stream.push(line(call()) + line({ type: 'tool_call_update', toolCallId: 'image-1', status: 'completed', rawOutput: { type: 'Text', text: 'Upgrade required' }, content: [
      { type: 'content', content: { type: 'text', text: 'Upgrade required' } }
    ] }) + line(end))
    expect(() => stream.finish()).toThrow('Upgrade required')
  })

  it.each(['cancelled', 'max_tokens', 'max_turn_requests'])('rejects terminal %s with partial text', stopReason => {
    expect(() => localAgentText('grok', line({ type: 'text', data: 'Starting' }) + line({ ...end, stopReason }))).toThrow('stopped before completing')
  })

  it('rejects broken streams, missing terminal events and unfinished tools', () => {
    for (const wire of ['broken\n', line({ type: 'text', data: 'Starting' }), line(call()) + line(end)]) {
      const stream = new GrokStream()
      stream.push(wire)
      expect(() => stream.finish()).toThrow()
    }
    expect(() => localAgentText('grok', line({ type: 'error', message: 'Login required' }))).toThrow('Login required')
    expect(localAgentText('grok', '{"text":"Legacy JSON reply"}')).toBe('Legacy JSON reply')
  })
})

describe('Grok image attachments', () => {
  it('loads only real image files belonging to this run and supports hashed workspace directories', async () => {
    const home = await mkdtemp(join(tmpdir(), 'douchat-grok-images-'))
    const workspace = join(home, 'workspace')
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    try {
      await mkdir(workspace)
      for (const folder of [encodeURIComponent(workspace), 'workspace-hashed']) {
        const cwdRoot = join(home, 'sessions', folder)
        const directory = join(cwdRoot, sessionId, 'images')
        await mkdir(directory, { recursive: true })
        if (folder === 'workspace-hashed') await writeFile(join(cwdRoot, '.cwd'), workspace)
        const image = join(directory, '1.png')
        await writeFile(image, png)
        const load = (paths: string[]) => grokGeneratedImages({ paths, sessionId }, { GROK_HOME: home }, workspace)
        expect(await load([image])).toEqual([{ name: '1.png', mimeType: 'image/png', data: png }])
        const unrelated = join(home, 'private.png')
        await writeFile(unrelated, png)
        await expect(load([unrelated])).rejects.toThrow('outside this session')
        const link = join(directory, 'link.png')
        await symlink(unrelated, link)
        await expect(load([link])).rejects.toThrow('outside this session')
        await writeFile(image, 'not an image')
        await expect(load([image])).rejects.toThrow('not a supported image')
        await expect(grokGeneratedImages({ paths: [image], sessionId: '../escape' }, { GROK_HOME: home }, workspace)).rejects.toThrow('Invalid image session')
        await writeFile(image, png)
        const other = join(home, 'other-workspace')
        await mkdir(other, { recursive: true })
        await expect(grokGeneratedImages({ paths: [image], sessionId }, { GROK_HOME: home }, other)).rejects.toThrow()
      }
    } finally { await rm(home, { recursive: true, force: true }) }
  })
})
