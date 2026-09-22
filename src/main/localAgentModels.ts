import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configurableLocalAgents, type LocalModel, type LocalModelList } from '../shared/localModels'
import { validateLocalAgent } from './localAgents'
import { spawnEnvironment } from './shellPath'
import { executableCommand } from './windowsCommand'
import { LocalAgentConnection, killLocalProcess } from './localAgentConnection'
import { localAgentExecutable } from './localAgentRuntime'

export function parseLocalModels(id: string, output: string): LocalModel[] {
  const clean = output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
  if (id === 'openclaw') {
    const data = JSON.parse(clean)
    return (data.models ?? []).filter((m: any) => typeof m.key === 'string').map((m: any) => ({ id: m.key, name: m.name || m.key }))
  }
  const models: LocalModel[] = []
  for (const line of clean.split(/\r?\n/)) {
    if (id === 'opencode' && /^[\w.-]+\/\S+$/.test(line.trim())) models.push({ id: line.trim(), name: line.trim() })
    if (id === 'cursor') {
      const match = line.trim().match(/^(\S+) - (.+)$/)
      if (match) models.push({ id: match[1], name: match[2] })
    }
    if (id === 'grok') {
      const match = line.match(/^\s+[*-]\s+(\S+)/)
      if (match) models.push({ id: match[1], name: match[1] })
    }
  }
  return [...new Map(models.map(model => [model.id, model])).values()]
}

export async function listLocalAgentModels(id: string): Promise<LocalModelList> {
  if (!configurableLocalAgents.includes(id)) return { models: [], source: 'manual', configurable: false }
  const agent = await validateLocalAgent(id)
  // These CLIs accept a model override but don't expose a stable non-interactive catalog.
  if (!['codex', 'claude', 'opencode', 'cursor', 'grok', 'openclaw'].includes(id)) return { models: [], source: 'manual', configurable: true }
  const env = await spawnEnvironment()
  const cwd = await mkdtemp(join(tmpdir(), 'douchat-models-'))
  try {
    const executable = await localAgentExecutable(id, agent.path!)
    if (id === 'codex' || id === 'claude') {
      const connection = new LocalAgentConnection(id)
      const timer = setTimeout(() => connection.close(new Error('Model discovery timed out')), 15000)
      try {
        await connection.connect(executable, cwd, env, undefined, true)
        return { models: await connection.models(), source: 'agent', configurable: true }
      } finally { clearTimeout(timer); connection.close(); await connection.disposed() }
    }
    const command = await executableCommand(executable)
    const args = id === 'openclaw' ? ['models', 'list', '--json'] : ['models']
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(command.file, [...command.prefix, ...args], { cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = ''
      const timer = setTimeout(() => { killLocalProcess(child); reject(new Error('Model discovery timed out')) }, 15000)
      child.stdout.on('data', chunk => {
        stdout += chunk.toString()
        if (stdout.length > 2_000_000) { killLocalProcess(child); reject(new Error('Model list is too large')) }
      })
      child.stderr.resume()
      child.on('error', error => { clearTimeout(timer); reject(error) })
      child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error('Could not load models. Check the local agent login and configuration.')) })
      child.stdin.on('error', () => {})
      child.stdin.end()
    })
    return { models: parseLocalModels(id, output), source: 'agent', configurable: true }
  } finally { await rm(cwd, { recursive: true, force: true }) }
}
