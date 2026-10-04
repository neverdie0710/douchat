import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const shell = vi.hoisted(() => ({ socket: undefined as string | undefined }))
const sshAdd = vi.hoisted(() => ({ keys: new Set<string>(), calls: [] as string[] }))

vi.mock('./shellPath', () => ({ loginShellSshAuthSock: async () => shell.socket }))
vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(),
  execFile: (file: string, _args: string[], options: { env: NodeJS.ProcessEnv }, done: (error: Error | null) => void) => {
    expect(file).toBe('/usr/bin/ssh-add')
    const socket = options.env.SSH_AUTH_SOCK!
    sshAdd.calls.push(socket)
    done(sshAdd.keys.has(socket) ? null : new Error('The agent has no identities.'))
  }
}))

const appSocket = '/private/tmp/com.apple.launchd.x/Listeners'
const terminalSocket = '/Users/me/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock'
let previous: string | undefined

beforeEach(() => {
  vi.resetModules()
  previous = process.env.SSH_AUTH_SOCK
  process.env.SSH_AUTH_SOCK = appSocket
  shell.socket = undefined
  sshAdd.keys.clear()
  sshAdd.calls = []
})
afterEach(() => {
  if (previous === undefined) delete process.env.SSH_AUTH_SOCK
  else process.env.SSH_AUTH_SOCK = previous
})

it.skipIf(process.platform === 'win32')("uses the terminal's ssh-agent when a Finder-launched app has a different, empty one", async () => {
  const { sshLaunchEnvironment } = await import('./remoteTransport')
  expect((await sshLaunchEnvironment()).SSH_AUTH_SOCK).toBe(appSocket)

  shell.socket = terminalSocket
  expect((await sshLaunchEnvironment()).SSH_AUTH_SOCK).toBe(appSocket)
  // An empty terminal agent (e.g. `eval "$(ssh-agent)"` per shell) is not cached as a choice.
  sshAdd.keys.add(terminalSocket)
  const env = await sshLaunchEnvironment()
  expect(env.SSH_AUTH_SOCK).toBe(terminalSocket)
  expect(env.OPENAI_API_KEY).toBeUndefined()
  const checks = sshAdd.calls.length
  await sshLaunchEnvironment()
  expect(sshAdd.calls.length).toBe(checks)
})

it.skipIf(process.platform === 'win32')('keeps the app agent when the terminal uses the same socket', async () => {
  shell.socket = appSocket
  const { sshLaunchEnvironment } = await import('./remoteTransport')
  expect((await sshLaunchEnvironment()).SSH_AUTH_SOCK).toBe(appSocket)
  expect(sshAdd.calls).toEqual([])
})
