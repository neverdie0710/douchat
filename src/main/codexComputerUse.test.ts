import { expect, it } from 'vitest'
import { codexComputerUseInventory } from './codexComputerUse'

it('distinguishes native desktop tools from unrelated browser servers', () => {
  expect(codexComputerUseInventory([{ name: 'playwright', tools: { browser_open: {} } }])).toContain('No native Computer Use')
  expect(codexComputerUseInventory([{ name: 'cua_repl', runtimeStatus: 'connected', tools: { js: {} } }])).toContain('is connected')
  expect(codexComputerUseInventory([{ name: 'computer-use', tools: { get_app_state: {} } }])).toContain('get_app_state')
})
it('does not confuse configured, disconnected or failed tools with working access', () => {
  for (const server of [
    { name: 'cua_repl', tools: {} },
    { name: 'cua_repl', runtimeStatus: 'failed', tools: { js: {} } },
    { name: 'cua_repl', toolsError: 'private endpoint failed', tools: { js: {} } }
  ]) {
    const prompt = codexComputerUseInventory([null, server])
    expect(prompt).toContain('not ready')
    expect(prompt).not.toContain('private endpoint')
  }
})
