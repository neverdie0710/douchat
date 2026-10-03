import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listSshHosts } from './sshHosts'
import { sshArgs, controlPathOption } from './remoteTransport'
import { normalizeRemoteSpec } from './remoteValidate'

let home: string
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'douchat-ssh-')); await mkdir(join(home, '.ssh')) })
afterEach(async () => { await rm(home, { recursive: true, force: true }) })

describe('listSshHosts', () => {
  it('lists concrete aliases from config and includes, skipping patterns', async () => {
    await writeFile(join(home, '.ssh', 'config'), 'Host *\n  ServerAliveInterval 30\nHost dev-box build-sg\n  HostName 1.2.3.4\nHost *.corp !bad -oProxyCommand=x\nInclude extra\n# Host commented\n')
    await writeFile(join(home, '.ssh', 'extra'), 'Host=gpu-lab\n')
    expect(await listSshHosts(home)).toEqual(['dev-box', 'build-sg', 'gpu-lab'])
  })
  it('returns nothing without a config', async () => { expect(await listSshHosts(home)).toEqual([]) })
})

describe('ControlPath', () => {
  it('is quoted so ssh accepts a directory with spaces', () => {
    const spec = normalizeRemoteSpec({ transport: 'ssh', host: 'build-sg', adapter: 'codex', executable: 'codex' })
    const control = '/Users/me/Library/Application Support/Douchat/ssh/%C'
    const args = sshArgs(spec, 'true\n', control)
    expect(args).toContain(controlPathOption(control))
    expect(controlPathOption(control)).toBe(`ControlPath="${control}"`)
    expect(args.indexOf('--')).toBe(args.indexOf('build-sg') - 1)
    expect(args).not.toContain('-p')
    expect(args).not.toContain('-l')
  })
})
