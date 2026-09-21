import { describe, expect, it, vi } from 'vitest'
import type { LocalAgent } from '../shared/types'
import { openLocalAgentTerminal } from './terminalLauncher'

const claude: LocalAgent = {
  id: 'claude', name: 'Claude Code', command: 'claude', installed: true, discovered: true,
  path: '/Users/test/.local/bin/claude', chatSupported: true, status: 'ready', authentication: 'unchecked'
}

describe('local agent terminal launcher', () => {
  it('prefers Termany on macOS and types only the resolved Claude executable', async () => {
    const execute = vi.fn(async (_file: string, _args: string[]) => undefined)
    const result = await openLocalAgentTerminal('claude', {
      platform: 'darwin',
      validateAgent: async () => claude,
      findApp: async () => '/Applications/Termany.app',
      execute,
      wait: async () => undefined
    })

    expect(result).toEqual({ terminal: 'termany' })
    expect(execute).toHaveBeenNthCalledWith(1, '/usr/bin/open', ['/Applications/Termany.app'])
    expect(execute.mock.calls[1]?.[1]?.join('\n')).toContain("'/Users/test/.local/bin/claude'")
    expect(execute.mock.calls[1]?.[1]?.join('\n')).toContain('keystroke "t" using command down')
    expect(execute.mock.calls[1]?.[1]?.join('\n')).toContain('bundle identifier is "ai.termany.desktop"')
    expect(execute.mock.calls[1]?.[1]?.join('\n')).not.toContain('tell process "Termany"')
  })

  it('resolves only Claude rather than scanning the complete local agent catalog', async () => {
    const resolveCommand = vi.fn(async () => claude.path)
    const execute = vi.fn(async (_file: string, _args: string[]) => undefined)
    const result = await openLocalAgentTerminal('claude', {
      platform: 'darwin',
      findApp: async () => undefined,
      resolveCommand,
      execute
    })

    expect(result).toEqual({ terminal: 'system' })
    expect(resolveCommand).toHaveBeenCalledTimes(1)
    expect(resolveCommand).toHaveBeenCalledWith('claude')
  })

  it('falls back to macOS Terminal when Termany is unavailable', async () => {
    const execute = vi.fn(async (_file: string, _args: string[]) => undefined)
    const result = await openLocalAgentTerminal('claude', {
      platform: 'darwin',
      validateAgent: async () => claude,
      findApp: async () => undefined,
      execute
    })

    expect(result).toEqual({ terminal: 'system' })
    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0]?.[1]?.join('\n')).toContain('tell application "Terminal"')
    expect(execute.mock.calls[0]?.[1]?.join('\n')).toContain("'/Users/test/.local/bin/claude'")
  })

  it('skips Termany and opens Terminal immediately without Accessibility permission', async () => {
    const findApp = vi.fn(async () => '/Applications/Termany.app')
    const execute = vi.fn(async (_file: string, _args: string[]) => undefined)
    const result = await openLocalAgentTerminal('claude', {
      platform: 'darwin',
      validateAgent: async () => claude,
      findApp,
      execute,
      termanyAutomationAllowed: false
    })

    expect(result).toEqual({ terminal: 'system' })
    expect(findApp).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0]?.[1]?.join('\n')).toContain('tell application "Terminal"')
  })

  it('falls back when Termany cannot accept automated input', async () => {
    const execute = vi.fn(async (_file: string, args: string[]) => {
      if (args[0] === '-e' && args[1]?.includes('System Events')) throw new Error('Not authorized')
    })
    const result = await openLocalAgentTerminal('claude', {
      platform: 'darwin',
      validateAgent: async () => claude,
      findApp: async () => '/Applications/Termany.app',
      execute,
      wait: async () => undefined
    })

    expect(result).toEqual({ terminal: 'system' })
    expect(execute).toHaveBeenCalledTimes(3)
    expect(execute.mock.calls[2]?.[1]?.join('\n')).toContain('tell application "Terminal"')
  })

  it('times out a stuck Termany automation request and falls back to Terminal', async () => {
    vi.useFakeTimers()
    try {
      const execute = vi.fn(async (_file: string, args: string[]) => {
        if (args[0] === '-e' && args[1]?.includes('System Events')) {
          await new Promise<void>(() => undefined)
        }
      })
      const launch = openLocalAgentTerminal('claude', {
        platform: 'darwin',
        validateAgent: async () => claude,
        findApp: async () => '/Applications/Termany.app',
        execute,
        wait: async () => undefined
      })

      await vi.advanceTimersByTimeAsync(4_600)

      await expect(launch).resolves.toEqual({ terminal: 'system' })
      expect(execute.mock.calls[2]?.[1]?.join('\n')).toContain('tell application "Terminal"')
    } finally {
      vi.useRealTimers()
    }
  })

  it('never accepts an arbitrary command id from the renderer', async () => {
    await expect(openLocalAgentTerminal('rm -rf', {
      platform: 'darwin',
      validateAgent: async () => claude
    })).rejects.toThrow('cannot be opened')
  })
})
