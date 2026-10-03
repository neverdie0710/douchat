import { describe, expect, it } from 'vitest'
import { imageMime, parseFrames } from './remoteFileChannel'
import { sshArgs, sshBridgeArgs, sshEnvironment } from './remoteTransport'
import { REMOTE_BOOTSTRAP } from './remoteScript'
import { normalizeRemoteSpec } from './remoteValidate'

const limits = { maxFiles: 2, maxFileBytes: 10, maxTotalBytes: 15 }
const frame = (name: string, data: string) => `${Buffer.byteLength(data)} ${name}\n${data}`

describe('parseFrames', () => {
  it('parses consecutive frames with binary content', () => {
    const frames = parseFrames(Buffer.from(frame('a.txt', 'ab\n1 x\n') + frame('b.png', 'z')), limits)
    expect(frames.map(item => [item.name, item.data.toString()])).toEqual([['a.txt', 'ab\n1 x\n'], ['b.png', 'z']])
    expect(parseFrames(Buffer.alloc(0), limits)).toEqual([])
  })

  it('rejects malformed, oversized or hostile streams', () => {
    const bad = [
      '3 a.txt\nab', '3 ../x\nabc', '3 .hidden\nabc', '3 a/b\nabc', '3 a b\nabc', '-1 a\n', '0 a\n', 'x a\nabc', '3 a.txt',
      '11 a.txt\n01234567890', frame('a', '1') + frame('b', '2') + frame('c', '3'), frame('a', '123456789') + frame('b', '1234567'),
      `3 ${'a'.repeat(300)}\nabc`, '3 a\u00e9\nabc'
    ]
    for (const input of bad) expect(() => parseFrames(Buffer.from(input), limits), JSON.stringify(input)).toThrow()
  })

  it('detects image types by content, not name', () => {
    expect(imageMime(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]))).toBe('image/png')
    expect(imageMime(Buffer.from([0xff, 0xd8, 0xff, 0]))).toBe('image/jpeg')
    expect(imageMime(Buffer.from('GIF89a......'))).toBe('image/gif')
    expect(imageMime(Buffer.from('RIFF....WEBPVP8 '))).toBe('image/webp')
    expect(imageMime(Buffer.from('<svg onload=alert(1)>'))).toBeUndefined()
  })
})

describe('ssh arguments', () => {
  const spec = normalizeRemoteSpec({ transport: 'ssh', host: 'example.com', port: 2200, user: 'me', adapter: 'codex', executable: 'codex' })

  it('hardens every connection and ends options before the host', () => {
    const args = sshArgs(spec, 'echo secret-script', '/tmp/c/%C')
    const end = args.indexOf('--')
    expect(args.slice(end)).toEqual(['--', 'example.com', REMOTE_BOOTSTRAP, expect.stringMatching(/^[A-Za-z0-9+/=]+$/)])
    expect(args.join(' ')).not.toContain('secret-script')
    for (const option of ['BatchMode=yes', 'StrictHostKeyChecking=yes', 'ForwardAgent=no', 'ForwardX11=no', 'PermitLocalCommand=no', 'ClearAllForwardings=yes']) {
      expect(args).toContain(option)
    }
    expect(args.slice(0, end)).toEqual(expect.arrayContaining(['-p', '2200', '-l', 'me']))
    expect(sshArgs(spec, 'x')).toContain('ControlPath=none')
  })

  it('binds the bridge to a private UNIX socket only', () => {
    const args = sshBridgeArgs(spec, '/home/me/.douchat-remote/b-x.sock', 4321)
    expect(args).toEqual(expect.arrayContaining(['-N', 'ExitOnForwardFailure=yes', 'StreamLocalBindMask=0177', '-R', '/home/me/.douchat-remote/b-x.sock:127.0.0.1:4321']))
    expect(args.at(-1)).toBe('example.com')
    expect(() => sshBridgeArgs(spec, '/s', 0)).toThrow()
  })

  it('does not forward API keys to ssh', () => {
    const env = sshEnvironment({ PATH: '/usr/bin', HOME: '/h', OPENAI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k', SSH_AUTH_SOCK: '/s' })
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/h', SSH_AUTH_SOCK: '/s' })
  })
})
