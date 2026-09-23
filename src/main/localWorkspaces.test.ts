import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { configureLocalWorkspaces, localWorkspace, resetLocalWorkspaces } from './localWorkspaces'
import type { AgentConfig } from '../shared/types'

it('retains files and thread IDs across reloads, isolates identities, and invalidates cleared topics', () => {
  const directory = mkdtempSync(join(tmpdir(), 'douchat-workspaces-test-'))
  const config = { id: 'agent/../one', ownerId: 'alice', localAgentId: 'codex', model: 'default', name: 'Agent', role: '', instructions: '' } as AgentConfig
  try {
    configureLocalWorkspaces(directory)
    const first = localWorkspace(config, 'direct:chat:topic')!
    writeFileSync(join(first.directory, 'notes.md'), 'Remember the task')
    first.remember('thread-one')
    configureLocalWorkspaces(directory)
    const restored = localWorkspace(config, 'direct:chat:topic')!
    expect(restored.directory).toBe(first.directory)
    expect(restored.thread).toBe('thread-one')
    expect(readFileSync(join(restored.directory, 'notes.md'), 'utf8')).toBe('Remember the task')
    for (const other of [{ ...config, ownerId: 'bob' }, { ...config, id: 'other' }]) {
      const workspace = localWorkspace(other, 'direct:chat:topic')!
      expect(workspace.directory).not.toBe(first.directory)
      expect(workspace.thread).toBeUndefined()
    }
    expect(localWorkspace(config, 'direct:chat:other')!.directory).not.toBe(first.directory)
    const changed = localWorkspace({ ...config, model: 'new-model' }, 'direct:chat:topic')!
    expect(changed.directory).toBe(first.directory)
    expect(changed.thread).toBeUndefined()
    changed.remember('new-thread')
    first.remember('stale-thread')
    expect(localWorkspace({ ...config, model: 'new-model' }, 'direct:chat:topic')!.thread).toBe('new-thread')
    resetLocalWorkspaces('alice', key => key === 'direct:chat:topic')
    changed.remember('late-completion')
    const cleared = localWorkspace(config, 'direct:chat:topic')!
    expect(cleared.directory).not.toBe(first.directory)
    expect(cleared.thread).toBeUndefined()
    expect(readFileSync(join(first.directory, 'notes.md'), 'utf8')).toBe('Remember the task')
  } finally { configureLocalWorkspaces(); rmSync(directory, { recursive: true, force: true }) }
})
