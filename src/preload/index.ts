import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSnapshot,
  CodeArtifactInput,
  CreateAgentInput,
  CustomLocalAgentInput,
  EndpointInput,
  EmailConnectorInput,
  MessageImageInput,
  CreateGroupInput,
  CreateRoutineInput,
  UpdateAgentInput,
  UpdateConversationInput,
  UpdateDesktopProfileInput,
  UsageSummary,
  UpdateState,
  DouchatApi,
  DesktopAuthState
} from '../shared/types'

const api: DouchatApi = {
  resizeDialog: (name, width, height) => ipcRenderer.invoke('douchat:resize-dialog', name, width, height),
  reportDiagnostic: (event, detail) => ipcRenderer.send('douchat:diagnostic', event, detail),
  openDiagnosticLogs: () => ipcRenderer.invoke('douchat:open-diagnostic-logs'),
  copyText: (text) => ipcRenderer.invoke('douchat:copy-text', text),
  copyAttachment: (id) => ipcRenderer.invoke('douchat:copy-attachment', id),
  getSocialSnapshot: () => ipcRenderer.invoke('douchat:social-snapshot'),
  socialAction: (input) => ipcRenderer.invoke('douchat:social-action', input),
  platform: process.platform,
  microphonePermissionOwner: 'Douchat',
  windowAction: (action) => ipcRenderer.send('douchat:window-action', action),
  requestMicrophoneAccess: () => ipcRenderer.invoke('douchat:request-microphone-access'),
  openMicrophoneSettings: () => ipcRenderer.invoke('douchat:open-microphone-settings'),
  setInterfaceLanguage: (language: string) => ipcRenderer.invoke('douchat:set-interface-language', language),
  getAuthState: () => ipcRenderer.invoke('douchat:get-auth-state'),
  startLogin: () => ipcRenderer.invoke('douchat:start-login'),
  retryAuth: () => ipcRenderer.invoke('douchat:retry-auth'),
  signOut: () => ipcRenderer.invoke('douchat:sign-out'),
  refreshProfile: () => ipcRenderer.invoke('douchat:refresh-profile'),
  updateProfile: (input: UpdateDesktopProfileInput) => ipcRenderer.invoke('douchat:update-profile', input),
  getUsageSummary: (): Promise<UsageSummary> => ipcRenderer.invoke('douchat:get-usage-summary'),
  consumeCreditsReturn: (): Promise<boolean> => ipcRenderer.invoke('douchat:consume-credits-return'),
  openSubscriptionPlans: () => ipcRenderer.invoke('douchat:open-subscription-plans'),
  openBillingPortal: () => ipcRenderer.invoke('douchat:open-billing-portal'),
  getUpdateState: () => ipcRenderer.invoke('douchat:get-update-state'),
  checkForUpdates: () => ipcRenderer.invoke('douchat:check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('douchat:install-update'),
  maintainLocalAgent: (id: string) => ipcRenderer.invoke('douchat:maintain-local-agent', id),
  listLocalAgentModels: (agentId: string) => ipcRenderer.invoke('douchat:list-local-agent-models', agentId),
  detectLocalAgents: () => ipcRenderer.invoke('douchat:detect-local-agents'),
  openLocalAgentTerminal: (id: 'claude') => ipcRenderer.invoke('douchat:open-local-agent-terminal', id),
  addCustomLocalAgent: (input: CustomLocalAgentInput) => ipcRenderer.invoke('douchat:add-custom-local-agent', input),
  removeCustomLocalAgent: (id: string) => ipcRenderer.invoke('douchat:remove-custom-local-agent', id),
  searchMessages: (conversationId, query) => ipcRenderer.invoke('douchat:search-messages', conversationId, query),
  getMessagePage: (conversationId, topicId, before) => ipcRenderer.invoke('douchat:message-page', conversationId, topicId, before),
  getAttachmentData: (attachmentId) => ipcRenderer.invoke('douchat:attachment-data', attachmentId),
  openLocalFile: (path) => ipcRenderer.invoke('douchat:open-local-file', path),
  getSnapshot: () => ipcRenderer.invoke('douchat:get-snapshot'),
  getCustomModels: () => ipcRenderer.invoke('douchat:custom-models'),
  getDecisionSettings: () => ipcRenderer.invoke('douchat:decision-settings'),
  getCloudDecisionModels: () => ipcRenderer.invoke('douchat:cloud-decision-models'),
  saveDecisionSettings: (settings) => ipcRenderer.invoke('douchat:save-decision-settings', settings),
  testDecisionSettings: (settings) => ipcRenderer.invoke('douchat:test-decision-settings', settings),
  saveCustomModels: (providers, defaultModel) => ipcRenderer.invoke('douchat:save-custom-models', providers, defaultModel),
  testCustomModel: (input) => ipcRenderer.invoke('douchat:test-custom-model', input),
  createAgent: (input: CreateAgentInput) => ipcRenderer.invoke('douchat:create-agent', input),
  resolveAgentPermission: (id, allow) => ipcRenderer.invoke('douchat:resolve-agent-permission', id, allow),
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
  deleteMessage: (conversationId: string, messageId: string) => ipcRenderer.invoke('douchat:delete-message', conversationId, messageId),
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
  onCreditsUpdated: (listener: () => void) => {
    const handler = (): void => listener()
    ipcRenderer.on('douchat:credits-updated', handler)
    return () => ipcRenderer.removeListener('douchat:credits-updated', handler)
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
