import { beforeEach, describe, expect, it, vi } from 'vitest'
import { detectLocalAgents, validateLocalAgent } from './localAgents'
import { resolveExecutable } from './shellPath'
vi.mock('./shellPath', () => ({ resolveExecutable: vi.fn() }))
beforeEach(() => vi.mocked(resolveExecutable).mockReset())
describe('local agent discovery', () => {
  it('lists the full catalog and supports every detected command', async () => {
    vi.mocked(resolveExecutable).mockImplementation(async (command) => ['codex', 'grok', 'openclaw'].includes(command) ? `/local/bin/${command}` : undefined)
    const agents = await detectLocalAgents()
    expect(agents).toHaveLength(11)
    expect(agents.find((agent) => agent.id === 'codex')).toMatchObject({ installed: true, chatSupported: true, path: '/local/bin/codex' })
    expect(agents.find((agent) => agent.id === 'grok')).toMatchObject({ installed: true, chatSupported: true, path: '/local/bin/grok' })
    expect(agents.find((agent) => agent.id === 'openclaw')).toMatchObject({ installed: true, chatSupported: true })
    expect(agents.find((agent) => agent.id === 'claude')?.installed).toBe(false)
    expect(agents.at(-1)?.id).toBe('fastclaw')
  })
  it('rejects stale installation state and unknown commands', async () => {
    await expect(validateLocalAgent('codex')).rejects.toThrow('not installed')
    vi.mocked(resolveExecutable).mockResolvedValue('/local/bin/openclaw')
    await expect(validateLocalAgent('openclaw')).resolves.toMatchObject({ id: 'openclaw', chatSupported: true })
    await expect(validateLocalAgent('arbitrary-shell-command')).rejects.toThrow('Unknown')
  })
})
