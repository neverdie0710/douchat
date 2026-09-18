import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSnapshot,
  CodeArtifactInput,
  CreateAgentInput,
  EndpointInput,
  EmailConnectorInput,
  MessageImageInput,
  CreateGroupInput,
  CreateRoutineInput,
  UpdateAgentInput,
  UpdateConversationInput,
  UpdateDesktopProfileInput,
  UpdateState,
  DouchatApi,
  DesktopAuthState
} from '../shared/types'

const api: DouchatApi = {
  platform: process.platform,
  microphonePermissionOwner: 'Douchat',
  windowAction: (action) => ipcRenderer.send('douchat:window-action', action),
  requestMicrophoneAccess: () => ipcRenderer.invoke('douchat:request-microphone-access'),
  openMicrophoneSettings: () => ipcRenderer.invoke('douchat:open-microphone-settings'),
  getAuthState: () => ipcRenderer.invoke('douchat:get-auth-state'),
  startLogin: () => ipcRenderer.invoke('douchat:start-login'),
  retryAuth: () => ipcRenderer.invoke('douchat:retry-auth'),
  signOut: () => ipcRenderer.invoke('douchat:sign-out'),
  refreshProfile: () => ipcRenderer.invoke('douchat:refresh-profile'),
  updateProfile: (input: UpdateDesktopProfileInput) => ipcRenderer.invoke('douchat:update-profile', input),
  getUpdateState: () => ipcRenderer.invoke('douchat:get-update-state'),
  checkForUpdates: () => ipcRenderer.invoke('douchat:check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('douchat:install-update'),
  detectLocalAgents: () => ipcRenderer.invoke('douchat:detect-local-agents'),
  searchMessages: (conversationId, query) => ipcRenderer.invoke('douchat:search-messages', conversationId, query),
  getMessagePage: (conversationId, topicId, before) => ipcRenderer.invoke('douchat:message-page', conversationId, topicId, before),
  getAttachmentData: (attachmentId) => ipcRenderer.invoke('douchat:attachment-data', attachmentId),
  getSnapshot: () => ipcRenderer.invoke('douchat:get-snapshot'),
  createAgent: (input: CreateAgentInput) => ipcRenderer.invoke('douchat:create-agent', input),
  updateAgent: (agentId: string, input: UpdateAgentInput) => ipcRenderer.invoke('douchat:update-agent', agentId, input),
  deleteAgent: (agentId: string) => ipcRenderer.invoke('douchat:delete-agent', agentId),
  startDirectChat: (agentId: string) => ipcRenderer.invoke('douchat:start-direct-chat', agentId),
  createGroup: (input: CreateGroupInput) => ipcRenderer.invoke('douchat:create-group', input),
  updateConversation: (conversationId: string, input: UpdateConversationInput) =>
    ipcRenderer.invoke('douchat:update-conversation', conversationId, input),
  openConversationWindow: (conversationId: string) => ipcRenderer.invoke('douchat:open-conversation-window', conversationId),
  openCodeArtifact: (input: CodeArtifactInput) => ipcRenderer.invoke('douchat:open-code-artifact', input),
  getCodeArtifact: (artifactId: string) => ipcRenderer.invoke('douchat:get-code-artifact', artifactId),
  testEmailConnector: (input: EmailConnectorInput) => ipcRenderer.invoke('douchat:test-email-connector', input),
  saveEmailConnector: (input: EmailConnectorInput) => ipcRenderer.invoke('douchat:save-email-connector', input),
  disconnectEmailConnector: (connectorId: string) => ipcRenderer.invoke('douchat:disconnect-email-connector', connectorId),
  deleteConversation: (conversationId: string) => ipcRenderer.invoke('douchat:delete-conversation', conversationId),
  setConversationPinned: (conversationId: string, pinned: boolean) =>
    ipcRenderer.invoke('douchat:set-conversation-pinned', conversationId, pinned),
  markConversationRead: (conversationId: string) => ipcRenderer.invoke('douchat:mark-read', conversationId),
  markAllConversationsRead: () => ipcRenderer.invoke('douchat:mark-all-read'),
  createTopic: (conversationId: string) => ipcRenderer.invoke('douchat:create-topic', conversationId),
  renameTopic: (conversationId: string, topicId: string, title: string) =>
    ipcRenderer.invoke('douchat:rename-topic', conversationId, topicId, title),
  deleteTopic: (conversationId: string, topicId: string) =>
    ipcRenderer.invoke('douchat:delete-topic', conversationId, topicId),
  setActiveTopic: (conversationId: string, topicId: string) =>
    ipcRenderer.invoke('douchat:set-active-topic', conversationId, topicId),
  sendMessage: (conversationId: string, text: string, images?: MessageImageInput[]) =>
    ipcRenderer.invoke('douchat:send-message', conversationId, text, images),
  stopConversation: (conversationId: string) => ipcRenderer.invoke('douchat:stop-conversation', conversationId),
  clearConversation: (conversationId: string) => ipcRenderer.invoke('douchat:clear-conversation', conversationId),
  setEndpoint: (input: EndpointInput) => ipcRenderer.invoke('douchat:set-endpoint', input),
  testEndpoint: (input: EndpointInput) => ipcRenderer.invoke('douchat:test-endpoint', input),
  createRoutine: (input: CreateRoutineInput) => ipcRenderer.invoke('douchat:create-routine', input),
  deleteRoutine: (routineId: string) => ipcRenderer.invoke('douchat:delete-routine', routineId),
  setRoutineEnabled: (routineId: string, enabled: boolean) =>
    ipcRenderer.invoke('douchat:set-routine-enabled', routineId, enabled),
  runRoutineNow: (routineId: string) => ipcRenderer.invoke('douchat:run-routine-now', routineId),
  startComputer: (agentId: string) => ipcRenderer.invoke('douchat:start-computer', agentId),
  stopComputer: (agentId: string) => ipcRenderer.invoke('douchat:stop-computer', agentId),
  showComputer: (agentId: string) => ipcRenderer.invoke('douchat:show-computer', agentId),
  onAuthState: (listener: (state: DesktopAuthState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopAuthState): void => listener(state)
    ipcRenderer.on('douchat:auth-state', handler)
    return () => ipcRenderer.removeListener('douchat:auth-state', handler)
  },
  onUpdateState: (listener: (state: UpdateState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: UpdateState): void => listener(state)
    ipcRenderer.on('douchat:update-state', handler)
    return () => ipcRenderer.removeListener('douchat:update-state', handler)
  },
  onSnapshot: (listener: (snapshot: AppSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot): void => listener(snapshot)
    ipcRenderer.on('douchat:snapshot', handler)
    return () => ipcRenderer.removeListener('douchat:snapshot', handler)
  }
}

contextBridge.exposeInMainWorld('douchat', api)
