import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { configureLocalWorkspaces, localExecutionTarget, localWorkspace, resetLocalWorkspaces, resolveSavedWorkspace, validateWorkspaceFolder } from './localWorkspaces'
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

it('migrates Cursor files to a short path while retaining isolation, reloads and topic resets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'douchat-cursor-test-'))
  const config = { id: 'cursor-agent', ownerId: 'alice', localAgentId: 'cursor', model: 'default', name: 'Cursor', role: '', instructions: '' } as AgentConfig
  try {
    configureLocalWorkspaces(directory)
    // Simulate the previous layout without mutating real user workspaces.
    const legacy = localWorkspace({ ...config, localAgentId: 'codex' }, 'topic')!
    writeFileSync(join(legacy.directory, 'notes.md'), 'Preserve this file')
    const migrated = localWorkspace(config, 'topic')!
    expect(migrated.directory.length).toBeLessThan(255)
    expect(migrated.directory).not.toBe(legacy.directory)
    expect(readFileSync(join(migrated.directory, 'notes.md'), 'utf8')).toBe('Preserve this file')
    migrated.remember('cursor-thread')
    expect(localWorkspace(config, 'topic')!.thread).toBe('cursor-thread')
    expect(localWorkspace({ ...config, ownerId: 'bob' }, 'topic')!.directory).not.toBe(migrated.directory)
    expect(localWorkspace({ ...config, id: 'another' }, 'topic')!.directory).not.toBe(migrated.directory)
    expect(localWorkspace(config, 'other-topic')!.directory).not.toBe(migrated.directory)
    expect(localWorkspace({ ...config, localAgentId: 'codex' }, 'topic')!.directory).toBe(migrated.directory)
    resetLocalWorkspaces('alice', key => key === 'topic')
    const reset = localWorkspace(config, 'topic')!
    expect(reset.directory).not.toBe(migrated.directory)
    expect(reset.thread).toBeUndefined()
    expect(readFileSync(join(migrated.directory, 'notes.md'), 'utf8')).toBe('Preserve this file')
  } finally { configureLocalWorkspaces(); rmSync(directory, { recursive: true, force: true }) }
})

it('uses a custom folder in place and never resumes a thread started in another folder', () => {
  const directory = mkdtempSync(join(tmpdir(), 'douchat-workspaces-custom-'))
  const projectA = join(directory, 'project-a'), projectB = join(directory, 'project-b')
  mkdirSync(projectA); mkdirSync(projectB)
  const config = { id: 'agent', ownerId: 'alice', localAgentId: 'codex', model: 'default', name: 'Agent', role: '', instructions: '' } as AgentConfig
  try {
    configureLocalWorkspaces(join(directory, 'user-data'))
    const managed = localWorkspace(config, 'direct:chat:topic')!
    managed.remember('managed-thread')
    const custom = localWorkspace(config, 'direct:chat:topic', projectA)!
    expect(custom).toMatchObject({ directory: projectA, custom: true, thread: undefined })
    custom.remember('project-a-thread')
    expect(localWorkspace(config, 'direct:chat:topic', projectA)!.thread).toBe('project-a-thread')
    expect(localWorkspace(config, 'direct:chat:topic', projectB)!.thread).toBeUndefined()
    expect(localWorkspace(config, 'direct:chat:topic')!.thread).toBeUndefined()
    resetLocalWorkspaces('alice', () => true)
    expect(localWorkspace(config, 'direct:chat:topic', projectA)!.directory).toBe(projectA)
  } finally { configureLocalWorkspaces(); rmSync(directory, { recursive: true, force: true }) }
})

it('rejects unsafe or missing workspace folders', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'douchat-workspaces-validate-')))
  const home = join(directory, 'home'), project = join(home, 'code', 'app'), system = join(directory, 'system'), data = join(directory, 'data')
  for (const path of [project, join(system, 'bin'), data]) mkdirSync(path, { recursive: true })
  writeFileSync(join(directory, 'file.txt'), 'x')
  const options = { home, systemRoots: [system] }
  try {
    configureLocalWorkspaces(data)
    expect(validateWorkspaceFolder(project, options)).toBe(project)
    expect(validateWorkspaceFolder(join(project, '..', 'app'), options)).toBe(project)
    expect(() => validateWorkspaceFolder('relative/path', options)).toThrow(/absolute/)
    expect(() => validateWorkspaceFolder(join(directory, 'missing'), options)).toThrow(/not found/)
    expect(() => validateWorkspaceFolder(join(directory, 'file.txt'), options)).toThrow(/Not a folder/)
    expect(() => validateWorkspaceFolder('/', options)).toThrow(/root/)
    expect(() => validateWorkspaceFolder(home, options)).toThrow(/home folder/)
    expect(() => validateWorkspaceFolder(join(system, 'bin'), options)).toThrow(/System folders/)
    expect(() => validateWorkspaceFolder(data, options)).toThrow(/data folder/)
    expect(() => validateWorkspaceFolder(directory, options)).toThrow(/data folder/)
    expect(() => resolveSavedWorkspace(join(directory, 'gone'), options)).toThrow(/unavailable/)
  } finally { configureLocalWorkspaces(); rmSync(directory, { recursive: true, force: true }) }
})

it('keeps the local fingerprint unchanged and binds remote threads to the server and folder', () => {
  const directory = mkdtempSync(join(tmpdir(), 'douchat-workspaces-remote-'))
  const config = { id: 'agent', ownerId: 'alice', localAgentId: 'custom:x', model: 'default', name: 'Agent', role: '', instructions: '' } as AgentConfig
  const server = { executionTargetId: 'ssh-legacy:aaa', targetRevision: 0 }
  try {
    configureLocalWorkspaces(join(directory, 'user-data'))
    // Existing local records were written with the original formula; they must keep resuming.
    const before = localWorkspace(config, 'k')!
    before.remember('local-thread')
    expect(localWorkspace(config, 'k')!.thread).toBe('local-thread')
    // Byte-for-byte the formula released before execution targets existed.
    const sha = (value: string) => createHash('sha256').update(value).digest('hex')
    const record = JSON.parse(readFileSync(join(directory, 'user-data', 'local-workspaces', 'sessions', sha(JSON.stringify(['alice', 'agent', 'k'])) + '.json'), 'utf8'))
    expect(record.fingerprint).toBe(sha(JSON.stringify([config.localAgentId, config.instructions, config.role, config.name, config.model])))
    const project = join(directory, 'project'); mkdirSync(project)
    localWorkspace(config, 'k2', project)
    const custom = JSON.parse(readFileSync(join(directory, 'user-data', 'local-workspaces', 'sessions', sha(JSON.stringify(['alice', 'agent', 'k2'])) + '.json'), 'utf8'))
    expect(custom.fingerprint).toBe(sha(JSON.stringify([config.localAgentId, config.instructions, config.role, config.name, config.model, { folder: project }])))

    const managed = localWorkspace(config, 'k', undefined, { remote: { target: server } })!
    expect(managed.directory).toBe('')
    managed.remember('remote-thread')
    expect(localWorkspace(config, 'k', undefined, { remote: { target: server } })!.thread).toBe('remote-thread')
    const managedKey = managed.remoteKey

    // A chosen folder, another server, or an edited server each start a new thread.
    const chosen = localWorkspace(config, 'k', undefined, { remote: { target: server, workspace: { path: '/srv/p', ...server } } })!
    expect(chosen).toMatchObject({ custom: true, thread: undefined })
    chosen.remember('chosen-thread')
    expect(localWorkspace(config, 'k', undefined, { remote: { target: server, workspace: { path: '/srv/q', ...server } } })!.thread).toBeUndefined()
    const other = localWorkspace(config, 'k', undefined, { remote: { target: { executionTargetId: 'ssh-legacy:bbb', targetRevision: 0 } } })!
    expect(other.thread).toBeUndefined()
    // Agents saved before targets existed keep their managed server folder and run owner.
    const legacy = { executionTargetId: 'ssh-legacy:aaa', targetRevision: 0 }
    const id = sha(JSON.stringify(['alice', 'agent', 'k']))
    const generation = JSON.parse(readFileSync(join(directory, 'user-data', 'local-workspaces', 'sessions', id + '.json'), 'utf8')).generation
    expect(localWorkspace(config, 'k', undefined, { remote: { target: legacy } })!.remoteKey).toBe(sha(JSON.stringify([id, generation])))
    // A different server has its own identity; it still starts a new thread above.
    expect(other.remoteKey).toBe(managedKey)
    const edited = localWorkspace(config, 'k', undefined, { remote: { target: { ...server, targetRevision: 1 } } })!
    expect(edited.thread).toBeUndefined()
    expect(edited.remoteKey).not.toBe(managedKey)
    expect(localWorkspace(config, 'k', undefined, { remote: { target: server } })!.remoteKey).toBe(managedKey)
  } finally { configureLocalWorkspaces(); rmSync(directory, { recursive: true, force: true }) }
})

it('creates one device id per user-data folder', () => {
  const directory = mkdtempSync(join(tmpdir(), 'douchat-device-'))
  try {
    configureLocalWorkspaces(join(directory, 'a'))
    const first = localExecutionTarget()
    expect(first.executionTargetId).toMatch(/^local:[a-f0-9-]{36}$/)
    configureLocalWorkspaces(join(directory, 'a'))
    expect(localExecutionTarget()).toEqual(first)
    configureLocalWorkspaces(join(directory, 'b'))
    expect(localExecutionTarget().executionTargetId).not.toBe(first.executionTargetId)
  } finally { configureLocalWorkspaces(); rmSync(directory, { recursive: true, force: true }) }
})
