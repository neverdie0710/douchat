import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AgentConfig } from '../shared/types'
import { runLocalAgent } from './localAgentRuntime'
import { validateLocalAgent } from './localAgents'
vi.mock('./localAgents', () => ({ validateLocalAgent: vi.fn() }))
vi.mock('./shellPath', () => ({ spawnEnvironment: async () => ({ ...process.env, ANTHROPIC_API_KEY: 'test-key' }) }))
let directory: string
let executable: string
const config: AgentConfig = { id: 'test', name: 'Test', role: 'Tester', instructions: '', color: '', localAgentId: 'claude', provider: 'local', model: 'default', createdAt: 0 }
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'douchat-fake-cli-'))
  executable = join(directory, 'agent')
  await writeFile(executable, `#!${process.execPath}\nconst prompt=process.argv.at(-1);const conflict='claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set';if(prompt==='wait')setInterval(()=>{},1000);else if(prompt==='no-credit'&&process.env.ANTHROPIC_API_KEY){process.stdout.write(JSON.stringify({is_error:true,result:'Credit balance is too low'}));process.exitCode=1}else if(prompt==='no-credit-json'&&process.env.ANTHROPIC_API_KEY){process.stdout.write(JSON.stringify({is_error:true,result:'Credit balance is too low'}))}else if(prompt==='auth-conflict'&&process.env.ANTHROPIC_API_KEY){process.stderr.write(conflict);process.exitCode=1}else if(prompt==='auth-conflict-json'&&process.env.ANTHROPIC_API_KEY){process.stdout.write(JSON.stringify({is_error:true,error:conflict}))}else process.stdout.write(JSON.stringify({result:(prompt.startsWith('auth-conflict')||prompt.startsWith('no-credit'))?'account-login':prompt}));\n`, { mode: 0o755 })
  vi.mocked(validateLocalAgent).mockResolvedValue({
    id: 'claude', name: 'Claude Code', command: executable, path: executable,
    installed: true, discovered: true, chatSupported: true, status: 'ready', authentication: 'unchecked'
  })
})
afterAll(async () => { await rm(directory, { recursive: true, force: true }) })
describe('local CLI process lifecycle', () => {
  it('runs a custom command without a shell and reads its stdout as plain text', async () => {
    vi.mocked(validateLocalAgent).mockResolvedValueOnce({
      id: 'custom:00000000-0000-4000-8000-000000000000', name: 'Custom', command: executable, path: executable,
      installed: true, discovered: true, chatSupported: true, status: 'ready', authentication: 'unchecked', custom: true
    })
    await expect(runLocalAgent({ ...config, localAgentId: 'custom:00000000-0000-4000-8000-000000000000' }, 'hello')).resolves.toEqual({
      text: '{"result":"hello"}', images: []
    })
  })
  it('round-trips the prompt through a real child process without shell expansion', async () => {
    const prompt = '$(echo wrong); hello "quoted"'
    expect(await runLocalAgent(config, prompt)).toEqual({ text: prompt, images: [] })
  })
  it.each(['no-credit', 'no-credit-json'])('retries %s with the persisted account login', async (prompt) => {
    await expect(runLocalAgent(config, prompt)).resolves.toEqual({ text: 'account-login', images: [] })
  })
  it('retries Claude with its persisted account login after an environment auth conflict', async () => {
    await expect(runLocalAgent(config, 'auth-conflict')).resolves.toEqual({ text: 'account-login', images: [] })
  })
  it('also retries when Claude reports the auth conflict in a successful JSON process response', async () => {
    await expect(runLocalAgent(config, 'auth-conflict-json')).resolves.toEqual({ text: 'account-login', images: [] })
  })
  it('stops a running child process', async () => {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 200)
    try { await expect(runLocalAgent(config, 'wait', abort.signal)).rejects.toThrow(/Stopped|abort/i) }
    finally { clearTimeout(timer) }
  })
})
