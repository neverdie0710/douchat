import { expect, it } from 'vitest'
import { parseLocalModels } from './localAgentModels'
import { withLocalModel } from '../shared/localModels'
import { localAgentArgs } from './localAgentRuntime'
it('extracts model IDs without CLI banners or terminal colors', () => {
  expect(parseLocalModels('opencode', '\x1b[32mprovider/model\x1b[0m\nprovider/model\nLoading models…')).toEqual([{ id: 'provider/model', name: 'provider/model' }])
  expect(parseLocalModels('cursor', 'Available models\nauto - Auto (default)')).toEqual([{ id: 'auto', name: 'Auto (default)' }])
  expect(parseLocalModels('grok', 'Default model: grok-test\n  * grok-test (default)')).toEqual([{ id: 'grok-test', name: 'grok-test' }])
  expect(parseLocalModels('openclaw', '{"models":[{"key":"local/test","name":"Test"}]}')).toEqual([{ id: 'local/test', name: 'Test' }])
})
it('passes a chosen model before the prompt terminator and preserves default behavior', () => {
  const args = localAgentArgs('opencode', 'hello', '/tmp/result')
  expect(withLocalModel('opencode', args, 'provider/model')).toEqual(['run', '--format', 'json', '--model', 'provider/model', '--', 'hello'])
  expect(withLocalModel('opencode', args, 'default')).toBe(args)
  expect(withLocalModel('openclaw', ['agent', 'exec', '--json'], 'provider/model')).toEqual(['agent', 'exec', '--model', 'provider/model', '--json'])
  expect(() => withLocalModel('custom:test', args, 'x')).toThrow('does not support')
  expect(() => withLocalModel('claude', args, '--help')).toThrow('Invalid model')
})
