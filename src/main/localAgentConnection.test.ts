import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { LocalAgentConnection } from './localAgentConnection'
import { runLocalAgent, disposeLocalAgentSessions, resetLocalAgentConversation } from './localAgentRuntime'
import { validateLocalAgent } from './localAgents'
import type { AgentConfig } from '../shared/types'
vi.mock('./localAgents', () => ({ validateLocalAgent: vi.fn() }))
vi.mock('./shellPath', () => ({ spawnEnvironment: async () => ({ ...process.env, ANTHROPIC_API_KEY: 'test-conflict' }) }))
vi.mock('./windowsCommand', () => ({ executableCommand: async (file: string) => ({ file: process.execPath, prefix: [file] }) }))
let directory: string
let script: string
const config: AgentConfig = { id: 'pooled-test', ownerId: 'account-one', name: 'Test', role: '', instructions: '', color: '', provider: 'local', model: 'default', localAgentId: 'codex', createdAt: 0 }
const children: LocalAgentConnection[] = []
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'douchat-protocol-test-'))
  script = join(directory, 'fake.cjs')
  await writeFile(script, `
const readline=require('node:readline');
let count=0;let model;
const argvModel=process.argv.indexOf('--model');
const send=p=>process.stdout.write(JSON.stringify(p)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const p=JSON.parse(line);
 if(p.type==='control_request') {send({type:'control_response',response:{subtype:'success',request_id:p.request_id,response:{models:[{value:'test-model',displayName:'Test model'}]}}});return;}
 if(p.method==='initialize') send({id:p.id,result:{}});
 if(p.method==='thread/start') {model=p.params.model;send({id:p.id,result:{thread:{id:'thread-'+process.pid}}});}
 if(p.method==='model/list') send({id:p.id,result:{data:[{model:'test-model',displayName:'Test model'}],nextCursor:null}});
 const prompt=p.method==='turn/start'?p.params.input[0].text:p.type==='user'?p.message.content:null;
 if(prompt===null)return;
 count++;
 const threadId='thread-'+process.pid;
 if(p.method)send({id:p.id,result:{turn:{id:'turn-'+count}}});
 if(prompt==='crash'){process.exit(12);return;}
 if(prompt==='invalid'){send(null);return;}
 if(prompt==='wait')return;
 if(prompt==='no-credit' && process.env.ANTHROPIC_API_KEY){send({type:'result',is_error:true,result:'Credit balance is too low'});return;}
 if(prompt==='auth-conflict' && process.env.ANTHROPIC_API_KEY){send({type:'result',is_error:true,result:'claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set'});return;}
 if(prompt==='spawn-child') { const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});send({method:'item/completed',params:{threadId,item:{type:'agentMessage',text:String(child.pid)}}});send({method:'turn/completed',params:{threadId,turn:{status:'completed'}}});return; }
 const text=JSON.stringify({pid:process.pid,count,prompt,model:model||(argvModel>=0?process.argv[argvModel+1]:undefined),cwd:process.cwd()});
 if(p.type==='user') {send({type:'system',subtype:'init'});send({type:'assistant',message:{content:[{type:'text',text:'Working'}]}});send({type:'result',result:text});}
 else {
 send({method:'item/completed',params:{threadId,item:{type:'agentMessage',phase:'commentary',text:'Working'}}});
 send({method:'item/completed',params:{threadId,item:{type:'agentMessage',phase:'final_answer',text}}});
 send({method:'turn/completed',params:{threadId,turn:{status:'completed'}}});
 }
});`)
  vi.mocked(validateLocalAgent).mockImplementation(async (id) => ({ id, name: 'Test', path: script, command: script, installed: true, discovered: true, chatSupported: true, status: 'ready', authentication: 'unchecked' }))
})
afterEach(async () => {
  vi.useRealTimers()
  disposeLocalAgentSessions(config.id)
  for (const child of children.splice(0)) { child.close(); await child.disposed() }
})
afterAll(async () => { await rm(directory, { recursive: true, force: true }) })
async function connected(kind: 'codex' | 'claude' = 'codex') {
  const child = new LocalAgentConnection(kind)
  children.push(child)
  await child.connect(script, directory, process.env)
  return child
}
const options = { sessionKey: 'direct:conversation:topic', continuationPrompt: 'next turn' }
describe('persistent local agent connections', () => {
  it.each(['codex', 'claude'] as const)('reuses the %s process and session across turns', async (kind) => {
    const child = await connected(kind)
    const first = JSON.parse(await child.turn('hello', undefined))
    const second = JSON.parse(await child.turn('again', undefined))
    expect(second.pid).toBe(first.pid)
    expect(second.count).toBe(2)
    expect(child.hasHistory).toBe(true)
  })
  it('reuses warm connections without discovery or replaying the whole transcript', async () => {
    const before = vi.mocked(validateLocalAgent).mock.calls.length
    const first = JSON.parse((await runLocalAgent(config, 'full history', undefined, [], options)).text)
    const second = JSON.parse((await runLocalAgent(config, 'full history again', undefined, [], options)).text)
    expect(second).toMatchObject({ pid: first.pid, count: 2, prompt: 'next turn', cwd: first.cwd })
    expect(vi.mocked(validateLocalAgent).mock.calls.length - before).toBe(1)
  })
  it.each(['auth-conflict', 'no-credit'])('retains Claude account-login fallback after %s and reuses the successful connection', async (prompt) => {
    const claude = { ...config, localAgentId: 'claude' }
    const first = JSON.parse((await runLocalAgent(claude, prompt, undefined, [], options)).text)
    const second = JSON.parse((await runLocalAgent(claude, 'next', undefined, [], options)).text)
    expect(second).toMatchObject({ pid: first.pid, count: 2 })
  })
  it.each(['claude', 'codex'])('passes the configured model to %s and starts a new connection after a model change', async (id) => {
    const agent = { ...config, localAgentId: id, model: 'test-first' }
    const first = JSON.parse((await runLocalAgent(agent, 'hello', undefined, [], options)).text)
    const second = JSON.parse((await runLocalAgent({ ...agent, model: 'test-second' }, 'hello', undefined, [], options)).text)
    expect(first.model).toBe('test-first')
    expect(second.model).toBe('test-second')
    expect(second.pid).not.toBe(first.pid)
  })
  it.each(['claude', 'codex'] as const)('queries %s models without starting a conversation', async (id) => {
    const child = new LocalAgentConnection(id)
    try {
      await child.connect(script, directory, process.env, undefined, true)
      expect(await child.models()).toEqual([{ id: 'test-model', name: 'Test model' }])
      expect(child.hasHistory).toBe(false)
      expect(child.thread).toBeUndefined()
    } finally { child.close(); await child.disposed() }
  })
  it('isolates accounts and topics, and resets cleared conversations', async () => {
    const a = JSON.parse((await runLocalAgent(config, 'hello', undefined, [], options)).text)
    const b = JSON.parse((await runLocalAgent(config, 'hello', undefined, [], { sessionKey: 'direct:conversation:other' })).text)
    const c = JSON.parse((await runLocalAgent({ ...config, ownerId: 'account-two' }, 'hello', undefined, [], options)).text)
    expect(new Set([a.pid, b.pid, c.pid]).size).toBe(3)
    resetLocalAgentConversation('conversation', 'topic')
    const d = JSON.parse((await runLocalAgent(config, 'new history', undefined, [], options)).text)
    expect(d.pid).not.toBe(a.pid)
    expect(d.count).toBe(1)
  })
  it('keeps long tasks alive beyond three minutes and reports honest silence', async () => {
    const child = await connected()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    const progress = vi.fn()
    const abort = new AbortController()
    // Use Claude's no-request path so acknowledgement timers are not part of this test.
    const claude = await connected('claude')
    const result = claude.turn('wait', abort.signal, progress)
    const rejection = expect(result).rejects.toThrow('Stopped')
    await vi.advanceTimersByTimeAsync(181_000)
    expect(claude.alive).toBe(true)
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ elapsedSeconds: 180, silentSeconds: 180, phase: 'waiting' }))
    abort.abort()
    await rejection
    expect(claude.alive).toBe(false)
    child.close()
  })
  it('rejects a crash without replay and allows a fresh subsequent connection', async () => {
    await expect(runLocalAgent(config, 'crash', undefined, [], options)).rejects.toThrow('disconnected')
    const reply = JSON.parse((await runLocalAgent(config, 'hello', undefined, [], options)).text)
    expect(reply.count).toBe(1)
  })
  it('terminates owned descendant processes when a connection is disposed', async () => {
    const child = await connected()
    const pid = Number(await child.turn('spawn-child', undefined))
    expect(() => process.kill(pid, 0)).not.toThrow()
    child.close()
    await child.disposed()
    await vi.waitFor(() => { expect(() => process.kill(pid, 0)).toThrow() })
  })
  it('rejects malformed packets instead of crashing the application', async () => {
    const child = await connected()
    await expect(child.turn('invalid', undefined)).rejects.toThrow('Invalid local agent protocol packet')
  })
  it('evicts idle processes and removes owned temporary workspaces', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const reply = JSON.parse((await runLocalAgent(config, 'hello', undefined, [], options)).text)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    vi.useRealTimers()
    await vi.waitFor(async () => { await expect(readdir(reply.cwd)).rejects.toMatchObject({ code: 'ENOENT' }) })
    expect(() => process.kill(reply.pid, 0)).toThrow()
  })
  it('bounds the pool and does not evict active tasks to make room', async () => {
    const aborts = Array.from({ length: 8 }, () => new AbortController())
    const tasks: Promise<unknown>[] = []
    try {
      for (const [index, abort] of aborts.entries()) {
        let ready!: () => void
        const started = new Promise<void>((resolve) => { ready = resolve })
        const task = runLocalAgent(config, 'wait', abort.signal, [], {
          sessionKey: `direct:capacity:${index}`,
          onProgress: (p) => { if (p.phase === 'ready') ready() }
        })
        tasks.push(expect(task).rejects.toThrow('Stopped'))
        await started
      }
      await expect(runLocalAgent(config, 'extra', undefined, [], options)).rejects.toThrow('connections are busy')
    } finally {
      for (const abort of aborts) abort.abort()
      await Promise.all(tasks)
    }
  })
  it('cancels an active turn and rejects concurrent use of the same session', async () => {
    const abort = new AbortController()
    const ready = new Promise<void>((resolve) => {
      if (!optionsWithProgress) throw new Error('Missing test options')
      optionsWithProgress.onProgress = (p) => { if (p.phase === 'ready') resolve() }
    })
    const result = runLocalAgent(config, 'wait', abort.signal, [], optionsWithProgress)
    const stopped = expect(result).rejects.toThrow('Stopped')
    await ready
    await expect(runLocalAgent(config, 'second', undefined, [], options)).rejects.toThrow('already working')
    abort.abort()
    await stopped
  })
})
const optionsWithProgress: Parameters<typeof runLocalAgent>[4] = { ...options }
