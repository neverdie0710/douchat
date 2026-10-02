import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { validateToolArguments } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'

/** Per-turn localhost capability: no public listener, no general IPC, no persistent token. */
export async function openLocalSkillBridge(tools: AgentTool[], signal: AbortSignal) {
  const token = randomBytes(32).toString('hex')
  const lifetime = new AbortController()
  const active = AbortSignal.any([signal, lifetime.signal])
  let busy = false
  const server = createServer(async (req, res) => {
    const send = (code: number, value: unknown) => { if (!res.destroyed) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) } }
    if (req.headers.origin || req.method !== 'POST' || req.url !== '/tools' || req.headers.authorization !== `Bearer ${token}` || active.aborted) { send(403, { error: 'Unauthorized' }); return }
    if (busy) { send(409, { error: 'A skill operation is already pending' }); return }
    busy = true
    const disconnect = new AbortController()
    res.on('close', () => { if (!res.writableEnded) disconnect.abort() })
    try {
      let size = 0; const chunks: Buffer[] = []
      for await (const part of req) {
        size += part.length
        if (size > 3_000_000) throw new Error('Skill request exceeds 3 MB')
        chunks.push(Buffer.from(part))
      }
      const call = JSON.parse(Buffer.concat(chunks).toString())
      const tool = tools.find(tool => tool.name === call.tool)
      if (!tool) throw new Error('Unknown skill tool')
      const args = validateToolArguments(tool, { type: 'toolCall', id: 'local-skill', name: tool.name, arguments: call.arguments ?? {} })
      const operationSignal = AbortSignal.any([active, disconnect.signal])
      operationSignal.throwIfAborted()
      const output = await tool.execute('local-skill', args, operationSignal)
      send(200, output)
    } catch (error) { send(400, { error: error instanceof Error ? error.message : String(error) }) }
    finally { busy = false }
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not open local skill bridge')
  const close = () => { lifetime.abort(); server.closeAllConnections(); server.close(); signal.removeEventListener('abort', close) }
  signal.addEventListener('abort', close, { once: true })
  if (signal.aborted) { close(); signal.throwIfAborted() }
  const endpoint = `http://127.0.0.1:${address.port}/tools`
  return { close, isBridgeCommand: (command: unknown) => !active.aborted && isBridgeCurl(command, endpoint, token), prompt: [
    'Douchat skill tools for THIS TURN ONLY: use your native shell/HTTP tool to POST JSON {"tool":"tool_name","arguments":{...}} to the loopback endpoint below. This is the supported way to install skills into Douchat, including another owned agent. Do not write its database. Keep this private token out of replies and files; discard older endpoints from history. Wait for the response (owner approval can take several minutes). If your native shell needs permission, request it normally.',
    `Endpoint: ${endpoint}`, `Authorization: Bearer ${token}`,
    `Send Content-Type: application/json. Use exactly this shape, which Douchat runs without asking the human: curl -sS -X POST ${endpoint} -H 'Content-Type: application/json' -H 'Authorization: Bearer <token>' --data-binary @- <<'EOF' (JSON on the following lines, then EOF). Do not add pipes, other commands or files.`,
    JSON.stringify(tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })))
  ].join('\n') }
}

/** True only for a plain `curl` POST of JSON to this turn's endpoint and token.
 * The request body comes from a quoted heredoc or a single-quoted argument, so
 * the shell expands nothing; any other syntax, flag or file access is rejected. */
export function isBridgeCurl(command: unknown, endpoint: string, token: string): boolean {
  if (typeof command !== 'string' || command.length > 3_000_000) return false
  let head = command.trim()
  const heredoc = /^([^\n]*?)\s*<<\s*'([A-Za-z_]+)'\n([\s\S]*)\n\2$/.exec(head)
  if (heredoc) head = heredoc[1]
  else if (head.includes('\n')) return false
  const tokens: string[] = []
  const pattern = /\s*('[^']*'|"[^"$`\\!]*"|[A-Za-z0-9@:/._=,-]+)(?=\s|$)/y
  while (pattern.lastIndex < head.length) {
    const match = pattern.exec(head)
    if (!match) return false
    const raw = match[1]
    tokens.push(raw.startsWith("'") || raw.startsWith('"') ? raw.slice(1, -1) : raw)
  }
  if (tokens.shift() !== 'curl') return false
  let url = false, auth = false, body = false
  for (let i = 0; i < tokens.length; i++) {
    const value = tokens[i]
    if (value === endpoint) url = true
    else if (['-s', '-S', '-sS', '--silent', '--show-error', '--fail', '-f', '--fail-with-body'].includes(value)) continue
    else if (value === '-X' || value === '--request') { if (tokens[++i] !== 'POST') return false }
    else if (value === '-m' || value === '--max-time') { if (!/^\d{1,4}$/.test(tokens[++i] ?? '')) return false }
    else if (value === '-H' || value === '--header') {
      const header = tokens[++i] ?? ''
      if (/^authorization:\s*/i.test(header)) { if (header.replace(/^authorization:\s*/i, '') !== `Bearer ${token}`) return false; auth = true }
      else if (!/^content-type:\s*application\/json$/i.test(header)) return false
    } else if (['-d', '--data', '--data-binary', '--data-raw'].includes(value)) {
      const data = tokens[++i]
      if (data === undefined || body || (data === '@-') !== Boolean(heredoc) || (data !== '@-' && data.startsWith('@'))) return false
      body = true
    } else return false
  }
  return url && auth && body
}
