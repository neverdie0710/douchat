import type { AgentExecutor } from '../shared/agentExecutor'
import { runLocalAgent, disposeLocalAgentSessions, resetLocalAgentConversation } from './localAgentRuntime'

/** The only default execution adapter today is the local desktop. */
export const desktopAgentExecutor: AgentExecutor = {
  run: (...args) => runLocalAgent(...args),
  disposeAgent: agentId => disposeLocalAgentSessions(agentId),
  resetConversation: (...args) => resetLocalAgentConversation(...args)
}
