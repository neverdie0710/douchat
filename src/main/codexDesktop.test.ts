import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ access: vi.fn(), execute: vi.fn() }))
vi.mock('node:fs/promises', () => ({ access: mocks.access }))
vi.mock('node:child_process', () => ({ execFile: (file: string, args: string[], options: unknown, callback: (error: Error | null, result?: unknown) => void) => {
  mocks.execute(file, args, options).then((result: unknown) => callback(null, result), (error: Error) => callback(error))
} }))
import { codexDesktopCandidates, findCodexDesktopExecutable } from './codexDesktop'
const original = Object.getOwnPropertyDescriptor(process, 'platform')!
afterEach(() => { Object.defineProperty(process, 'platform', original); vi.resetAllMocks() })
it('supports system, per-user and discovered macOS bundles without probing the GUI', () => {
  expect(codexDesktopCandidates('darwin', '/Users/test', {}, ['/Volumes/Apps/Codex.app'])).toEqual([
    '/Applications/Codex.app/Contents/Resources/codex', '/Users/test/Applications/Codex.app/Contents/Resources/codex', '/Volumes/Apps/Codex.app/Contents/Resources/codex'
  ])
})
it('supports Windows conventional and Store installation roots with spaces', () => {
  const candidates = codexDesktopCandidates('win32', 'C:\\Users\\test', { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', ProgramFiles: 'C:\\Program Files' }, ['C:\\Program Files\\WindowsApps\\OpenAI.Codex_1_x64'])
  expect(candidates).toContain('C:\\Program Files\\WindowsApps\\OpenAI.Codex_1_x64\\app\\resources\\codex.exe')
  expect(candidates).toContain('C:\\Users\\test\\AppData\\Local\\Programs\\Codex\\resources\\codex.exe')
  expect(candidates.every(p => p.endsWith('resources\\codex.exe'))).toBe(true)
})
it('accepts a working bundled CLI and avoids a Spotlight query', async () => {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  mocks.access.mockResolvedValue(undefined)
  mocks.execute.mockResolvedValue({ stdout: 'codex-cli 0.120.0\n' })
  expect(await findCodexDesktopExecutable()).toBe('/Applications/Codex.app/Contents/Resources/codex')
  expect(mocks.execute).toHaveBeenCalledTimes(1)
})
it('rejects missing or non-CLI binaries and tolerates failed discovery', async () => {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  mocks.access.mockResolvedValue(undefined)
  mocks.execute.mockImplementation(async (file: string) => {
    if (file === '/usr/bin/mdfind') throw new Error('unavailable')
    return { stdout: 'desktop app' }
  })
  expect(await findCodexDesktopExecutable()).toBeUndefined()
})
it('does not scan unsupported platforms', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' })
  expect(await findCodexDesktopExecutable()).toBeUndefined()
  expect(mocks.access).not.toHaveBeenCalled()
})
it('finds a relocated macOS bundle after standard locations are missing', async () => {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  mocks.access.mockImplementation(async (file: string) => {
    if (!file.startsWith('/Volumes/Custom Apps/')) throw new Error('ENOENT')
  })
  mocks.execute.mockImplementation(async (file: string) => ({ stdout: file === '/usr/bin/mdfind'
    ? '/Volumes/Custom Apps/Codex.app\n' : 'codex-cli 0.120.0\n' }))
  expect(await findCodexDesktopExecutable()).toBe('/Volumes/Custom Apps/Codex.app/Contents/Resources/codex')
})
