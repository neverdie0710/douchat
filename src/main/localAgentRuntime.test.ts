import { describe, expect, it } from 'vitest'
import { codexThreadId, localAgentArgs, localAgentEnvironment, localAgentText } from './localAgentRuntime'
describe('local agent output', () => {
  it('trusts only the Gemini child workspace without mutating the parent environment', () => {
    const env = { PATH: '/bin' }
    expect(localAgentEnvironment('gemini', env)).toEqual({ PATH: '/bin', GEMINI_CLI_TRUST_WORKSPACE: 'true' })
    expect(env).toEqual({ PATH: '/bin' })
    expect(localAgentEnvironment('claude', env)).toBe(env)
    expect(localAgentArgs('gemini', 'Hello', '/tmp/output')).not.toContain('--yolo')
  })
  it('extracts final replies without leaking CLI metadata', () => {
    expect(localAgentText('claude', '{"result":"Hello","session_id":"private"}')).toBe('Hello')
    expect(localAgentText('gemini', '{"response":"Hello","stats":{}}')).toBe('Hello')
    expect(localAgentText('cursor', '{"result":"Hello"}')).toBe('Hello')
    expect(localAgentText('opencode', '{"type":"step_start"}\n{"type":"text","part":{"text":"Hello"}}\n')).toBe('Hello')
  })
  it('reports authentication or agent failures instead of treating errors as replies', () => {
    expect(() => localAgentText('claude', '{"is_error":true,"result":"Log in first"}')).toThrow('Log in first')
    expect(() => localAgentText('gemini', '{"error":{"message":"Missing credentials"}}')).toThrow('Missing credentials')
    expect(() => localAgentText('opencode', '{"type":"error","error":{"data":{"message":"No model"}}}')).toThrow('No model')
  })
  it('allows built-in web research without bypassing shell permissions', () => {
    expect(localAgentArgs('claude', 'Research', '/tmp/output')).toContain('WebSearch,WebFetch')
    expect(localAgentArgs('codex', 'Research', '/tmp/output')).toContain('web_search="live"')
    expect(localAgentArgs('codex', 'Research', '/tmp/output')).toContain('workspace-write')
    expect(localAgentArgs('codex', 'Research', '/tmp/output')).toContain('sandbox_workspace_write.network_access=true')
    expect(localAgentArgs('codex', 'Research', '/tmp/output')).toContain('--json')
  })
  it('links Codex image output to the exact CLI thread', () => {
    expect(codexThreadId([
      '{"type":"thread.started","thread_id":"01a0af4f-0611-78f0-971f-52b8749140a0"}',
      '{"type":"item.completed"}'
    ].join('\n'))).toBe('01a0af4f-0611-78f0-971f-52b8749140a0')
    expect(codexThreadId('{"type":"thread.started","thread_id":"../../escape"}')).toBeUndefined()
  })
  it('passes prompts as data and does not bypass CLI permissions', () => {
    const prompt = '$(touch /tmp/should-not-exist); --force'
    for (const id of ['claude', 'gemini', 'cursor', 'opencode', 'kimi']) {
      const args = localAgentArgs(id, prompt, '/tmp/output')
      expect(args).toContain(prompt)
      expect(args.join(' ')).not.toContain('--dangerously')
    }
    expect(localAgentArgs('codex', prompt, '/tmp/output')).toContain('workspace-write')
  })
})
