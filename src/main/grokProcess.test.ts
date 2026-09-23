import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { validateLocalAgent } from './localAgents'
import { runLocalAgent } from './localAgentRuntime'
import type { AgentConfig } from '../shared/types'

vi.mock('./localAgents', () => ({ validateLocalAgent: vi.fn() }))
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, access: async (path: string, mode?: number) => {
    // Never substitute the developer's real Grok binary for this fixture.
    if (path.includes('local-tools/grok')) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    return fs.access(path, mode)
  } }
})
vi.mock('./shellPath', () => ({ spawnEnvironment: async () => ({ ...process.env, GROK_HOME: directory }) }))
let directory: string
const config: AgentConfig = { id: 'grok-test', name: 'Grok', role: '', instructions: '', color: '', provider: 'local', model: 'default', localAgentId: 'grok', createdAt: 0 }
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'douchat-grok-cli-'))
  const executable = join(directory, 'grok')
  await writeFile(executable, `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const emit=e=>process.stdout.write(JSON.stringify(e)+'\\n');
const prompt=process.argv[process.argv.indexOf('-p')+1];
const sessionId='01a0ceac-974d-7950-984c-7637568311b7';
emit({type:'text',data:'I will draw it.'});
emit({type:'tool_call',toolCallId:'image',toolName:'image_gen',status:'pending'});
if(prompt==='wait')setInterval(()=>{},1000);
else setTimeout(()=>{
 if(prompt==='denied'){
  emit({type:'tool_call_update',toolCallId:'image',status:'failed',content:[{type:'content',content:{type:'text',text:'Permission denied'}}]});
  emit({type:'end',sessionId,stopReason:'cancelled'});
 }else if(prompt==='truncated')process.exit(0);
 else {
  const image=path.join(process.env.GROK_HOME,'sessions',encodeURIComponent(process.cwd()),sessionId,'images','1.png');
  fs.mkdirSync(path.dirname(image),{recursive:true});fs.writeFileSync(image,Buffer.from([137,80,78,71,13,10,26,10]));
  emit({type:'tool_call_update',toolCallId:'image',status:'completed',rawOutput:{type:'ImageGen',path:image}});
  emit({type:'end',sessionId,stopReason:'end_turn'});
 }
},100);
`, { mode: 0o755 })
  vi.mocked(validateLocalAgent).mockResolvedValue({ id: 'grok', name: 'Grok', command: executable, path: executable, installed: true, discovered: true, chatSupported: true, status: 'ready', authentication: 'unchecked' })
})
afterAll(async () => { await rm(directory, { recursive: true, force: true }) })

it('emits progress before the CLI finishes, attaches its image, and stops the heartbeat after completion', async () => {
  const progress: string[] = []
  let finished = false
  const result = await runLocalAgent(config, 'success', undefined, [], { onProgress: p => {
    expect(finished).toBe(false)
    progress.push(p.detail || p.phase)
  } })
  finished = true
  expect(result.images).toHaveLength(1)
  expect(progress).toContain('Generating an image; waiting for the tool result')
  expect(progress.at(-1)).toBe('Attaching generated images')
  const count = progress.length
  await new Promise(resolve => setTimeout(resolve, 1100))
  expect(progress).toHaveLength(count)
})

it.each(['denied', 'truncated'])('does not publish preparatory text when the process ends with %s', async prompt => {
  await expect(runLocalAgent(config, prompt)).rejects.toThrow(prompt === 'denied' ? 'Permission denied' : 'incomplete event stream')
})

it('stops image generation when the user presses Stop', async () => {
  const abort = new AbortController()
  await expect(runLocalAgent(config, 'wait', abort.signal, [], { onProgress: p => {
    if (p.detail?.startsWith('Generating an image')) abort.abort()
  } })).rejects.toThrow('Stopped')
})
