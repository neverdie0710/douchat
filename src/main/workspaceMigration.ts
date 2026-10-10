import type { MigratedAgent } from './connectionStore'
import type { DouchatStore } from './store'

/**
 * Folders chosen in P0 are bound to the agent's own SSH target
 * (ssh-legacy:<hash>, revision). After the move to connections they are left
 * exactly as they are: a migrated agent keeps that identity until its
 * connection is edited or it moves to another one, so these folders and its
 * native threads stay valid. Only folders whose agent and target are known
 * are kept; anything else for a migrated agent is dropped and must be chosen again.
 */
export function migrateWorkspaceTargets(store: DouchatStore, agents: Record<string, MigratedAgent>): number {
  let dropped = 0
  const byLocalId = new Map(Object.entries(agents))
  if (!byLocalId.size) return 0
  for (const conversation of store.conversations) {
    for (const [agentId, binding] of Object.entries(conversation.agentWorkspaces ?? {})) {
      const localId = store.agent(agentId)?.localAgentId
      const migrated = localId ? byLocalId.get(localId) : undefined
      if (!migrated || !binding.executionTargetId.startsWith('ssh-legacy:')) continue
      if (binding.executionTargetId === migrated.legacyTargetId && binding.targetRevision === migrated.legacyRevision) continue
      // Ownership cannot be proven: the folder was saved for another target.
      store.setAgentWorkspace(conversation.id, agentId, undefined)
      dropped++
    }
  }
  return dropped
}
