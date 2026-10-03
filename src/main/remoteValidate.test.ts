import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { dangerousRemoteArgument, normalizeRemoteSpec, parseRemoteProbe, remoteHostLabel, shQuote, validRemotePath } from './remoteValidate'

const SHELLS = ['/bin/sh', '/bin/bash', '/bin/zsh', '/bin/dash', '/bin/ksh'].filter(shell => existsSync(shell))
const base = { transport: 'ssh', host: 'example.com', adapter: 'codex', executable: 'codex' }

const HOSTILE = [
  "'", "''", "'\\''", '"', '$(touch /tmp/pwned)', '`id`', '${HOME}', '$HOME', '\\', '\\\\\'', ';rm -rf /', '| cat', '&& echo x',
  '*', '?', '[a]', '~', '!', '!!', '#comment', ' leading', 'trailing ', '\t', '%s%n', '-n', '--', 'é中文🙂', "a'b\"c$d`e\\f"
]

describe('shQuote', () => {
  it('round-trips hostile values unchanged in every available shell', () => {
    const values = [...HOSTILE]
    for (let index = 0; index < 60; index++) {
      values.push(Array.from(randomBytes(24)).map(byte => String.fromCharCode(byte % 95 + 32)).join(''))
    }
    for (const shell of SHELLS) {
      for (const value of values) {
        const result = spawnSync(shell, ['-c', `printf '%s' ${shQuote(value)}`], { encoding: 'utf8' })
        expect(result.status, `${shell}: ${value}`).toBe(0)
        expect(result.stdout, `${shell}: ${value}`).toBe(value)
      }
    }
  // Spawns a real shell per value; allow for slow or busy machines (CI).
  }, 30_000)

  it('rejects values that cannot stay on one line', () => {
    for (const value of ['a\nb', 'a\rb', 'a\0b']) expect(() => shQuote(value)).toThrow()
  })
})

describe('normalizeRemoteSpec', () => {
  it('accepts a normal configuration', () => {
    const spec = normalizeRemoteSpec({ ...base, port: '2222', user: 'deploy', args: ['--model', 'x'], allowSharing: false })
    expect(spec).toMatchObject({ host: 'example.com', port: 2222, user: 'deploy', args: ['--model', 'x'], allowSharing: false })
    expect(remoteHostLabel(spec)).toBe('deploy@example.com:2222')
    expect(normalizeRemoteSpec({ ...base, host: '[::1]' }).host).toBe('[::1]')
  })

  it('rejects hosts and users that ssh could parse as options or commands', () => {
    for (const host of ['-oProxyCommand=id', '-p', 'a b', 'a;b', 'a$(id)', 'a`id`', '', 'a\nb', 'user@host', '[::1];id', '.hidden']) {
      expect(() => normalizeRemoteSpec({ ...base, host }), host).toThrow()
    }
    for (const user of ['-oProxyCommand=id', 'a b', 'root;id', '$(id)', 'a@b', '1abc']) {
      expect(() => normalizeRemoteSpec({ ...base, user }), user).toThrow()
    }
    for (const port of [0, 65536, 'abc', '22;id', 1.5]) expect(() => normalizeRemoteSpec({ ...base, port }), String(port)).toThrow()
  })

  it('rejects unsafe executables, directories and arguments', () => {
    for (const executable of ['codex;id', '$(id)', 'a b', '-x', '../bin/codex', '/opt/../bin/codex', '/opt//codex', 'relative/codex']) {
      expect(() => normalizeRemoteSpec({ ...base, executable }), executable).toThrow()
    }
    // A working directory typed in earlier builds is dropped, never used.
    expect(normalizeRemoteSpec({ ...base, remoteCwd: '/a/../etc' })).not.toHaveProperty('remoteCwd')
    expect(() => normalizeRemoteSpec({ ...base, args: ['a\nb'] })).toThrow()
    expect(() => normalizeRemoteSpec({ ...base, args: Array.from({ length: 33 }, () => 'x') })).toThrow()
    expect(() => normalizeRemoteSpec({ ...base, args: ['{prompt}'] })).toThrow()
    expect(normalizeRemoteSpec({ ...base, adapter: 'custom', executable: 'mytool', args: ['--q={prompt}'] }).args).toEqual(['--q={prompt}'])
    expect(() => normalizeRemoteSpec({ ...base, transport: 'telnet' })).toThrow()
    expect(() => normalizeRemoteSpec({ ...base, adapter: 'bash' })).toThrow()
    expect(() => normalizeRemoteSpec({ ...base, identityFile: 'relative/key' })).toThrow()
  })

  it('rejects arguments that disable sandboxes or approvals', () => {
    const cases: Array<[Parameters<typeof dangerousRemoteArgument>[0], string[]]> = [
      ['codex', ['--dangerously-bypass-approvals-and-sandbox']], ['codex', ['--yolo']], ['codex', ['--full-auto']],
      ['codex', ['-s', 'danger-full-access']], ['codex', ['--sandbox=danger-full-access']], ['codex', ['-sdanger-full-access']],
      ['codex', ['-a', 'never']], ['codex', ['--ask-for-approval', 'never']], ['codex', ['-c', 'sandbox_mode="danger-full-access"']],
      ['codex', ['--config=approval_policy="never"']], ['codex', ['-c', 'sandbox_permissions=["disk-full-read-access"]']],
      ['claude', ['--dangerously-skip-permissions']], ['claude', ['--allow-dangerously-skip-permissions']], ['claude', ['--permission-mode', 'bypassPermissions']],
      ['gemini', ['--yolo']], ['gemini', ['-y']], ['gemini', ['--approval-mode=yolo']], ['grok', ['--yolo']]
    ]
    for (const [adapter, args] of cases) {
      expect(dangerousRemoteArgument(adapter, args), `${adapter} ${args.join(' ')}`).toBeDefined()
      expect(() => normalizeRemoteSpec({ ...base, adapter, executable: adapter, args }), args.join(' ')).toThrow()
    }
    expect(dangerousRemoteArgument('codex', ['-m', 'gpt-5', '-c', 'model_reasoning_effort="high"'])).toBeUndefined()
  })
})

describe('parseRemoteProbe', () => {
  it('parses the fixed three-line response and ignores login banners', () => {
    expect(parseRemoteProbe('Welcome!\n/usr/local/bin/codex\n/usr/local/bin:/usr/bin\n/home/me\n')).toEqual({
      executable: '/usr/local/bin/codex', remotePath: '/usr/local/bin:/usr/bin', remoteHome: '/home/me'
    })
  })

  it('treats server output as untrusted', () => {
    expect(() => parseRemoteProbe('\n/usr/bin\n/home/me\n')).toThrow(/not found/)
    expect(() => parseRemoteProbe('codex\n/usr/bin\n/home/me\n')).toThrow()
    expect(() => parseRemoteProbe('/usr/bin/../x\n/usr/bin\n/home/me\n')).toThrow()
    expect(() => parseRemoteProbe('/usr/bin/codex\nrelative:/usr/bin\n/home/me\n')).toThrow()
    expect(() => parseRemoteProbe('/usr/bin/codex\n/usr/bin\nhome\n')).toThrow()
    expect(() => parseRemoteProbe('/usr/bin/codex\n/usr/bin\n/home/a:b\n')).toThrow()
    expect(() => validRemotePath('/usr/bin:\u001b[31m')).toThrow()
  })
})
