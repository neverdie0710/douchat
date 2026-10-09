import { posix } from 'node:path'
import type { ConnectionStatus, ConnectionTestReport, ConnectionTestStep, ConnectionView, DiscoveredRemoteAgent, RemoteAgentAdapter, RemoteConnection, RemoteConnectionInput } from '../shared/types'
import { ConnectionStore, connectionSpec, validateConnectionInput } from './connectionStore'
import { closeRemoteConnections, forgetRemoteProbes, probeRemoteAgent, remoteCheck, sshFailure } from './remoteTransport'
import { openSshTransport } from './remote/sshTransport'
import { DISCOVERABLE_CLIS, discoverScript, prepareScript, cleanupScript } from './remoteScript'
import { remoteHostLabel, validRemoteExecutable, validateRemoteSpec } from './remoteValidate'
import { randomUUID } from 'node:crypto'

/** 5s, 15s, 60s, then every 5 minutes. */
export const RETRY_DELAYS = [5_000, 15_000, 60_000, 300_000]
export const KEEPALIVE_MS = 60_000

/** A probe through a disabled or edited connection must never reach the server. */
function baseSpec(connection: RemoteConnection) {
  return connectionSpec(connection, { adapter: 'custom', executable: 'true', args: [] })
}

/** "<name>\t<absolute path>\t<version>" lines from the discovery script. The server is untrusted. */
export function parseDiscovery(output: string): DiscoveredRemoteAgent[] {
  const byCommand = new Map<string, RemoteAgentAdapter>(DISCOVERABLE_CLIS.map(([adapter, command]) => [command, adapter]))
  const found = new Map<RemoteAgentAdapter, DiscoveredRemoteAgent>()
  for (const line of output.replace(/\r/g, '').split('\n')) {
    const [command, path, version] = line.split('\t')
    const adapter = byCommand.get(command)
    if (!adapter || found.has(adapter)) continue
    let executable: string
    try { executable = validRemoteExecutable(path) } catch { continue }
    if (posix.basename(executable) !== command) continue
    const cleaned = (version ?? '').replace(/[\0-\x1f\x7f]/g, '').trim().slice(0, 120)
    found.set(adapter, { adapter, executable, ...(cleaned ? { version: cleaned } : {}) })
  }
  return [...found.values()]
}

interface Entry { status: ConnectionStatus; attempt: number; timer?: NodeJS.Timeout; checking?: Promise<void> }

/**
 * Registry, state machine and keep-alive for server connections.
 * disabled → connecting → connected | error; errors retry with backoff and
 * immediately when a window gains focus. A connection never falls back to
 * this computer: its agents fail while it is off or unreachable.
 */
export class ConnectionManager {
  private readonly entries = new Map<string, Entry>()
  private readonly listeners = new Set<(id: string, status: ConnectionStatus) => void>()
  private stopped = false
  constructor(readonly store: ConnectionStore, private readonly agentsOn: (id: string) => Promise<string[]>, private readonly check: (connection: RemoteConnection) => Promise<number> = defaultCheck) {}

  onStatus(listener: (id: string, status: ConnectionStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  status(id: string): ConnectionStatus { return this.entries.get(id)?.status ?? { state: 'disabled' } }

  async list(): Promise<ConnectionView[]> {
    const connections = await this.store.list()
    return Promise.all(connections.map(async connection => ({
      ...connection, label: remoteHostLabel(connection.ssh), agentIds: await this.agentsOn(connection.id),
      status: connection.enabled ? this.entries.get(connection.id)?.status ?? { state: 'connecting' } : { state: 'disabled' }
    })))
  }

  /** Start checking every enabled connection. */
  async start(): Promise<void> {
    for (const connection of await this.store.list()) if (connection.enabled) void this.refresh(connection.id)
  }

  stop(): void {
    this.stopped = true
    for (const entry of this.entries.values()) clearTimeout(entry.timer)
    this.entries.clear()
  }

  /** A window gained focus: retry failed connections now instead of waiting for the backoff. */
  retryFailed(): void {
    for (const [id, entry] of this.entries) if (entry.status.state === 'error') { clearTimeout(entry.timer); void this.refresh(id) }
  }

  async save(input: unknown): Promise<RemoteConnection> {
    const value = validateConnectionInput(input)
    // Resolve the identity file on this computer; renderer checks are only hints.
    const spec = await validateRemoteSpec({ transport: 'ssh', ...value.ssh, adapter: 'custom', executable: 'true', args: [] })
    const ssh: RemoteConnectionInput['ssh'] = { ...value.ssh, ...(spec.identityFile ? { identityFile: spec.identityFile } : {}) }
    const previous = value.id ? await this.store.get(value.id) : undefined
    const saved = await this.store.save({ ...value, ssh })
    if (previous && previous.targetRevision !== saved.targetRevision) {
      // The old target is gone: close its multiplexed connection and forget its probe.
      await closeRemoteConnections(baseSpec(previous)).catch(() => {})
      forgetRemoteProbes()
    }
    if (saved.enabled) void this.refresh(saved.id)
    return saved
  }

  async setEnabled(id: string, enabled: boolean): Promise<RemoteConnection> {
    const saved = await this.store.setEnabled(id, enabled)
    if (enabled) void this.refresh(id)
    else {
      this.clear(id)
      this.publish(id, { state: 'disabled' })
      await closeRemoteConnections(baseSpec(saved)).catch(() => {})
    }
    return saved
  }

  async remove(id: string): Promise<void> {
    const connection = await this.store.get(id)
    await this.store.remove(id)
    this.clear(id)
    this.entries.delete(id)
    if (connection) await closeRemoteConnections(baseSpec(connection)).catch(() => {})
  }

  private clear(id: string): void { clearTimeout(this.entries.get(id)?.timer) }

  private publish(id: string, status: ConnectionStatus): void {
    const entry = this.entries.get(id) ?? { status, attempt: 0 }
    entry.status = status
    this.entries.set(id, entry)
    for (const listener of this.listeners) listener(id, status)
  }

  /** One check now, then keep-alive or backoff. Concurrent refreshes share one check;
   * a refresh requested while the target changed runs again once that check ends. */
  refresh(id: string): Promise<void> {
    // The running check re-checks on its own if the target moved meanwhile.
    const existing = this.entries.get(id)?.checking
    if (existing) return existing
    let checked: RemoteConnection | undefined
    const work = (async () => {
      const connection = await this.store.get(id)
      if (this.stopped || !connection || !connection.enabled) { this.clear(id); return }
      checked = connection
      const entry = this.entries.get(id)
      if (!entry || entry.status.state !== 'connected') this.publish(id, { state: 'connecting' })
      let result: { latencyMs: number } | { error: unknown }
      try { result = { latencyMs: await this.check(connection) } } catch (error) { result = { error } }
      // Disabled, removed or edited while checking: this result belongs to an old target.
      const latest = await this.store.get(id)
      if (this.stopped || !latest?.enabled || latest.targetRevision !== connection.targetRevision) return
      if ('latencyMs' in result) {
        this.publish(id, { state: 'connected', latencyMs: result.latencyMs, agents: (await this.agentsOn(id)).length })
        this.entries.get(id)!.attempt = 0
        this.schedule(id, KEEPALIVE_MS)
      } else {
        const attempt = this.entries.get(id)?.attempt ?? 0
        const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]
        this.publish(id, { state: 'error', message: result.error instanceof Error ? result.error.message : String(result.error), retryAt: Date.now() + delay })
        this.entries.get(id)!.attempt = attempt + 1
        this.schedule(id, delay)
      }
    })().finally(() => { const entry = this.entries.get(id); if (entry) entry.checking = undefined })
      .then(async () => {
        // The target moved during the check: check the new one now instead of never.
        const latest = await this.store.get(id)
        if (checked && latest?.enabled && latest.targetRevision !== checked.targetRevision && !this.stopped) await this.refresh(id)
      })
    const entry = this.entries.get(id) ?? { status: { state: 'connecting' } as ConnectionStatus, attempt: 0 }
    entry.checking = work
    this.entries.set(id, entry)
    return work
  }

  private schedule(id: string, delay: number): void {
    if (this.stopped) return
    const entry = this.entries.get(id)
    if (!entry) return
    clearTimeout(entry.timer)
    entry.timer = setTimeout(() => void this.refresh(id), delay)
    entry.timer.unref?.()
  }

  /** Each step reports a readable reason; later steps are skipped after a failure. */
  async test(id: string, signal?: AbortSignal): Promise<ConnectionTestReport> {
    const connection = await this.store.get(id)
    if (!connection) throw new Error('Connection not found')
    if (!connection.enabled) throw new Error('This connection is turned off.')
    const started = Date.now()
    const steps: ConnectionTestStep[] = []
    const spec = baseSpec(connection)
    const step = async (name: ConnectionTestStep['name'], work: () => Promise<string | void>): Promise<boolean> => {
      try { const message = await work(); steps.push({ name, passed: true, ...(message ? { message } : {}) }); return true }
      catch (error) { steps.push({ name, passed: false, message: error instanceof Error ? error.message : String(error) }); return false }
    }
    let home = ''
    const ok = await step('ssh', async () => { await remoteCheck(spec, 'true\n', { signal, timeoutMs: 20_000 }) })
      && await step('shell', async () => {
        const output = (await remoteCheck(spec, 'set -u\ncommand -v base64 >/dev/null || { echo "base64 is missing on the server" >&2; exit 3; }\nuname -s\n', { signal, timeoutMs: 20_000, maxStdout: 256 })).toString('utf8').trim()
        return output
      })
      && await step('environment', async () => {
        const probed = await probeRemoteAgent(spec, signal, true)
        home = probed.remoteHome
        await this.store.recordProbe(id, connection.targetRevision, { home: probed.remoteHome, path: probed.remotePath, checkedAt: Date.now() })
        return probed.remoteHome
      })
      && await step('workspace', async () => {
        const runId = randomUUID()
        await remoteCheck(spec, prepareScript(runId), { signal, timeoutMs: 30_000 })
        await remoteCheck(spec, cleanupScript(runId, false), { signal, timeoutMs: 15_000 }).catch(() => undefined)
        return `${home}/.douchat-remote`
      })
    // Optional: without it agents still run, but Douchat skill tools are unavailable on this server.
    if (ok) await step('forwarding', async () => {
      const bridge = await (await openSshTransport(spec, signal)).openBridge([], signal ?? new AbortController().signal)
      if (!bridge) throw new Error('This server does not allow UNIX-socket forwarding over SSH (AllowStreamLocalForwarding). Agents still run, but Douchat skill tools are unavailable.')
      bridge.close()
    })
    const passed = ok
    if (passed && connection.enabled) void this.refresh(id)
    return { ok: passed, steps, durationMs: Date.now() - started }
  }

  /** Every known CLI on the server, found with its login PATH. */
  async discover(id: string, signal?: AbortSignal): Promise<DiscoveredRemoteAgent[]> {
    const connection = await this.store.get(id)
    if (!connection) throw new Error('Connection not found')
    if (!connection.enabled) throw new Error('This connection is turned off.')
    const output = await remoteCheck(baseSpec(connection), discoverScript(), { signal, timeoutMs: 90_000, maxStdout: 64 * 1024 })
    return parseDiscovery(output.toString('utf8'))
  }
}

/** Lightweight reachability check; reuses the multiplexed connection when one is open. */
async function defaultCheck(connection: RemoteConnection): Promise<number> {
  const started = Date.now()
  const spec = baseSpec(connection)
  try { await remoteCheck(spec, 'true\n', { timeoutMs: 20_000 }) }
  catch (error) { throw error instanceof Error ? error : sshFailure(spec, String(error), null) }
  return Date.now() - started
}
