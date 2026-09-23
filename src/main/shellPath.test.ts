import { expect, it, vi } from 'vitest'
const calls = vi.hoisted(() => [] as string[][])
const shellValues = vi.hoisted(() => ({} as Record<string, string>))
vi.mock('node:child_process', () => ({
  execFile: (_file: string, args: string[], _options: unknown, callback: (error: Error | null, result?: { stdout: string }) => void) => {
    calls.push(args)
    const name = args[1].match(/\$([A-Z_]+)/)?.[1]
    if (name && shellValues[name]) callback(null, { stdout: '__termany_shell__' + shellValues[name] + '\n' })
    else callback(new Error('shell startup failed'))
  }
}))
import { executableEnvironment, resetShellPath, spawnEnvironment } from './shellPath'
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

it.skipIf(process.platform === 'win32')('passes Gemini shell configuration only to agent processes', async () => {
  resetShellPath()
  Object.assign(shellValues, { GOOGLE_CLOUD_PROJECT: 'test-project', GOOGLE_CLOUD_LOCATION: 'test-region', GOOGLE_API_KEY: 'test-key', NANOBANANA_API_KEY: 'test-image-key', NANOBANANA_MODEL: 'test-image-model' })
  try {
    const env = await spawnEnvironment()
    expect(env.GOOGLE_CLOUD_PROJECT).toBe('test-project')
    expect(env.GOOGLE_CLOUD_LOCATION).toBe('test-region')
    expect(env.GOOGLE_API_KEY).toBe('test-key')
    expect(env.NANOBANANA_API_KEY).toBe('test-image-key')
    expect(env.NANOBANANA_MODEL).toBe('test-image-model')
  } finally {
    for (const name of Object.keys(shellValues)) delete shellValues[name]
    resetShellPath()
  }
})
