import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { compatibleNodeVersion, configureManagedNode, ensureManagedNode, managedNodePaths, managedSearchPaths, selectNodeEnvironment, verifyNodeArchive } from './managedNode'
import { resolveExecutable } from './shellPath'
import { executableCommand } from './windowsCommand'

it('rejects outdated or unrecognized runtimes', () => {
  for (const version of ['v18.20.0', 'v20.19.0', 'v22.18.0', 'not node']) expect(compatibleNodeVersion(version)).toBe(false)
  for (const version of ['v22.19.0', 'v24.21.0\n']) expect(compatibleNodeVersion(version)).toBe(true)
})
it('rejects tampered downloads before extraction', () => {
  const bytes = Buffer.from('official archive fixture')
  const hash = createHash('sha256').update(bytes).digest('hex')
  expect(() => verifyNodeArchive(bytes, hash)).not.toThrow()
  expect(() => verifyNodeArchive(Buffer.from('different'), hash)).toThrow('verification failed')
})
it('selects the private environment when the system has no Node/npm', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'douchat-node-test-'))
  try {
    configureManagedNode(directory)
    const selected = await selectNodeEnvironment(async () => undefined)
    expect(selected.needsDownload).toBe(true)
    expect(selected.node).toBe(managedNodePaths().node)
    expect(managedSearchPaths()).toContain(managedNodePaths().agentBin)
    expect(managedNodePaths().prefix.startsWith(directory)).toBe(true)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
// Explicit smoke run downloads only into a temporary directory; no global tools are modified.
it.runIf(process.env.DOUCHAT_NODE_SMOKE === '1')('downloads, verifies and runs isolated Node/npm, then reuses it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'douchat-node-smoke-'))
  try {
    configureManagedNode(directory)
    await Promise.all([ensureManagedNode(), ensureManagedNode()])
    const selected = await selectNodeEnvironment(async () => undefined)
    expect(selected.needsDownload).toBe(false)
    const { stdout } = await promisify(execFile)(selected.node, [selected.npm, '--version'])
    expect(stdout).toMatch(/\d+\.\d+\.\d+/)
    const fixture = join(directory, 'fixture')
    await mkdir(fixture)
    await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'douchat-node-smoke', version: '1.0.0', bin: { 'douchat-node-smoke': 'cli.js' } }))
    await writeFile(join(fixture, 'cli.js'), '#!/usr/bin/env node\nconsole.log("managed runtime works")\n', { mode: 0o755 })
    const env = { ...process.env, PATH: [...managedSearchPaths(), process.env.PATH ?? ''].join(delimiter) }
    await promisify(execFile)(selected.node, [selected.npm, 'install', '--global', '--prefix', managedNodePaths().prefix, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', fixture], { env, timeout: 30000 })
    const cli = await resolveExecutable('douchat-node-smoke')
    expect(cli).toBeTruthy()
    const command = await executableCommand(cli!)
    const run = await promisify(execFile)(command.file, command.prefix, { env, timeout: 5000 })
    expect(run.stdout.trim()).toBe('managed runtime works')
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 240000)
