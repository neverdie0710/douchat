import { expect, it, vi } from 'vitest'
const calls = vi.hoisted(() => [] as string[][])
vi.mock('node:child_process', () => ({
  execFile: (_file: string, args: string[], _options: unknown, callback: (error: Error) => void) => {
    calls.push(args)
    callback(new Error('shell startup failed'))
  }
}))
import { executableEnvironment, resetShellPath } from './shellPath'
it('falls back to executable paths without loading model credentials when shell startup fails', async () => {
  resetShellPath()
  calls.length = 0
  const env = await executableEnvironment()
  expect(env.PATH).toBeTruthy()
  if (process.platform !== 'win32') {
    expect(calls).toHaveLength(2)
    expect(calls.every((args) => args[1].includes('$PATH'))).toBe(true)
    expect(calls.some((args) => /ANTHROPIC|OAUTH/.test(args[1]))).toBe(false)
  }
})
