import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureLocalAgentRegistry } from './localAgents'
import { testLocalAgent } from './localAgentTest'
import { runLocalAgent, withStartupArgs } from './localAgentRuntime'
import { validateRemoteSpec } from './remoteValidate'
import { appendLocalAgentArguments, formatStartupArgs, parseStartupArgsText, validateAgentStartupArgs } from '../shared/localAgentArguments'

vi.mock('./shellPath', () => ({
  resolveExecutable: async (command: string) => command.startsWith('/') ? command : undefined,
  spawnEnvironment: async () => ({ PATH: process.env.PATH }),
  executableEnvironment: async () => ({ PATH: process.env.PATH })
}))

let directory: string
let command: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'douchat-connection-test-'))
  command = join(directory, 'test agent')
  configureLocalAgentRegistry(directory)
  await writeFile(command, `#!${process.execPath}
const args = process.argv.slice(2);
if (args.includes('--fail')) { console.error('Please log in first'); process.exit(1); }
else if (args.includes('--version')) console.log('test-agent 7.6.2');
else if (args.includes('--wait')) setInterval(() => {}, 100);
else if (args.includes('--echo')) console.log(JSON.stringify(args));
else if (args.includes('--wrong')) console.log('Usage: test-agent');
else if (args.includes('--prompt') && args[args.indexOf('--prompt') + 1].includes('DOUCHAT_OK')) console.log('DOUCHAT_OK');
else process.exit(2);
`, { mode: 0o700 })
})
afterEach(async () => {
  configureLocalAgentRegistry()
  await rm(directory, { recursive: true, force: true })
})
describe('local agent draft connection test', () => {
  it('checks a real subprocess response using unsaved path and arguments without registering a contact', async () => {
    const result = await testLocalAgent(undefined, { name: 'Test', command, args: ['--prompt', '{prompt}'] })
    expect(result.reply).toBe('DOUCHAT_OK')
    expect(result.version).toBe('test-agent 7.6.2')
    await expect(readFile(join(directory, 'local-agents.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('keeps a successful connection when the CLI does not support version detection', async () => {
    const script = await readFile(command, 'utf8')
    await writeFile(command, script.replace("console.log('test-agent 7.6.2')", 'process.exit(2)'))
    await expect(testLocalAgent(undefined, { name: 'Test', command, args: ['--prompt'] })).resolves.toMatchObject({
      reply: 'DOUCHAT_OK', version: undefined
    })
  })
  it('reports authentication failures, invalid executables and non-model output', async () => {
    await expect(testLocalAgent(undefined, { name: 'Test', command, args: ['--fail'] })).rejects.toThrow('Please log in first')
    await expect(testLocalAgent(undefined, { name: 'Test', command: 'missing' })).rejects.toThrow('Executable not found')
    await expect(testLocalAgent(undefined, { name: 'Test', command, args: ['--wrong'] })).rejects.toThrow('Unexpected test response')
  })
  it('cancels a hanging process and allows a subsequent test', async () => {
    const abort = new AbortController()
    const pending = testLocalAgent(undefined, { name: 'Test', command, args: ['--wait'] }, abort.signal)
    const assertion = expect(pending).rejects.toThrow('Cancelled by user')
    setTimeout(() => abort.abort(new Error('Cancelled by user')), 100)
    await assertion
    await expect(testLocalAgent(undefined, { name: 'Test', command, args: ['--prompt'] })).resolves.toMatchObject({ reply: 'DOUCHAT_OK' })
  })
  it('passes literal arguments and substitutes the prompt without a shell', async () => {
    const prompt = 'a "quoted" message; $(touch forbidden)'
    const reply = await runLocalAgent({ id: 'probe', name: 'Test', localAgentId: 'custom:test', role: '', instructions: '', provider: 'local', model: 'default', color: '', createdAt: 0 }, prompt, undefined, [], {
      agentOverride: { id: 'custom:test', name: 'Test', command, path: command, custom: true, installed: true, discovered: true, chatSupported: true, status: 'ready', authentication: 'unchecked', args: ['--echo', 'a path with spaces', '{prompt}', '$HOME'] }
    })
    expect(JSON.parse(reply.text)).toEqual(['--echo', 'a path with spaces', prompt, '$HOME'])
    expect(appendLocalAgentArguments(['-p', '--', prompt], ['--model', 'foo'])).toEqual(['-p', '--model', 'foo', '--', prompt])
  })
  it("appends an agent's own startup arguments after its runtime's", async () => {
    const reply = await runLocalAgent({ id: 'probe', name: 'Test', localAgentId: 'custom:test', role: '', instructions: '', provider: 'local', model: 'default', color: '', createdAt: 0, startupArgs: ['-a', 'zhaocai'] }, 'Hello', undefined, [], {
      agentOverride: { id: 'custom:test', name: 'Test', command, path: command, custom: true, installed: true, discovered: true, chatSupported: true, status: 'ready', authentication: 'unchecked', args: ['--echo'] }
    })
    expect(JSON.parse(reply.text)).toEqual(['--echo', '-a', 'zhaocai', 'Hello'])
  })
})

describe('agent startup arguments', () => {
  const remote = { transport: 'ssh' as const, host: 'mini-local', adapter: 'fastclaw' as const, executable: 'fastclaw', args: ['--base-url', 'http://127.0.0.1:1'] }
  const runtime = { id: 'custom:mini', name: 'mini', command: 'fastclaw', custom: true, installed: true, discovered: true, chatSupported: true, status: 'ready' as const, authentication: 'unchecked' as const, args: remote.args, remote }

  it('merges into the SSH spec so launch-time validation covers both', async () => {
    const merged = withStartupArgs(runtime, ['-a', 'zhaocai'])
    expect(merged.remote!.args).toEqual(['--base-url', 'http://127.0.0.1:1', '-a', 'zhaocai'])
    expect(runtime.remote.args).toEqual(['--base-url', 'http://127.0.0.1:1'])
    const codex = withStartupArgs({ ...runtime, remote: { ...remote, adapter: 'codex' } }, ['--sandbox', 'danger-full-access'])
    await expect(validateRemoteSpec(codex.remote)).rejects.toThrow('not allowed: --sandbox')
  })

  it('rejects malformed values and runtime-only placeholders', () => {
    expect(validateAgentStartupArgs(undefined)).toBeUndefined()
    expect(validateAgentStartupArgs([])).toBeUndefined()
    expect(validateAgentStartupArgs(parseStartupArgsText('-a\r\nzhaocai\n\n'))).toEqual(['-a', 'zhaocai'])
    // Typed as in a terminal: `-a agt_x` must not become one "-a agt_x" argument.
    expect(parseStartupArgsText('  -a agt_2834a7a1e660d509b83d ')).toEqual(['-a', 'agt_2834a7a1e660d509b83d'])
    expect(parseStartupArgsText(`--profile "my work" --label 'a b'\n--flag`)).toEqual(['--profile', 'my work', '--label', 'a b', '--flag'])
    expect(parseStartupArgsText('$HOME $(id) ;')).toEqual(['$HOME', '$(id)', ';'])
    expect(() => parseStartupArgsText('--profile "unterminated')).toThrow('Close the quote')
    for (const args of [['-a', 'zhaocai'], ['--profile', 'my work', 'say "hi"', "it's"]]) expect(parseStartupArgsText(formatStartupArgs(args))).toEqual(args)
    expect(() => validateAgentStartupArgs(['a\nb'])).toThrow('valid startup arguments')
    expect(() => validateAgentStartupArgs(Array(17).fill('-v'))).toThrow('up to 16')
    expect(() => validateAgentStartupArgs(['{prompt}'])).toThrow('{prompt}')
  })
})
