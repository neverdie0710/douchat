import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
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
