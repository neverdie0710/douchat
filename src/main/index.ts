import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, powerMonitor, session, shell, systemPreferences } from 'electron'
import electronUpdater from 'electron-updater'
import type {
  AppSnapshot,
  CodeArtifactInput,
  EmailConnectorInput,
  CreateAgentInput,
  DesktopAuthState,
  EndpointInput,
  MessageImageInput,
  CreateGroupInput,
  CreateRoutineInput,
  UpdateAgentInput,
  UpdateConversationInput,
  UpdateDesktopProfileInput,
  UpdateState
} from '../shared/types'
import { LocalComputerProvider } from './computer'
import { DouchatRuntime } from './runtime'
import { RoutineScheduler } from './scheduler'
import { DouchatStore } from './store'
import { detectLocalAgents, validateLocalAgent } from './localAgents'
import { resetShellPath } from './shellPath'
import { DesktopAuth } from './desktopAuth'
import { chatApiBaseUrl, desktopAuthScheme, isDesktopAuthUrl, normalizeWebAppUrl } from './authProtocol'
import { DesktopUpdater, type UpdateDriver } from './updater'
import { EmailConnectorManager } from './emailConnector'

const development = !app.isPackaged
const appIcon = join(app.getAppPath(), 'resources/icons', development ? 'douchat-dev.png' : 'douchat.png')
const authScheme = desktopAuthScheme()
const webAppUrl = normalizeWebAppUrl(
  process.env.DOUCHAT_SERVICE_URL || process.env.DOUCHAT_WEB_URL,
  development
)

/**
 * The data directory is pinned by hand rather than derived from `app.name`.
 *
 * Electron resolves userData as `appData/<app.name>`, and `app.name` follows
 * `productName` — which packaging tools routinely set, and which designers
 * routinely rename. That would silently move every transcript to a second
 * directory while the app looked perfectly healthy. The display name may
 * change; where the data lives may not.
 */
app.setPath('userData', join(app.getPath('appData'), 'douchat'))

let mainWindow: BrowserWindow | null = null
let store: DouchatStore
let runtime: DouchatRuntime
let computer: LocalComputerProvider
let scheduler: RoutineScheduler
let auth: DesktopAuth
let updater: DesktopUpdater
let emailConnectors: EmailConnectorManager
let pendingAuthUrl = ''
let cloudSessionActive = false

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (process.platform === 'darwin') app.focus({ steal: true })
  mainWindow.show()
  mainWindow.focus()
}

function callbackUrlFromArgs(args: string[]): string | undefined {
  return args.find((arg) => isDesktopAuthUrl(arg, authScheme))
}

function receiveAuthUrl(url: string): void {
  if (!isDesktopAuthUrl(url, authScheme)) return
  focusMainWindow()
  if (!auth) {
    pendingAuthUrl = url
    return
  }
  void auth.handleCallback(url)
}

if (hasSingleInstanceLock) {
  app.on('second-instance', (_event, commandLine) => {
    const url = callbackUrlFromArgs(commandLine)
    if (url) receiveAuthUrl(url)
    else focusMainWindow()
  })
  app.on('open-url', (event, url) => {
    event.preventDefault()
    receiveAuthUrl(url)
  })
}

const initialAuthUrl = callbackUrlFromArgs(process.argv)
if (initialAuthUrl) pendingAuthUrl = initialAuthUrl

function broadcast(snapshot: AppSnapshot): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('douchat:snapshot', snapshot)
}

function broadcastAuth(state: DesktopAuthState): void {
  let welcomeConversationId: string | undefined
  if (state.status === 'signed-in' && store && runtime) {
    // The service account is the identity authority. Keep only the name as a
    // local runtime cache so agent prompts use the same identity when offline.
    store.setUserName(state.user.name)
    const welcome = store.ensureDefaultCloudContact(state.user.id, runtime.defaultCloudAgentModel())
    welcomeConversationId = welcome.conversation?.id ?? store.defaultConversationId
    broadcast(runtime.snapshot())
  }
  const signedIn = state.status === 'signed-in'
  if (runtime && signedIn !== cloudSessionActive) {
    cloudSessionActive = signedIn
    void runtime.connect().then(async () => {
      // Wait for the account's Cloud model before asking Dr. Dou to open the
      // welcome chat. greet() is otherwise idempotent once a message exists.
      const current = auth?.getState()
      if (
        welcomeConversationId
        && state.status === 'signed-in'
        && current?.status === 'signed-in'
        && current.user.id === state.user.id
      ) {
        await runtime.greet(welcomeConversationId)
      }
      broadcast(runtime.snapshot())
    })
  }
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('douchat:auth-state', state)
}

function broadcastUpdate(state: UpdateState): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('douchat:update-state', state)
}

const chatWindows = new Map<string, BrowserWindow>()
function openChatWindow(conversationId: string): void {
  const existing = chatWindows.get(conversationId)
  if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return }
  const window = new BrowserWindow({ icon: appIcon, width: 820, height: 720, minWidth: 480, minHeight: 480, title: store.conversation(conversationId)?.name,
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  chatWindows.set(conversationId, window)
  window.on('closed', () => chatWindows.delete(conversationId))
  window.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    url.searchParams.set('conversation', conversationId)
    void window.loadURL(url.toString())
  } else void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { conversation: conversationId } })
}

const codeArtifacts = new Map<string, CodeArtifactInput>()
const codeArtifactWindows = new Map<string, BrowserWindow>()

function validateCodeArtifact(input: CodeArtifactInput): CodeArtifactInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid code file')
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 120) : ''
  const language = typeof input.language === 'string' ? input.language.trim().toLowerCase().slice(0, 32) : ''
  const code = typeof input.code === 'string' ? input.code : ''
  if (!title || !language || !code || code.length > 2_000_000) throw new Error('Invalid code file')
  return { title, language, code }
}

function openCodeArtifactWindow(input: CodeArtifactInput): void {
  const artifact = validateCodeArtifact(input)
  const artifactId = randomUUID()
  const window = new BrowserWindow({
    icon: appIcon,
    width: 1120,
    height: 760,
    minWidth: 680,
    minHeight: 480,
    title: artifact.title,
    show: false,
    backgroundColor: '#F6F7FA',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  codeArtifacts.set(artifactId, artifact)
  codeArtifactWindows.set(artifactId, window)
  window.on('ready-to-show', () => window.show())
  window.on('closed', () => {
    codeArtifactWindows.delete(artifactId)
    codeArtifacts.delete(artifactId)
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // The preview iframe may run the supplied page's scripts, but it may not
  // navigate itself to a remote document (which would discard our CSP).
  window.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame) event.preventDefault()
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    url.searchParams.set('artifact', artifactId)
    void window.loadURL(url.toString())
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { artifact: artifactId } })
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    icon: appIcon,
    width: 1240,
    height: 800,
    // Rail + inbox + chat + activity rail all need room at once.
    minWidth: 1060,
    minHeight: 600,
    show: false,
    backgroundColor: '#F6F7FA',
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // macOS native controls exceed the compact 60px rail on newer systems.
  // The renderer supplies compact controls backed by native window actions.
  if (process.platform === 'darwin') mainWindow.setWindowButtonVisibility(false)

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function validateRoutineInput(input: CreateRoutineInput): void {
  if (!input.name?.trim() || !input.prompt?.trim()) throw new Error('Routine name and instructions are required')
  if (!store.agents.some((agent) => agent.id === input.agentId)) throw new Error('Routine agent not found')
  if (!store.conversations.some((conversation) => conversation.id === input.conversationId)) {
    throw new Error('Routine conversation not found')
  }
  if (input.schedule.kind === 'interval') {
    if (!Number.isFinite(input.schedule.intervalMinutes) || input.schedule.intervalMinutes < 1) {
      throw new Error('Routine interval must be at least one minute')
    }
  } else {
    if (!input.schedule.days.length || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.schedule.time)) {
      throw new Error('Choose at least one day and a valid time')
    }
  }
}

function isDouchatRenderer(contents: Electron.WebContents | null): boolean {
  return Boolean(contents && BrowserWindow.getAllWindows().some((window) => window.webContents === contents))
}

function configureMediaPermissions(): void {
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => (
    permission === 'media'
    && isDouchatRenderer(contents)
    && details.isMainFrame
    && details.mediaType === 'audio'
  ))
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined
    callback(
      permission === 'media'
      && isDouchatRenderer(contents)
      && details.isMainFrame
      && Boolean(mediaTypes?.includes('audio'))
      && !mediaTypes?.includes('video')
    )
  })
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return
  configureMediaPermissions()
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient(authScheme, process.execPath, [process.argv[1]])
  } else {
    app.setAsDefaultProtocolClient(authScheme)
  }
  app.dock?.setIcon(appIcon)
  ipcMain.on('douchat:window-action', (event, action: string) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return
    if (action === 'close') mainWindow.close()
    else if (action === 'minimize') mainWindow.minimize()
    else if (action === 'fullscreen') mainWindow.setFullScreen(!mainWindow.isFullScreen())
  })
  store = DouchatStore.atUserData(app.getPath('userData'))
  emailConnectors = new EmailConnectorManager(store, app.getPath('userData'))
  computer = new LocalComputerProvider(
    () => runtime && broadcast(runtime.snapshot()),
    [app.getPath('downloads'), app.getPath('desktop'), app.getPath('documents')]
  )
  runtime = new DouchatRuntime(store, computer, broadcast, {
    baseUrl: chatApiBaseUrl(webAppUrl),
    resolveAccessToken: () => auth?.getAccessToken(),
    onUnauthorized: async () => { await auth?.invalidateSession() }
  }, emailConnectors)
  scheduler = new RoutineScheduler(store, runtime, () => broadcast(runtime.snapshot()))
  const updateDriver = app.isPackaged
    ? electronUpdater.autoUpdater as unknown as UpdateDriver
    : undefined
  updater = new DesktopUpdater(
    updateDriver,
    app.getVersion(),
    app.isPackaged,
    () => runtime.snapshot().activity.length,
    broadcastUpdate
  )
  auth = new DesktopAuth(webAppUrl, authScheme, development, app.getPath('userData'), (state) => {
    broadcastAuth(state)
    // The development flow returns through a loopback HTTP server instead of
    // the custom protocol, so it does not pass through receiveAuthUrl(). Bring
    // Douchat forward as soon as either callback path finishes signing in.
    if (state.status === 'signed-in') focusMainWindow()
  })

  ipcMain.handle('douchat:get-auth-state', () => auth.getState())
  ipcMain.handle('douchat:request-microphone-access', async (event) => {
    if (!isDouchatRenderer(event.sender)) return 'denied'
    if (process.platform !== 'darwin') return 'granted'
    const status = systemPreferences.getMediaAccessStatus('microphone')
    if (status === 'granted') return 'granted'
    if (status === 'restricted') return 'denied'
    // Some development signatures report `denied` before TCC has created an
    // entry. askForMediaAccess() is the call that actually registers the app
    // and presents the first-use system prompt. For a genuine prior denial it
    // simply resolves false without displaying another prompt.
    return await systemPreferences.askForMediaAccess('microphone') ? 'granted' : 'denied'
  })
  ipcMain.handle('douchat:open-microphone-settings', async (event) => {
    if (!isDouchatRenderer(event.sender)) return
    if (process.platform === 'darwin') {
      await shell.openExternal('x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone')
    } else if (process.platform === 'win32') {
      await shell.openExternal('ms-settings:privacy-microphone')
    }
  })
  ipcMain.handle('douchat:start-login', () => auth.startLogin())
  ipcMain.handle('douchat:retry-auth', () => auth.initialize())
  ipcMain.handle('douchat:sign-out', () => auth.signOut())
  ipcMain.handle('douchat:refresh-profile', () => auth.refreshProfile())
  ipcMain.handle('douchat:update-profile', (_event, input: UpdateDesktopProfileInput) => auth.updateProfile(input))
  ipcMain.handle('douchat:get-update-state', () => updater.state())
  ipcMain.handle('douchat:check-for-updates', () => updater.checkForUpdates())
  ipcMain.handle('douchat:install-update', () => updater.installUpdate())
  ipcMain.handle('douchat:detect-local-agents', () => { resetShellPath(); return detectLocalAgents() })
  ipcMain.handle('douchat:search-messages', (_event, id: string, query: string) => store.searchMessages(id, query))
  ipcMain.handle('douchat:message-page', (_event, conversationId: string, topicId: string, before?: string) => store.messagePage(conversationId, topicId, before))
  ipcMain.handle('douchat:attachment-data', (_event, attachmentId: string) => store.attachmentDataUrl(attachmentId))
  ipcMain.handle('douchat:get-snapshot', () => runtime.snapshot())
  const push = (): AppSnapshot => {
    const snapshot = runtime.snapshot()
    broadcast(snapshot)
    return snapshot
  }

  ipcMain.handle('douchat:create-agent', async (_event, input: CreateAgentInput) => {
    if (input.localAgentId) await validateLocalAgent(input.localAgentId)
    // The main process owns runtime bindings. In particular, a renderer cannot
    // choose a model for a Cloud Agent by smuggling provider/model over IPC.
    const binding = input.localAgentId
      ? { provider: 'local', model: 'default' }
      : runtime.defaultCloudAgentModel()
    const agent = store.createAgent({ ...input, ...binding })
    const direct = store.conversations.find(
      (conversation) => conversation.type === 'direct' && conversation.agentIds[0] === agent.id
    )
    // A new bot opens with its own proactive greeting, like a new topic does.
    if (direct) void runtime.greet(direct.id)
    return push()
  })
  ipcMain.handle('douchat:update-agent', async (_event, agentId: string, input: UpdateAgentInput) => {
    if (input.localAgentId) await validateLocalAgent(input.localAgentId)
    store.updateAgent(agentId, input)
    // Identity and model edits take effect on the next turn, not mid-session.
    runtime.disposeAgent(agentId)
    return push()
  })
  ipcMain.handle('douchat:delete-agent', (_event, agentId: string) => {
    runtime.disposeAgent(agentId)
    store.deleteAgent(agentId)
    return push()
  })
  ipcMain.handle('douchat:start-direct-chat', (_event, agentId: string) => {
    if (typeof agentId !== 'string' || !agentId) throw new Error('Contact not found')
    const { conversation, created } = store.ensureDirectConversation(agentId)
    store.markConversationRead(conversation.id)
    if (created) void runtime.greet(conversation.id)
    return { snapshot: push(), conversationId: conversation.id }
  })
  ipcMain.handle('douchat:create-group', (_event, input: CreateGroupInput) => {
    if (!input.agentIds?.length) throw new Error('A group needs at least one bot')
    const group = store.createGroup(input)
    void runtime.greet(group.id)
    return push()
  })
  ipcMain.handle('douchat:update-conversation', (_event, conversationId: string, input: UpdateConversationInput) => {
    store.updateConversation(conversationId, input)
    if (input.agentIds || input.leadAgentId) runtime.resetConversation(conversationId)
    return push()
  })
  ipcMain.handle('douchat:open-conversation-window', (_event, conversationId: string) => {
    if (!store.conversation(conversationId)) throw new Error('Chat not found')
    openChatWindow(conversationId)
  })
  ipcMain.handle('douchat:open-code-artifact', (event, input: CodeArtifactInput) => {
    if (!isDouchatRenderer(event.sender)) throw new Error('Invalid preview request')
    openCodeArtifactWindow(input)
  })
  ipcMain.handle('douchat:get-code-artifact', (event, artifactId: string) => {
    if (typeof artifactId !== 'string') return null
    const window = codeArtifactWindows.get(artifactId)
    if (!window || window.isDestroyed() || window.webContents !== event.sender) return null
    return codeArtifacts.get(artifactId) ?? null
  })
  ipcMain.handle('douchat:test-email-connector', (event, input: EmailConnectorInput) => {
    if (!isDouchatRenderer(event.sender)) throw new Error('Invalid connector request')
    return emailConnectors.test(input)
  })
  ipcMain.handle('douchat:save-email-connector', async (event, input: EmailConnectorInput) => {
    if (!isDouchatRenderer(event.sender)) throw new Error('Invalid connector request')
    await emailConnectors.save(input)
    for (const agent of store.agents) runtime.disposeAgent(agent.id)
    return push()
  })
  ipcMain.handle('douchat:disconnect-email-connector', async (event, connectorId: string) => {
    if (!isDouchatRenderer(event.sender) || typeof connectorId !== 'string') throw new Error('Invalid connector request')
    await emailConnectors.disconnect(connectorId)
    for (const agent of store.agents) runtime.disposeAgent(agent.id)
    return push()
  })
  ipcMain.handle('douchat:delete-conversation', async (event, conversationId: string) => {
    const target = store.conversation(conversationId)
    if (!target) return runtime.snapshot()
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options = { type: 'warning' as const, message: `删除与“${target.name}”的聊天？`, detail: '聊天记录会被删除，此操作无法撤销。', buttons: ['取消', '删除'], defaultId: 0, cancelId: 0 }
    const result = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
    if (result.response !== 1) return runtime.snapshot()
    chatWindows.get(conversationId)?.close()
    runtime.stopConversation(conversationId)
    runtime.resetConversation(conversationId)
    store.deleteConversation(conversationId)
    return push()
  })
  ipcMain.handle('douchat:set-conversation-pinned', (_event, conversationId: string, pinned: boolean) => {
    store.setConversationPinned(conversationId, Boolean(pinned))
    return push()
  })
  ipcMain.handle('douchat:mark-read', (_event, conversationId: string) => {
    store.markConversationRead(conversationId)
    return push()
  })
  ipcMain.handle('douchat:mark-all-read', () => {
    store.markAllConversationsRead()
    return push()
  })
  ipcMain.handle('douchat:create-topic', (_event, conversationId: string) => {
    const topic = store.createTopic(conversationId)
    if (topic) void runtime.greet(conversationId)
    return push()
  })
  ipcMain.handle('douchat:rename-topic', (_event, conversationId: string, topicId: string, title: string) => {
    store.renameTopic(conversationId, topicId, title)
    return push()
  })
  ipcMain.handle('douchat:delete-topic', (_event, conversationId: string, topicId: string) => {
    runtime.resetConversation(conversationId, topicId)
    store.deleteTopic(conversationId, topicId)
    return push()
  })
  ipcMain.handle('douchat:set-active-topic', (_event, conversationId: string, topicId: string) => {
    store.setActiveTopic(conversationId, topicId)
    return push()
  })
  ipcMain.handle('douchat:send-message', async (
    _event,
    conversationId: string,
    text: string,
    images?: MessageImageInput[]
  ) => {
    await runtime.sendMessage(conversationId, text, images)
  })
  ipcMain.handle('douchat:stop-conversation', (_event, conversationId: string) => {
    runtime.stopConversation(conversationId)
  })
  ipcMain.handle('douchat:set-endpoint', async (_event, input: EndpointInput) => {
    await runtime.setEndpoint(input)
    return push()
  })
  ipcMain.handle('douchat:test-endpoint', (_event, input: EndpointInput) => runtime.testEndpoint(input))
  ipcMain.handle('douchat:clear-conversation', (_event, conversationId: string) => {
    const topicId = store.activeTopicId(conversationId)
    store.clearConversation(conversationId, topicId)
    runtime.resetConversation(conversationId, topicId)
    return push()
  })
  ipcMain.handle('douchat:create-routine', (_event, input: CreateRoutineInput) => {
    validateRoutineInput(input)
    scheduler.createRoutine({
      ...input,
      name: input.name.trim(),
      prompt: input.prompt.trim()
    })
    return runtime.snapshot()
  })
  ipcMain.handle('douchat:delete-routine', (_event, routineId: string) => {
    scheduler.deleteRoutine(routineId)
    return runtime.snapshot()
  })
  ipcMain.handle('douchat:set-routine-enabled', (_event, routineId: string, enabled: boolean) => {
    scheduler.setEnabled(routineId, Boolean(enabled))
    return runtime.snapshot()
  })
  ipcMain.handle('douchat:run-routine-now', async (_event, routineId: string) => {
    await scheduler.runNow(routineId)
  })
  ipcMain.handle('douchat:start-computer', async (_event, agentId: string) => {
    if (!store.agents.some((agent) => agent.id === agentId)) throw new Error('Agent not found')
    await computer.start(agentId)
    const snapshot = runtime.snapshot()
    broadcast(snapshot)
    return snapshot
  })
  ipcMain.handle('douchat:stop-computer', async (_event, agentId: string) => {
    await computer.stop(agentId)
    const snapshot = runtime.snapshot()
    broadcast(snapshot)
    return snapshot
  })
  ipcMain.handle('douchat:show-computer', async (_event, agentId: string) => {
    if (!store.agents.some((agent) => agent.id === agentId)) throw new Error('Agent not found')
    await computer.show(agentId)
  })

  createWindow()
  void auth.initialize().then(() => {
    if (!pendingAuthUrl) return
    const url = pendingAuthUrl
    pendingAuthUrl = ''
    return auth.handleCallback(url)
  })
  // Packaged clients quietly check after launch; development never contacts
  // the release feed, and draft releases are not copied to the public CDN.
  const updateTimer = setTimeout(() => { void updater.checkForUpdates() }, 15_000)
  updateTimer.unref()
  scheduler.start()
  powerMonitor.on('resume', () => scheduler.checkNow())
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  for (const agent of store?.agents ?? []) runtime?.disposeAgent(agent.id)
  scheduler?.dispose()
  computer?.dispose()
  // Closing checkpoints the WAL, so the next launch opens a single tidy file.
  store?.close()
})
