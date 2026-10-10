import { describe, expect, it, vi } from 'vitest'
import type { RemoteAgentSpec } from '../shared/types'
import { checkFolderName, checkRemoteFolderPolicy, listRemoteDirectories, remoteTerminalArgs, resolveRemoteWorkspace } from './remoteWorkspace'
import { REMOTE_BOOTSTRAP } from './remoteScript'

const spec = { transport: 'ssh', host: 'box', user: 'me', adapter: 'codex', executable: 'codex', args: [], remoteHome: '/home/me' } as RemoteAgentSpec & { remoteHome: string }
const answer = (text: string) => vi.fn().mockResolvedValue(Buffer.from(text))

describe('server folder policy', () => {
  it('accepts project folders and refuses system, root, home and private folders', () => {
    expect(checkRemoteFolderPolicy('/home/me/code/app', '/home/me')).toBe('/home/me/code/app')
    expect(checkRemoteFolderPolicy('/srv/data/app', '/home/me')).toBe('/srv/data/app')
    for (const bad of ['/', '/etc', '/etc/nginx', '/usr/local/src', '/var/www', '/proc/1', '/System/Library', '/home/me',
      '/home/me/.ssh', '/home/me/.ssh/keys', '/home/me/.douchat-remote/w/abc', '/home/me/.douchat-host', '/home'])
      expect(() => checkRemoteFolderPolicy(bad, '/home/me'), bad).toThrow()
    // A sibling whose name only starts like a private folder is fine.
    expect(checkRemoteFolderPolicy('/home/me/.sshfs-mounts', '/home/me')).toBe('/home/me/.sshfs-mounts')
    expect(checkRemoteFolderPolicy('/etcetera', '/home/me')).toBe('/etcetera')
  })
  it('only accepts single child names', () => {
    expect(checkFolderName('web app')).toBe('web app')
    for (const bad of ['', '.', '..', 'a/b', 'a\nb', 'x'.repeat(256)]) expect(() => checkFolderName(bad), bad).toThrow()
  })
})

describe('server folder resolution', () => {
  const server = (path: string, home = '/home/me', system = 'Linux') => answer(`${system}\n${home}\n${path}\n`)
  it('saves the canonical path the server reports and re-checks it', async () => {
    expect(await resolveRemoteWorkspace(spec, '/home/me', 'link', undefined, server('/home/me/code/app'))).toBe('/home/me/code/app')
    // A link that leads into a refused folder is refused after resolution.
    await expect(resolveRemoteWorkspace(spec, '/home/me', 'link', undefined, server('/home/me/.ssh'))).rejects.toThrow()
    await expect(resolveRemoteWorkspace(spec, '/home/me', 'link', undefined, server('/etc'))).rejects.toThrow()
    await expect(resolveRemoteWorkspace(spec, '/home/me', 'link', undefined, server('relative'))).rejects.toThrow()
    await expect(resolveRemoteWorkspace(spec, '/home/me', 'link', undefined, server('/home/me/a/../b'))).rejects.toThrow()
  })
  it('compares against the real home folder, so a symlinked home is neither refused nor a bypass', async () => {
    // Fedora Atomic: /home -> /var/home. Projects in home are allowed; ~/.ssh still is not.
    expect(await resolveRemoteWorkspace(spec, '/home/me', 'proj', undefined, server('/var/home/me/proj', '/var/home/me'))).toBe('/var/home/me/proj')
    await expect(resolveRemoteWorkspace(spec, '/home/me', 'keys', undefined, server('/var/home/me/.ssh', '/var/home/me'))).rejects.toThrow(/SSH or Douchat/)
    await expect(resolveRemoteWorkspace(spec, '/home/me', undefined, undefined, server('/var/home/me', '/var/home/me'))).rejects.toThrow(/home folder/)
    await expect(resolveRemoteWorkspace(spec, '/home/me', 'x', undefined, server('/var/lib/x', '/var/home/me'))).rejects.toThrow(/System/)
  })
  it('ignores case on macOS servers', async () => {
    const mac = { ...spec, remoteHome: '/Users/me' }
    await expect(resolveRemoteWorkspace(mac, '/USERS/me', '.SSH', undefined, server('/USERS/me/.SSH', '/Users/me', 'Darwin'))).rejects.toThrow(/SSH or Douchat/)
    await expect(resolveRemoteWorkspace(mac, '/USERS', 'ME', undefined, server('/USERS/ME', '/Users/me', 'Darwin'))).rejects.toThrow(/home folder/)
    await expect(resolveRemoteWorkspace(mac, '/', 'ETC', undefined, server('/ETC', '/Users/me', 'Darwin'))).rejects.toThrow(/System/)
    expect(await resolveRemoteWorkspace(mac, '/Users/me', 'Code', undefined, server('/Users/me/Code', '/Users/me', 'Darwin'))).toBe('/Users/me/Code')
    // Linux keeps exact comparison: a different spelling there really is a different folder.
    expect(await resolveRemoteWorkspace(spec, '/home/me', '.SSH', undefined, server('/home/me/.SSH'))).toBe('/home/me/.SSH')
  })
  it('refuses bad input before contacting the server', async () => {
    const exec = vi.fn()
    for (const [parent, name] of [['relative'], ['/home/me/../etc'], [42], [undefined], ['/home/me', '../etc'], ['/home/me', 'a/b']] as const)
      await expect(resolveRemoteWorkspace(spec, parent, name, undefined, exec)).rejects.toThrow()
    expect(exec).not.toHaveBeenCalled()
    // An obviously private request is refused before the server resolves it.
    await expect(resolveRemoteWorkspace(spec, '/home/me', '.ssh', undefined, exec)).rejects.toThrow()
    expect(exec).toHaveBeenCalledTimes(1)
  })
  it('joins a child name in main and filters what the server lists', async () => {
    const exec = answer('/home/me/code\napi\n.git\nweb\nweb\na/b\n\n')
    const listing = await listRemoteDirectories(spec, '/home/me/code', 'api', undefined, exec)
    expect(exec.mock.calls[0][1]).toContain("'/home/me/code/api'")
    expect(listing).toEqual({ path: '/home/me/code', directories: ['api', 'web'] })
    await expect(listRemoteDirectories(spec, '/home/me', '../etc', undefined, exec)).rejects.toThrow()
    await expect(listRemoteDirectories(spec, '/home/me', undefined, undefined, answer('not-a-path\n'))).rejects.toThrow()
    const home = answer('/home/me\n')
    await listRemoteDirectories(spec, undefined, undefined, undefined, home)
    expect(home.mock.calls[0][1]).toContain("'/home/me'")
  })
})

it('opens a terminal with validated ssh options and the folder only inside the payload', () => {
  const args = remoteTerminalArgs({ ...spec, port: 2222, identityFile: '/Users/me/.ssh/id' }, "/srv/it's $(id)")
  expect(args.slice(0, 7)).toEqual(['-t', '-p', '2222', '-l', 'me', '-i', '/Users/me/.ssh/id'])
  expect(args.at(-3)).toBe('box')
  expect(args.at(-2)).toBe(REMOTE_BOOTSTRAP)
  expect(args.at(-1)).toMatch(/^[A-Za-z0-9+/=]+$/)
  expect(Buffer.from(args.at(-1)!, 'base64').toString()).toContain(`cd -- '/srv/it'\\''s $(id)'`)
  expect(() => remoteTerminalArgs(spec, '/a/../b')).toThrow()
})
