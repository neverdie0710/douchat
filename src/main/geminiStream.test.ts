import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { GeminiStream, geminiImagePolicy, isGeminiImageTool } from './geminiStream'
import { geminiGeneratedImages, geminiImageFiles, localAgentText } from './localAgentRuntime'
import { summarizeRuntimeError } from '../shared/bot/errors'

const line = (event: object) => JSON.stringify(event) + '\n'
const call = { type: 'tool_use', tool_name: 'mcp_nanobanana_generate_image', tool_id: 'image-1' }
const done = { type: 'tool_result', tool_id: 'image-1', status: 'success', output: 'Generated files:\n• picture.png' }
const end = { type: 'result', status: 'success' }

it('reconstructs fragmented events, ignores user text and never publishes tool arguments or contents', () => {
  const progress: string[] = []
  const stream = new GeminiStream(detail => progress.push(detail))
  const wire = [
    { type: 'init', session_id: 'private' },
    { type: 'message', role: 'user', content: 'private input' },
    { type: 'message', role: 'assistant', content: '开始。', delta: true },
    { ...call, parameters: { prompt: 'private prompt' } },
    { type: 'tool_use', tool_name: 'read_file', tool_id: 'read-1' },
    { type: 'tool_result', tool_id: 'read-1', status: 'success', output: 'private file contents' },
    done, { type: 'message', role: 'assistant', content: '好了。', delta: true }, end
  ].map(line).join('').trimEnd()
  for (let index = 0; index < wire.length; index += 9) stream.push(wire.slice(index, index + 9))
  expect(stream.finish()).toEqual({ text: '开始。好了。', imageToolsSucceeded: true })
  expect(progress.slice(0, 3)).toEqual(Array(3).fill('Generating an image; waiting for the tool result'))
  expect(progress.at(-1)).toBe('Image generated; preparing the result')
  expect(progress.join(' ')).not.toMatch(/private|picture\.png/)
})

it('rejects an image failure even if Gemini later reports overall success', () => {
  const stream = new GeminiStream()
  stream.push([call, { ...done, status: 'error', error: { message: 'No valid API key found. Please set NANOBANANA_API_KEY' } }, end].map(line).join(''))
  expect(() => stream.finish()).toThrow('No valid API key')
  expect(summarizeRuntimeError('Gemini: Image generation failed. No valid API key found. Please set NANOBANANA_API_KEY')).toMatchObject({
    title: 'Gemini image generation needs an API key', guidance: expect.stringContaining('gemini extensions config nanobanana')
  })
})

it('does not claim image generation from text, another MCP server or a bare tool name', () => {
  for (const tool_name of ['generate_image', 'mcp_other_generate_image', 'mcp_nanobanana_generate_image_extra']) {
    const stream = new GeminiStream()
    stream.push(line({ ...call, tool_name }) + line(done) + line(end))
    expect(stream.finish().imageToolsSucceeded).toBe(false)
    expect(isGeminiImageTool(tool_name)).toBe(false)
  }
  expect(localAgentText('gemini', line({ type: 'message', role: 'assistant', content: 'I am drawing' }) + line(end))).toBe('I am drawing')
  expect(localAgentText('gemini', '{"response":"legacy"}')).toBe('legacy')
})

it.each([
  line(call),
  line(call) + line(end),
  'broken\n',
  line({ ...end, status: 'error', error: { message: 'Connection closed' } })
])('rejects failed/incomplete streams', wire => {
  const stream = new GeminiStream()
  stream.push(wire)
  expect(() => stream.finish()).toThrow()
})

it('keeps nonfatal warnings compatible and does not auto-authorize shell, all MCP servers or previews', () => {
  const stream = new GeminiStream()
  stream.push(line({ type: 'error', severity: 'warning', message: 'Optional feature unavailable' }) + line(end))
  expect(stream.finish().imageToolsSucceeded).toBe(false)
  const policy = geminiImagePolicy()
  expect(policy).toContain('mcpName = "nanobanana"')
  expect(policy).not.toMatch(/run_shell_command|toolName = "\*"/)
  expect(policy).toContain(`argsPattern = '"preview":true'\ndecision = "deny"`)
  expect(geminiImagePolicy(false)).not.toContain('"allow"')
})

it('attaches only newly created valid files in the isolated output directory and rejects symlink escapes', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'douchat-gemini-images-'))
  const outside = await mkdtemp(join(tmpdir(), 'douchat-gemini-outside-'))
  const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  try {
    expect(await geminiImageFiles(workspace)).toEqual(new Set())
    const output = join(workspace, 'nanobanana-output')
    await mkdir(output)
    await writeFile(join(output, 'old.png'), image)
    const before = await geminiImageFiles(workspace)
    await expect(geminiGeneratedImages(workspace, before)).rejects.toThrow('did not produce a new image')
    await writeFile(join(output, 'new.png'), image)
    expect(await geminiGeneratedImages(workspace, before)).toEqual([{ name: 'new.png', mimeType: 'image/png', data: image }])
    await writeFile(join(output, 'new.png'), 'not an image')
    await expect(geminiGeneratedImages(workspace, before)).rejects.toThrow('not a supported image')
    await rm(output, { recursive: true })
    await writeFile(join(outside, 'secret.png'), image)
    await symlink(outside, output)
    await expect(geminiImageFiles(workspace)).rejects.toThrow('outside this workspace')
  } finally { await rm(workspace, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }) }
})
