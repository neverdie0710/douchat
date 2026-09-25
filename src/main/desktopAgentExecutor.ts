import type { AgentExecutor } from '../shared/agentExecutor'
import { runLocalAgent, disposeLocalAgentSessions, resetLocalAgentConversation, releaseIdleLocalAgentConnections } from './localAgentRuntime'

/** The only default execution adapter today is the local desktop. */
export const desktopAgentExecutor: AgentExecutor = {
  releaseIdleConnections: (...args) => releaseIdleLocalAgentConnections(...args),
  run: (...args) => runLocalAgent(...args),
  disposeAgent: agentId => disposeLocalAgentSessions(agentId),
  resetConversation: (...args) => resetLocalAgentConversation(...args)
}
