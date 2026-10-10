import { randomUUID } from 'node:crypto'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { RemoteAgentSpec } from '../shared/types'
import { openLocalSkillBridge } from './localSkillBridge'
import { bridgeCheckScript, bridgeCleanupScript, bridgeSocketPath } from './remoteScript'
import { remoteExec, sshBinary, sshBridgeArgs, sshLaunchEnvironment, spawnLaunch } from './remoteTransport'
import { killLocalProcess } from './localAgentConnection'
import { connect, type Socket } from 'node:net'
import { adoptRelayStream, openRelayStream, type RelayFrame, type RelayStream } from './remote/daemonRelay'

export interface SkillBridge { close: () => void; prompt: string }

/** Per-turn skill bridge for a remote agent: the loopback bridge on this
 * computer is exposed only as a 0600 UNIX socket in the remote user's private
 * directory. No TCP port is opened on the server and there is no TCP fallback. */
export async function openRemoteSkillBridge(
  spec: RemoteAgentSpec & { remoteHome: string }, tools: AgentTool[], signal: AbortSignal
): Promise<SkillBridge | undefined> {
  const local = await openLocalSkillBridge(tools, signal)
  const id = randomUUID()
  const socket = bridgeSocketPath(spec.remoteHome, id)
  const child = spawnLaunch({ file: sshBinary(), args: sshBridgeArgs(spec, socket, local.port), env: await sshLaunchEnvironment() })
  let exited = false
  child.once('exit', () => { exited = true })
  child.once('error', () => { exited = true })
  child.stdout.resume(); child.stderr.resume()
  child.stdin.end()
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    signal.removeEventListener('abort', close)
    local.close()
    killLocalProcess(child)
    void remoteExec(spec, bridgeCleanupScript(id), { timeoutMs: 10_000 }).catch(() => undefined)
  }
  signal.addEventListener('abort', close, { once: true })
  try {
    // ExitOnForwardFailure makes ssh exit when sshd refuses StreamLocal forwarding.
    for (let attempt = 0; attempt < 24; attempt++) {
      signal.throwIfAborted()
      if (exited) throw new Error('Forwarding refused')
      const check = await remoteExec(spec, bridgeCheckScript(id), { signal, timeoutMs: 10_000 })
      if (check.code === 0) break
      if (attempt === 23) throw new Error('Forwarding timed out')
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  } catch {
    close()
    return undefined
  }
  return { close, prompt: bridgePrompt(socket, local) }
}

function bridgePrompt(socket: string, local: { token: string; tools: string }): string {
  return [
    'Douchat skill tools for THIS TURN ONLY: use your native shell tool on the server to POST JSON {"tool":"tool_name","arguments":{...}} to the private UNIX socket below. This is the supported way to install skills into Douchat and deliver files. Keep this private token out of replies and files; discard older sockets from history. Wait for the response (owner approval can take several minutes).',
    `Command: curl -sS --unix-socket ${socket} -H 'Authorization: Bearer ${local.token}' -H 'Content-Type: application/json' --data-binary @- http://localhost/tools`,
    'Send the JSON on stdin (for example with a quoted heredoc) rather than interpolating commands or file contents into shell strings.',
    local.tools
  ].join('\n')
}

/** The same bridge through douchat-host: the host listens on the socket and
 * carries each connection back here, where it reaches the loopback bridge. */
export async function openDaemonSkillBridge(
  spec: RemoteAgentSpec & { remoteHome: string }, tools: AgentTool[], signal: AbortSignal
): Promise<SkillBridge | undefined> {
  const local = await openLocalSkillBridge(tools, signal)
  const socket = bridgeSocketPath(spec.remoteHome, randomUUID())
  let listener: RelayStream
  try { listener = await openRelayStream(spec, { kind: 'listen', socketPath: socket }, signal) } catch { local.close(); return undefined }
  const connections = new Set<{ stream: RelayStream; socket: Socket }>()
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    signal.removeEventListener('abort', close)
    listener.close()
    for (const item of connections) { item.stream.close(); item.socket.destroy() }
    connections.clear()
    local.close()
  }
  signal.addEventListener('abort', close, { once: true })
  const listening = new Promise<boolean>(resolve => {
    const timer = setTimeout(() => resolve(false), 15_000)
    listener.on('frame', (frame: RelayFrame) => {
      if (frame.type === 'out' && frame.extra?.listening === true) { clearTimeout(timer); resolve(true) }
      else if (frame.type === 'exit' || frame.type === 'error') { clearTimeout(timer); resolve(false); close() }
      else if (frame.type === 'accept' && typeof frame.extra?.childId === 'string' && !closed) {
        const stream = adoptRelayStream(frame.extra.childId, spec.host)
        const tcp = connect({ host: '127.0.0.1', port: local.port })
        const item = { stream, socket: tcp }
        connections.add(item)
        tcp.on('data', (data: Buffer) => stream.send('in', data))
        tcp.on('end', () => stream.send('eof'))
        tcp.on('error', () => undefined)
        tcp.once('close', () => { connections.delete(item); stream.close() })
        stream.on('frame', (next: RelayFrame) => {
          if (next.type === 'out' && next.data) tcp.write(next.data)
          else if (next.type === 'exit' || next.type === 'error') tcp.end()
        })
      }
    })
  })
  if (!(await listening)) { close(); return undefined }
  return { close, prompt: bridgePrompt(socket, local) }
}

export const remoteBridgeUnavailablePrompt = 'Douchat skill tools are unavailable for this turn because the server does not allow UNIX-socket forwarding (over SSH or douchat-host). Do not try to reach Douchat through other network paths.'
