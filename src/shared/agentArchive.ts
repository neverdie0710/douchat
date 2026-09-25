import { agentFileNames, type AgentFiles, type AgentSkill } from './agentCustomization'

export const portableAgentFiles = agentFileNames.filter(name => name !== 'USER.md' && name !== 'MEMORY.md')
export interface AgentArchivePreview {
  sourceRoot?: string
  format?: string
  warnings?: string[]
  candidates?: { root: string; name: string }[]
  name: string
  systemFiles: AgentFiles
  skills: AgentSkill[]
}
