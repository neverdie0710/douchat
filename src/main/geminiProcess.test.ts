import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { validateLocalAgent } from './localAgents'
import { runLocalAgent } from './localAgentRuntime'
import type { AgentConfig } from '../shared/types'

vi.mock('./localAgents', () => ({ validateLocalAgent: vi.fn() }))
vi.mock('./shellPath', () => ({ spawnEnvironment: async () => ({ ...process.env }) }))
let directory: string
const config: AgentConfig = { id: 'gemini-test', name: 'Gemini', role: '', instructions: '', color: '', provider: 'local', model: 'default', localAgentId: 'gemini', createdAt: 0 }
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'douchat-gemini-cli-'))
  const executable = join(directory, 'gemini')
  await writeFile(executable, `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const emit=e=>process.stdout.write(JSON.stringify(e)+'\\n');
const prompt=process.argv[process.argv.indexOf('-p')+1];
const policy=process.argv[process.argv.indexOf('--policy')+1];
fs.writeFileSync(${JSON.stringify(join(directory, 'last-policy'))},policy);
const allowed=fs.readFileSync(policy,'utf8').includes('decision = "allow"');
if(process.argv[process.argv.indexOf('--output-format')+1]!=='stream-json')process.exit(53);
emit({type:'init',session_id:'test-session'});
emit({type:'message',role:'assistant',content:'I will draw it.'});
if(prompt==='chat'){emit({type:'result',status:'success'});process.exit(0)}
emit({type:'tool_use',tool_id:'image',tool_name:'mcp_nanobanana_generate_image',parameters:{preview:false}});
if(prompt==='wait')setInterval(()=>{},1000);
else setTimeout(()=>{
 if(prompt==='missing-key'||!allowed){
  emit({type:'tool_result',tool_id:'image',status:'error',error:{message:allowed?'No valid API key found. Please set NANOBANANA_API_KEY':'Permission denied'}});
 }else if(prompt==='truncated')process.exit(0);
 else {
  const image=path.join(process.cwd(),'nanobanana-output','1.png');
  fs.mkdirSync(path.dirname(image),{recursive:true});fs.writeFileSync(image,Buffer.from([137,80,78,71,13,10,26,10]));
  emit({type:'tool_result',tool_id:'image',status:'success',output:'Generated files: '+image});
 }
 emit({type:'result',status:'success'});
},100);
`, { mode: 0o755 })
  vi.mocked(validateLocalAgent).mockResolvedValue({ id: 'gemini', name: 'Gemini', command: executable, path: executable, installed: true, discovered: true, chatSupported: true, status: 'ready', authentication: 'unchecked' })
})
afterAll(async () => { await rm(directory, { recursive: true, force: true }) })

it('delivers a real child-process image after live tool progress, cleans the policy and stops the heartbeat', async () => {
  const progress: string[] = []
  const result = await runLocalAgent(config, 'success', undefined, [], { onProgress: p => progress.push(p.detail || p.phase) })
  expect(result.images).toHaveLength(1)
  expect(progress).toContain('Generating an image; waiting for the tool result')
  expect(progress.at(-1)).toBe('Attaching generated images')
  const policy = await readFile(join(directory, 'last-policy'), 'utf8')
  await expect(readFile(policy)).rejects.toMatchObject({ code: 'ENOENT' })
  const count = progress.length
  await new Promise(resolve => setTimeout(resolve, 1100))
  expect(progress).toHaveLength(count)
})

it('preserves ordinary replies and does not require image credentials for text conversations', async () => {
  await expect(runLocalAgent(config, 'chat')).resolves.toEqual({ text: 'I will draw it.', images: [] })
})

it.each(['missing-key', 'truncated'])('rejects %s even with preamble text or exit code zero', async prompt => {
  await expect(runLocalAgent(config, prompt)).rejects.toThrow(prompt === 'missing-key' ? 'No valid API key' : 'Incomplete event stream')
})

it('does not grant image generation to a read-only controller', async () => {
  await expect(runLocalAgent(config, 'success', undefined, [], { imageToolsAllowed: false })).rejects.toThrow('Permission denied')
})

it('cancels a running image tool and cleans up its policy file', async () => {
  const abort = new AbortController()
  await expect(runLocalAgent(config, 'wait', abort.signal, [], { onProgress: p => {
    if (p.detail?.startsWith('Generating an image')) abort.abort()
  } })).rejects.toThrow('Stopped')
  const policy = await readFile(join(directory, 'last-policy'), 'utf8')
  await expect(readFile(policy)).rejects.toMatchObject({ code: 'ENOENT' })
})
