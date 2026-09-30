import { randomUUID } from 'node:crypto'
import type { CustomLocalAgentInput } from '../shared/types'
import { executableVersion, resolveLocalAgentDraft } from './localAgents'
import { disposeLocalAgentSessions, runLocalAgent } from './localAgentRuntime'

export async function testLocalAgent(id: string | undefined, input: CustomLocalAgentInput, signal?: AbortSignal): Promise<{ reply: string; durationMs: number; version?: string }> {
  const started = Date.now()
  const abort = new AbortController()
  const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal
  const timer = setTimeout(() => abort.abort(new Error('Connection test timed out after 30 seconds.')), 30_000)
  const probeId = `local-test:${randomUUID()}`
  try {
    const agent = await resolveLocalAgentDraft(id, input, combined)
    combined.throwIfAborted()
    const reply = await runLocalAgent({
      id: probeId, name: agent.name, localAgentId: agent.id, role: '', instructions: '',
      color: '', provider: 'local', model: 'default', createdAt: started
    }, 'Connection test. Reply with exactly DOUCHAT_OK. Do not use tools, read files, or perform any other action.', combined, [], {
      agentOverride: agent, sessionKey: probeId, transient: true, imageToolsAllowed: false
    })
    // A --help/version banner or an echoed prompt is not a successful model round trip.
    if (reply.text.trim() !== 'DOUCHAT_OK') throw new Error(`Unexpected test response: ${reply.text.slice(0, 600) || '(empty)'}`)
    const durationMs = Date.now() - started
    clearTimeout(timer)
    const version = agent.remote ? agent.version : agent.path ? await executableVersion(agent.path) : undefined
    combined.throwIfAborted()
    return { reply: reply.text, durationMs, version }
  } catch (error) {
    if (combined.aborted) throw combined.reason
    throw error
  } finally {
    clearTimeout(timer)
    disposeLocalAgentSessions(probeId)
  }
}
