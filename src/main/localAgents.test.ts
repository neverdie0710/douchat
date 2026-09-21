import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addCustomLocalAgent, configureLocalAgentRegistry, detectLocalAgents, findDesktopApp, removeCustomLocalAgent, validateLocalAgent } from './localAgents'
import { resolveExecutable } from './shellPath'
vi.mock('./shellPath', () => ({ resolveExecutable: vi.fn() }))
let registryDirectory = ''
beforeEach(async () => {
  vi.mocked(resolveExecutable).mockReset()
  registryDirectory = await mkdtemp(join(tmpdir(), 'douchat-local-agents-'))
  configureLocalAgentRegistry(registryDirectory)
})
afterEach(async () => {
  configureLocalAgentRegistry()
  await rm(registryDirectory, { recursive: true, force: true })
})
describe('local agent discovery', () => {
  it('lists the full catalog and supports every detected command', async () => {
    const agents = await detectLocalAgents({
      executable: async (command) => ['codex', 'grok', 'openclaw'].includes(command) ? `/local/bin/${command}` : undefined,
      desktopApp: async () => undefined,
      version: async (path) => path.endsWith('/codex') ? 'codex-cli 1.2.3' : undefined
    })
    expect(agents).toHaveLength(11)
    expect(agents.find((agent) => agent.id === 'codex')).toMatchObject({ installed: true, discovered: true, status: 'ready', chatSupported: true, path: '/local/bin/codex', version: 'codex-cli 1.2.3' })
    expect(agents.find((agent) => agent.id === 'grok')).toMatchObject({ installed: true, chatSupported: true, path: '/local/bin/grok' })
    expect(agents.find((agent) => agent.id === 'openclaw')).toMatchObject({ installed: true, chatSupported: true })
    expect(agents.find((agent) => agent.id === 'claude')?.installed).toBe(false)
    expect(agents.at(-1)?.id).toBe('fastclaw')
  })
  it('reports a desktop app separately instead of pretending it is a compatible CLI', async () => {
    const agents = await detectLocalAgents({
      executable: async () => undefined,
      desktopApp: async (names) => names.includes('Claude.app') ? '/Applications/Claude.app' : undefined
    })
    expect(agents.find((agent) => agent.id === 'claude')).toMatchObject({
      installed: false,
      discovered: true,
      status: 'desktop-only',
      desktopPath: '/Applications/Claude.app',
      authentication: 'unchecked'
    })
  })
  it('looks for macOS apps in each supplied application root', async () => {
    await expect(findDesktopApp(['Definitely Missing Douchat Fixture.app'], ['/missing/one', '/missing/two'])).resolves.toBeUndefined()
  })
  it('persists a custom command and discovers it without a shell', async () => {
    await addCustomLocalAgent({ name: 'My Agent', command: '/opt/tools/my-agent' })
    const agents = await detectLocalAgents({
      executable: async (command) => command === '/opt/tools/my-agent' ? command : undefined,
      desktopApp: async () => undefined
    })
    const custom = agents.find((agent) => agent.custom)
    expect(custom).toMatchObject({
      name: 'My Agent', command: '/opt/tools/my-agent', installed: true,
      status: 'ready', custom: true
    })
    await removeCustomLocalAgent(custom!.id)
    await expect(detectLocalAgents({ executable: async () => undefined, desktopApp: async () => undefined })).resolves.toHaveLength(11)
  })
  it('rejects stale installation state and unknown commands', async () => {
    await expect(validateLocalAgent('codex')).rejects.toThrow('not installed')
    vi.mocked(resolveExecutable).mockResolvedValue('/local/bin/openclaw')
    await expect(validateLocalAgent('openclaw')).resolves.toMatchObject({ id: 'openclaw', chatSupported: true })
    await expect(validateLocalAgent('arbitrary-shell-command')).rejects.toThrow('Unknown')
  })
})
