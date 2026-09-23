import { randomUUID } from 'node:crypto'
import { agentPermissions, type PermissionRequest, type SensitiveCapability } from '../shared/agentPermissions'
import type { AgentConfig } from '../shared/types'

export function toolCapability(name: string): SensitiveCapability {
  if (name === 'computer_list_files' || name === 'computer_open_file') return 'filesRead'
  if (['computer_make_directory', 'computer_move_file'].includes(name)) return 'filesWrite'
  if (name === 'computer_open') return 'network'
  if (name.startsWith('computer_')) return 'browserControl'
  if (/^(email|mail)_/.test(name)) return /send|delete|move|mark|draft|reply/.test(name) ? 'accountWrite' : 'accountRead'
  if (name === 'create_routine') return 'automation'
  return 'otherTools'
}

/** Decisions live in the owner main process, never in model arguments or requester IPC. */
export class AgentPermissionBroker {
  private pending = new Map<string, { request: PermissionRequest; finish: (result: 'allowed' | 'declined' | 'expired' | 'cancelled') => void }>()
  constructor(private readonly currentOwner: () => string | undefined, private readonly changed: () => void) {}
  snapshot(): PermissionRequest[] { return [...this.pending.values()].map((p) => p.request).filter((p) => p.ownerId === this.currentOwner()) }
  hasPending(agentId: string): boolean { return [...this.pending.values()].some((entry) => entry.request.agentId === agentId) }
  resolve(id: string, allow: boolean): void {
    const entry = this.pending.get(id)
    if (!entry || entry.request.ownerId !== this.currentOwner()) throw new Error('Permission request is no longer available')
    entry.finish(allow === true ? 'allowed' : 'declined')
  }
  cancelAgent(id: string): void {
    for (const entry of this.pending.values()) if (entry.request.agentId === id) entry.finish('cancelled')
  }
  async authorize(config: AgentConfig, input: Pick<PermissionRequest, 'requester' | 'requesterId' | 'requesterKind' | 'roomName' | 'capability' | 'operation' | 'details'>, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (!config.ownerId || config.ownerId !== this.currentOwner()) throw new Error('Agent account changed')
    if (input.details.length > 64000) throw new Error('Operation is too large to review; split it into smaller requests')
    const policy = agentPermissions(config.permissions)
    const rule = input.capability === 'groupHumans' || input.capability === 'groupAgents' ? policy[input.capability] : policy.sensitive[input.capability]
    if (rule === 'deny') throw new Error('The owner has disabled this permission')
    if (rule === 'allow') return
    if (this.pending.size >= 20) throw new Error('Too many permission requests')
    const result = await new Promise<'allowed' | 'declined' | 'expired' | 'cancelled'>((resolve) => {
      const id = randomUUID()
      let timer: ReturnType<typeof setTimeout>
      const abort = (): void => finish('cancelled')
      const finish = (result: 'allowed' | 'declined' | 'expired' | 'cancelled'): void => {
        if (!this.pending.delete(id)) return
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        resolve(result)
        this.changed()
      }
      timer = setTimeout(() => finish('expired'), 10 * 60_000)
      this.pending.set(id, { request: { ...input, id, ownerId: config.ownerId!, agentId: config.id, agentName: config.name, createdAt: Date.now(), details: input.details }, finish })
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
      this.changed()
    })
    signal?.throwIfAborted()
    if (config.ownerId !== this.currentOwner()) throw new Error('Agent account changed')
    if (result === 'declined') throw new Error('The owner declined this request')
    if (result === 'expired') throw new Error('Permission request expired')
    if (result === 'cancelled') throw new Error('Permission request cancelled')
  }
}
