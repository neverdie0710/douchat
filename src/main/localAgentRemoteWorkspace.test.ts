import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentConfig, LocalAgent } from '../shared/types'

// Capture every remote script instead of running ssh; the run stops at the first launch.
const scripts = vi.hoisted(() => [] as string[])
vi.mock('./remoteTransport', async (original) => ({
  ...await original<object>(),
  probeRemoteAgent: async (input: object) => ({ ...input, remotePath: '/usr/bin', remoteHome: '/home/me' }),
  remoteCheck: async (_spec: unknown, script: string, options?: { input?: Uint8Array }) => { scripts.push(script); return Buffer.from(options?.input ? String(options.input.byteLength) : '') },
  remoteExec: async (_spec: unknown, script: string) => { scripts.push(script); return { code: 0, stdout: Buffer.from(''), stderr: '' } },
  remoteLaunch: async (_spec: unknown, script: string) => { scripts.push(script); throw new Error('launch captured') }
}))
import { prepareLocalAgentSession, runLocalAgent, disposeAllLocalAgentSessions } from './localAgentRuntime'
import { configureLocalWorkspaces } from './localWorkspaces'

const target = { executionTargetId: 'ssh-legacy:box', targetRevision: 3 }
const agent = (adapter: 'codex' | 'gemini'): LocalAgent => ({
  id: 'custom:00000000-0000-4000-8000-000000000000', name: 'Server', command: adapter, installed: true, discovered: true, chatSupported: true, status: 'ready', authentication: 'unchecked', custom: true,
  remote: { transport: 'ssh', host: 'box', adapter, executable: adapter, args: [], allowSharing: false }, remoteTarget: target
})
const config = { id: 'a', ownerId: 'me', localAgentId: 'custom:00000000-0000-4000-8000-000000000000', model: 'default', name: 'Server', role: '', instructions: '' } as AgentConfig
let directory = ''
beforeEach(() => { scripts.length = 0; directory = mkdtempSync(join(tmpdir(), 'douchat-remote-run-')); configureLocalWorkspaces(directory) })
afterEach(() => { disposeAllLocalAgentSessions(); configureLocalWorkspaces(); rmSync(directory, { recursive: true, force: true }) })
const decoded = () => scripts.join('\n')

// Codex keeps a connection; replacing it waits for the old process's shutdown grace period.
it.each(['gemini', 'codex'] as const)('%s launches in the chosen server folder only when it belongs to the current target', { timeout: 20_000 }, async adapter => {
  const run = (remoteWorkspace?: object) => runLocalAgent(config, 'hi', undefined, [], { sessionKey: `direct:c:${adapter}`, agentOverride: agent(adapter), remoteWorkspace: remoteWorkspace as never }).catch(error => error)
  expect(String(await run({ path: '/home/me/proj', ...target }))).toContain('launch captured')
  expect(decoded()).toContain("w='/home/me/proj'")
  expect(decoded()).toContain("pwd -P)\" = '/home/me/proj'")
  // A folder saved before the server was edited is never sent to the server.
  scripts.length = 0
  await run({ path: '/home/me/proj', ...target, targetRevision: 2 })
  expect(decoded()).not.toContain('/home/me/proj')
  expect(decoded()).toMatch(/w="\$HOME"\/\.douchat-remote\/w\/'[a-f0-9]{64}'/)
  // Nor is a folder on this computer.
  scripts.length = 0
  await runLocalAgent(config, 'hi', undefined, [], { sessionKey: `direct:c:${adapter}`, agentOverride: agent(adapter), workspaceDirectory: '/Users/me/project' }).catch(() => {})
  expect(decoded()).not.toContain('/Users/me/project')
})

it('prewarms with the same folder the turn uses', async () => {
  await prepareLocalAgentSession(config, { sessionKey: 'direct:c:warm', agentOverride: agent('codex'), remoteWorkspace: { path: '/home/me/proj', ...target }, onApproval: async () => {} })
  expect(decoded()).toContain("w='/home/me/proj'")
})
