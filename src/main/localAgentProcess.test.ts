import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AgentConfig } from '../shared/types'
import { runLocalAgent } from './localAgentRuntime'
import { validateLocalAgent } from './localAgents'
vi.mock('./localAgents', () => ({ validateLocalAgent: vi.fn() }))
vi.mock('./shellPath', () => ({ spawnEnvironment: async () => ({ ...process.env }) }))
let directory: string
const config: AgentConfig = { id: 'test', name: 'Test', role: 'Tester', instructions: '', color: '', localAgentId: 'claude', provider: 'local', model: 'default', createdAt: 0 }
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'douchat-fake-cli-'))
  const executable = join(directory, 'agent')
  await writeFile(executable, `#!${process.execPath}\nif(process.argv.at(-1)==='wait')setInterval(()=>{},1000);else process.stdout.write(JSON.stringify({result:process.argv.at(-1)}));\n`, { mode: 0o755 })
  vi.mocked(validateLocalAgent).mockResolvedValue({ id: 'claude', name: 'Test CLI', command: executable, path: executable, installed: true, chatSupported: true })
})
afterAll(async () => { await rm(directory, { recursive: true, force: true }) })
describe('local CLI process lifecycle', () => {
  it('round-trips the prompt through a real child process without shell expansion', async () => {
    const prompt = '$(echo wrong); hello "quoted"'
    expect(await runLocalAgent(config, prompt)).toEqual({ text: prompt, images: [] })
  })
  it('stops a running child process', async () => {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 200)
    try { await expect(runLocalAgent(config, 'wait', abort.signal)).rejects.toThrow(/Stopped|abort/i) }
    finally { clearTimeout(timer) }
  })
})
