import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalComputerProvider } from './computer'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'douchat-computer-test-'))
  directories.push(root)
  const openPath = vi.fn(async () => '')
  const provider = new LocalComputerProvider(() => {}, [root], openPath)
  const openFile = provider.createTools('dr-dou').find((tool) => tool.name === 'computer_open_file')
  if (!openFile) throw new Error('computer_open_file tool was not registered')
  return { root, openPath, openFile }
}

describe('computer_open_file', () => {
  it('reopens a saved chat-history file reference through the same safety boundary', async () => {
    const { root, openPath } = await setup()
    const provider = new LocalComputerProvider(() => {}, [root], openPath)
    const path = join(root, 'agreement.docx')
    await writeFile(path, 'document')
    const canonicalPath = await realpath(path)

    await provider.openLocalFile(path)

    expect(openPath).toHaveBeenCalledWith(canonicalPath)
    await expect(provider.openLocalFile(join(tmpdir(), 'outside.docx'))).rejects.toThrow('outside the allowed folders')
  })

  it('opens an allowed file with the system default application', async () => {
    const { root, openPath, openFile } = await setup()
    const path = join(root, 'movie.mp4')
    await writeFile(path, 'video')
    const canonicalPath = await realpath(path)

    const result = await openFile.execute('open-1', { path })

    expect(openPath).toHaveBeenCalledWith(canonicalPath)
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: `Opened in the default desktop app: ${canonicalPath}`
    })
  })

  it('rejects folders and paths outside the allowed roots', async () => {
    const { root, openPath, openFile } = await setup()
    const folder = join(root, 'folder')
    await mkdir(folder)

    await expect(openFile.execute('open-folder', { path: folder })).rejects.toThrow('Choose a file')
    await expect(openFile.execute('open-outside', { path: join(tmpdir(), 'outside.mp4') })).rejects.toThrow('outside the allowed folders')
    expect(openPath).not.toHaveBeenCalled()
  })

  it('reports an operating-system launch failure', async () => {
    const { root, openPath, openFile } = await setup()
    const path = join(root, 'movie.mp4')
    await writeFile(path, 'video')
    openPath.mockResolvedValueOnce('No application is registered for this file')

    await expect(openFile.execute('open-2', { path })).rejects.toThrow(
      'Could not open movie.mp4: No application is registered for this file'
    )
  })
})

it('suppresses late activity callbacks after disposal while a file action completes', async () => {
  const { root } = await setup()
  const path = join(root, 'late.txt')
  await writeFile(path, 'hello')
  let finish!: (value: string) => void
  let started!: () => void
  const opened = new Promise<void>((resolve) => { started = resolve })
  const onChange = vi.fn()
  const provider = new LocalComputerProvider(onChange, [root], () => {
    started()
    return new Promise<string>((resolve) => { finish = resolve })
  })
  const tool = provider.createTools('agent').find((entry) => entry.name === 'computer_open_file')!
  const pending = tool.execute('late', { path })
  await opened
  expect(onChange).toHaveBeenCalled()
  provider.dispose()
  onChange.mockClear()
  finish('')
  await pending
  await provider.stop('agent')
  provider.dispose()
  expect(onChange).not.toHaveBeenCalled()
  await expect(provider.start('agent')).rejects.toThrow('Computer provider is closed')
})


it('scopes extra folders per tool session and immediately honors revocation', async () => {
  const { root, openPath } = await setup()
  const extra = await mkdtemp(join(tmpdir(), 'douchat-extra-')); directories.push(extra)
  const file = join(extra, 'asset.txt'); await writeFile(file, 'asset')
  const provider = new LocalComputerProvider(() => {}, [root], openPath)
  let roots = [extra]
  const allowed = provider.createTools('agent', () => roots)
  const isolated = provider.createTools('agent')
  const tool = (items: typeof allowed, name: string) => items.find(item => item.name === name)!
  await expect(tool(isolated, 'computer_open_file').execute('denied', { path: file })).rejects.toThrow('outside the allowed folders')
  await tool(allowed, 'computer_open_file').execute('open', { path: file })
  expect(openPath).toHaveBeenCalledWith(await realpath(file))
  expect(JSON.stringify(await tool(allowed, 'computer_list_files').execute('list', { path: extra }))).toContain('asset.txt')
  roots = []
  await expect(tool(allowed, 'computer_list_files').execute('revoked', { path: extra })).rejects.toThrow('outside the allowed folders')
})

it('rejects symlink escapes for listing, creating and moving files', async () => {
  const { root, openPath } = await setup()
  const outside = await mkdtemp(join(tmpdir(), 'douchat-outside-')); directories.push(outside)
  const link = join(root, 'escape'); await symlink(outside, link)
  await writeFile(join(root, 'source.txt'), 'source')
  const tools = new LocalComputerProvider(() => {}, [root], openPath).createTools('agent')
  const execute = (name: string, params: object) => tools.find(tool => tool.name === name)!.execute('test', params)
  await expect(execute('computer_list_files', { path: link })).rejects.toThrow('outside the allowed folders')
  await expect(execute('computer_make_directory', { path: join(link, 'nested') })).rejects.toThrow('outside the allowed folders')
  await expect(execute('computer_move_file', { source: join(root, 'source.txt'), destination: join(link, 'moved.txt') })).rejects.toThrow('outside the allowed folders')
})


it('waits for folder approval before accessing files and resumes the original operation', async () => {
  const { root, openPath } = await setup()
  const extra = await mkdtemp(join(tmpdir(), 'douchat-prompt-')); directories.push(extra)
  await writeFile(join(extra, 'approved.txt'), 'hello')
  let roots: string[] = [], approve!: () => void
  const request = vi.fn(async () => { await new Promise<void>(resolve => { approve = resolve }); roots = [extra] })
  const tools = new LocalComputerProvider(() => {}, [root], openPath).createTools('agent', () => roots, request)
  const list = tools.find(tool => tool.name === 'computer_list_files')!
  let completed = false
  const pending = list.execute('list', { path: extra }).then(result => { completed = true; return result })
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
  expect(completed).toBe(false)
  approve()
  expect(JSON.stringify(await pending)).toContain('approved.txt')
  await list.execute('again', { path: extra })
  expect(request).toHaveBeenCalledOnce()
})

it('does not perform the operation when folder permission is declined', async () => {
  const { root, openPath } = await setup()
  const extra = await mkdtemp(join(tmpdir(), 'douchat-denied-')); directories.push(extra)
  const path = join(extra, 'file.txt'); await writeFile(path, 'hello')
  const tools = new LocalComputerProvider(() => {}, [root], openPath).createTools('agent', () => [], async () => { throw new Error('declined') })
  await expect(tools.find(tool => tool.name === 'computer_open_file')!.execute('open', { path })).rejects.toThrow('declined')
  expect(openPath).not.toHaveBeenCalled()
})
