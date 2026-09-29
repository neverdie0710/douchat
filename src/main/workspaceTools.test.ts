import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspaceTools } from './workspaceTools'
const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'workspace-test-')); roots.push(root)
  const tools = createWorkspaceTools(() => root, async () => () => {})
  return { root, call: (name: string, args: unknown) => tools.find(t => t.name === name)!.execute('test', args as never) }
}
it('lists, reads and edits workspace files without leaving stale trailing bytes', async () => {
  const { root, call } = setup()
  await call('write_workspace_file', { path: 'nested/test.txt', content: 'hello world' })
  expect(JSON.stringify(await call('list_workspace_files', {}))).toContain('nested')
  expect(JSON.stringify(await call('read_workspace_file', { path: 'nested/test.txt' }))).toContain('hello world')
  await expect(call('write_workspace_file', { path: 'nested/test.txt', content: 'hi' })).rejects.toThrow()
  await call('write_workspace_file', { path: 'nested/test.txt', content: 'hi', overwrite: true })
  expect(readFileSync(join(root, 'nested/test.txt'), 'utf8')).toBe('hi')
})
it('rejects traversal and symlinks for reads and writes', async () => {
  const { root, call } = setup()
  writeFileSync(join(root, 'secret'), 'unchanged')
  symlinkSync(join(root, 'secret'), join(root, 'link'))
  for (const path of ['../escape', '/etc/passwd', 'link']) {
    await expect(call('read_workspace_file', { path })).rejects.toThrow()
    await expect(call('write_workspace_file', { path, content: 'bad', overwrite: true })).rejects.toThrow()
  }
  expect(readFileSync(join(root, 'secret'), 'utf8')).toBe('unchanged')
})
