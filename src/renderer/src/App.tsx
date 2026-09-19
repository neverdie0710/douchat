import { X } from 'lucide-react'
import { t, tr, usePreferences } from './preferences'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type {
  AgentConfig,
  LocalAgent,
  AppSnapshot,
  Conversation,
  CreateAgentInput,
  CreateGroupInput,
  DesktopAuthState,
  MessageImageInput,
  UpdateAgentInput
} from '../../shared/types'
import { SettingsPanel, type SettingsTab } from './components/SettingsPanel'
import { AppRail, type AppView } from './components/AppRail'
import { BotInbox } from './components/BotInbox'
import { MemberProfilePopover, type ProfileAnchor } from './components/MemberProfilePopover'
import { ContactCard } from './components/ContactCard'
import { ContactList, type ContactSelection } from './components/ContactList'
import { ChatPane } from './components/ChatPane'
import { InspectorRail } from './components/InspectorRail'
import { AddMembersModal, BotModal, EndpointModal, GroupModal } from './components/dialogs'
import { agentDisplayName, conversationMembers } from './components/common'
import { LoginScreen } from './components/LoginScreen'
import { CodeArtifactWindow } from './components/CodeArtifactWindow'
import { isImeCommitEnter } from './ime'

type Dialog =
  | { kind: 'member-profile'; agentId: string; anchor: ProfileAnchor }
  | { kind: 'bot'; agent?: AgentConfig; localAgentId?: string }
  | { kind: 'add-members' | 'remove-members'; conversation: Conversation }
  | { kind: 'group'; conversation?: Conversation; initialAgentIds?: string[] }
  | { kind: 'endpoint' }
  | null

export function App(): ReactElement {
  const artifactId = new URLSearchParams(window.location.search).get('artifact')
  return artifactId ? <CodeArtifactWindow artifactId={artifactId} /> : <WorkspaceApp />
}

function WorkspaceApp(): ReactElement {
  usePreferences()
  const imeComposing = useRef(false)
  const [authState, setAuthState] = useState<DesktopAuthState>({ status: 'checking' })
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const detachedId = new URLSearchParams(window.location.search).get('conversation')
  const [activeId, setActiveId] = useState(detachedId || '')
  const [view, setView] = useState<AppView>('chats')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('profile')
  const [contact, setContact] = useState<ContactSelection>()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [showInspector, setShowInspector] = useState(false)
  const [inspectorAgentId, setInspectorAgentId] = useState<string>()
  useEffect(() => {
    if (!showInspector) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setShowInspector(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [showInspector])

  const [toast, setToast] = useState('')
  const [localAgents, setLocalAgents] = useState<LocalAgent[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  async function scanAgents(): Promise<void> {
    setScanning(true)
    setScanError('')
    try { setLocalAgents(await window.douchat.detectLocalAgents()) }
    catch (error) { setScanError(error instanceof Error ? error.message : 'Could not detect local agents. Try Detect again.') }
    finally { setScanning(false) }
  }
  useEffect(() => {
    if (authState.status === 'signed-in') void scanAgents()
  }, [authState.status])

  useEffect(() => {
    void window.douchat.getAuthState().then(setAuthState)
    return window.douchat.onAuthState(setAuthState)
  }, [])

  useEffect(() => {
    if (authState.status !== 'signed-in') return
    const refresh = (): void => {
      void window.douchat.refreshProfile().then(setAuthState).catch(() => {
        // A temporary network failure must not cover the existing workspace.
      })
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [authState.status])

  useEffect(() => {
    if (authState.status !== 'signed-in') {
      setSnapshot(null)
      return
    }
    void window.douchat.getSnapshot().then(setSnapshot)
    return window.douchat.onSnapshot(setSnapshot)
  }, [authState.status])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (snapshot && !snapshot.conversations.some((conversation) => conversation.id === activeId && (!conversation.hidden || detachedId))) {
      const welcome = snapshot.defaultConversationId
        ? snapshot.conversations.find((item) => item.id === snapshot.defaultConversationId && !item.hidden)
        : undefined
      setActiveId(welcome?.id ?? snapshot.conversations.find((item) => !item.hidden)?.id ?? '')
    }
  }, [snapshot, activeId])

  // A newly signed-in account lands directly in its Dr. Dou welcome chat.
  // Detached chat windows keep the explicit conversation from their URL.
  useEffect(() => {
    if (detachedId || authState.status !== 'signed-in' || !snapshot?.defaultConversationId) return
    if (snapshot.conversations.some((item) => item.id === snapshot.defaultConversationId && !item.hidden)) {
      setActiveId(snapshot.defaultConversationId)
    }
  }, [detachedId, authState.status === 'signed-in' ? authState.user.id : '', snapshot?.defaultConversationId])

  useEffect(() => {
    if (!snapshot || !contact) return
    const exists =
      contact.kind === 'bot'
        ? snapshot.agents.some((agent) => agent.id === contact.id)
        : snapshot.conversations.some((item) => item.id === contact.id)
    if (!exists) setContact(undefined)
  }, [snapshot, contact])

  const conversation = snapshot?.conversations.find((item) => item.id === activeId)
  const topic = conversation?.topics.find((item) => item.id === conversation.activeTopicId) ?? conversation?.topics[0]
  const members = useMemo(() => conversationMembers(conversation, snapshot?.agents ?? []), [conversation, snapshot?.agents])
  const activity = snapshot?.activity.find((item) => item.conversationId === activeId)
  const workingIds = useMemo(
    () => new Set((snapshot?.activity ?? []).map((item) => item.conversationId)),
    [snapshot?.activity]
  )
  const totalUnread = snapshot?.conversations.reduce((sum, item) => sum + (item.muted || item.hidden ? 0 : item.unread), 0) ?? 0
  const messages = useMemo(
    () =>
      snapshot?.messages.filter(
        (message) => message.conversationId === activeId && (!topic || message.topicId === topic.id)
      ) ?? [],
    [snapshot?.messages, activeId, topic?.id]
  )

  // An open, quiet chat is read: the badge never lingers on what you are looking at.
  useEffect(() => {
    if (view !== 'chats' || !conversation || conversation.unread === 0 || conversation.manuallyUnread || activity) return
    const read = (): void => {
      if (document.visibilityState === 'visible' && document.hasFocus()) void window.douchat.markConversationRead(conversation.id)
    }
    read()
    window.addEventListener('focus', read)
    document.addEventListener('visibilitychange', read)
    return () => {
      window.removeEventListener('focus', read)
      document.removeEventListener('visibilitychange', read)
    }
  }, [view, conversation?.id, conversation?.unread, conversation?.manuallyUnread, activity])

  useEffect(() => {
    if (!members.length) {
      setInspectorAgentId(undefined)
      return
    }
    if (!members.some((agent) => agent.id === inspectorAgentId)) setInspectorAgentId(members[0].id)
  }, [conversation?.id, members, inspectorAgentId])

  const fail = (error: unknown, fallback: string): void =>
    setToast(t(error instanceof Error ? error.message : fallback))

  async function send(text: string, images?: MessageImageInput[]): Promise<void> {
    if (!conversation) return
    try {
      await window.douchat.sendMessage(conversation.id, text, images)
    } catch (error) {
      fail(error, 'Message could not be sent')
      throw error
    }
  }

  async function createAgent(input: CreateAgentInput): Promise<void> {
    const next = await window.douchat.createAgent(input)
    setSnapshot(next)
    const created = next.agents[next.agents.length - 1]
    const direct = next.conversations.find(
      (item) => item.type === 'direct' && item.agentIds[0] === created.id
    )
    if (direct) setActiveId(direct.id)
    setContact({ kind: 'bot', id: created.id })
    setView('chats')
    setShowInspector(false)
    setToast(tr('{name} joined the workspace', { name: agentDisplayName(created) }))
  }

  async function updateAgent(agentId: string, input: UpdateAgentInput): Promise<void> {
    setSnapshot(await window.douchat.updateAgent(agentId, input))
    setToast(tr('{name} updated', { name: input.name ?? t('Agent') }))
  }

  function deleteAgent(agent: AgentConfig): void {
    if (!window.confirm(tr('Delete {name}? Their chat and group memberships are removed.', { name: agentDisplayName(agent) }))) return
    void window.douchat
      .deleteAgent(agent.id)
      .then((next) => {
        setSnapshot(next)
        setDialog(null)
        setToast(tr('{name} was removed', { name: agentDisplayName(agent) }))
      })
      .catch((error) => fail(error, 'Agent could not be deleted'))
  }

  async function createGroup(input: CreateGroupInput): Promise<void> {
    const next = await window.douchat.createGroup(input)
    setSnapshot(next)
    const created = [...next.conversations].filter((item) => item.type === 'group').sort((a, b) => b.createdAt - a.createdAt)[0]
    if (created) setActiveId(created.id)
    setToast(tr('{name} is ready', { name: input.name }))
  }

  async function startDirectChat(agentId: string): Promise<void> {
    const result = await window.douchat.startDirectChat(agentId)
    setSnapshot(result.snapshot)
    setActiveId(result.conversationId)
    setContact({ kind: 'bot', id: agentId })
    setView('chats')
    setShowInspector(false)
  }

  async function updateGroup(
    conversationId: string,
    input: { name: string; description: string; agentIds: string[]; leadAgentId: string }
  ): Promise<void> {
    setSnapshot(await window.douchat.updateConversation(conversationId, input))
    setToast(t('Group updated'))
  }

  function deleteConversation(target: Conversation): void {
    /* Native confirmation is handled by the main process. */
    void window.douchat
      .deleteConversation(target.id)
      .then(setSnapshot)
      .catch((error) => fail(error, 'Chat could not be deleted'))
  }

  async function openChat(conversationId: string): Promise<void> {
    setView('chats')
    try {
      await window.douchat.updateConversation(conversationId, { hidden: false })
      const next = await window.douchat.markConversationRead(conversationId)
      setSnapshot(next)
      setActiveId(conversationId)
      setShowInspector(false)
    } catch (error) {
      fail(error, 'Chat could not be opened')
      throw error
    }
  }

  function togglePin(target: Conversation): void {
    void window.douchat.setConversationPinned(target.id, !target.pinned).then(setSnapshot).catch((error) => fail(error, 'Chat could not be pinned'))
  }

  function editConversation(target: Conversation): void {
    if (target.type === 'group') setDialog({ kind: 'group', conversation: target })
    else {
      const agent = snapshot?.agents.find((item) => item.id === target.agentIds[0])
      if (agent) setDialog({ kind: 'bot', agent })
    }
  }

  if (authState.status === 'checking') {
    return (
      <div className="loading-screen">
        <span className="brand-mark">
          <i />
          <i />
        </span>
        <span>{t('Checking your login…')}</span>
      </div>
    )
  }

  if (authState.status !== 'signed-in') {
    return <LoginScreen state={authState} onLogin={() => void window.douchat.startLogin().then(setAuthState)} />
  }

  if (!snapshot) {
    return (
      <div className="loading-screen">
        <span className="brand-mark"><i /><i /></span>
        <span>{t('Opening Douchat…')}</span>
      </div>
    )
  }

  return (
    <div
      className={`app-shell messenger with-rail ${detachedId ? 'detached-chat' : ''} ${view === 'chats' && showInspector ? 'with-inspector' : ''}`}
      onCompositionStartCapture={() => { imeComposing.current = true }}
      onCompositionEndCapture={() => { imeComposing.current = false }}
      onKeyDownCapture={(event) => {
        if (!isImeCommitEnter(event.nativeEvent, imeComposing.current)) return
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <AppRail
        view={view}
        unread={totalUnread}
        userName={authState.user.name}
        userAvatar={authState.user.image || ''}
        settingsOpen={settingsOpen}
        onSelect={(next) => {
          setSettingsOpen(false)
          setView(next)
        }}
        onOpenSettings={(profile) => {
          if (profile) setSettingsTab('profile')
          setSettingsOpen(true)
        }}
      />

      {view === 'contacts' ? (
        <>
          <ContactList
            snapshot={snapshot}
            selected={contact}
            onSelect={setContact}
          />
          <ContactCard
            snapshot={snapshot}
            selection={contact}
            onMessage={openChat}
            onEditBot={(agent) => setDialog({ kind: 'bot', agent })}
            onDeleteBot={deleteAgent}
            onTogglePin={togglePin}
          />
        </>
      ) : (
        <>
      <BotInbox
        snapshot={snapshot}
        activeId={activeId}
        workingIds={workingIds}
        onSelect={openChat}
        onCreateBot={() => setDialog({ kind: 'bot' })}
        onCreateGroup={() => setDialog({ kind: 'group' })}
        onUpdate={(target, input) => {
          void window.douchat.updateConversation(target.id, input).then(setSnapshot).catch((error) => fail(error, 'Chat could not be updated'))
        }}
        onOpenWindow={(target) => { void window.douchat.openConversationWindow(target.id).catch((error) => fail(error, 'Window could not be opened')) }}
        onEdit={editConversation}
        onTogglePin={togglePin}
        onDelete={deleteConversation}
      />

      <div className="chat-stage">
      <ChatPane key={`${activeId}:${topic?.id}`}
        userName={authState.user.name}
        userAvatar={authState.user.image || ''}
        conversation={conversation}
        topic={topic}
        messages={messages}
        allMessages={snapshot.messages}
        agents={snapshot.agents}
        members={members}
        activity={activity}
        offline={snapshot.runtime.mode === 'offline' && !members.some((agent) => agent.localAgentId)}
        onConnect={() => {
          const agent = members.find((member) => member.id === conversation?.leadAgentId) ?? members[0]
          setDialog(agent ? { kind: 'bot', agent } : { kind: 'endpoint' })
        }}
        inspectorOpen={showInspector}
        onToggleInspector={() => setShowInspector((value) => !value)}
        onSend={send}
        onStop={() => conversation && void window.douchat.stopConversation(conversation.id)}
      />

      <div className={`chat-details-layer ${showInspector && conversation ? 'is-open' : ''}`} inert={!showInspector || !conversation} aria-hidden={!showInspector || !conversation}>
        <button className="chat-details-dismiss" onClick={() => setShowInspector(false)} aria-label={t('Close chat details')} tabIndex={-1} />
        <InspectorRail
          snapshot={snapshot}
          conversation={conversation}
          members={members}
          selectedAgentId={inspectorAgentId}
          onSelectAgent={(agentId, anchor) => { setInspectorAgentId(agentId); setDialog({ kind: 'member-profile', agentId, anchor }) }}
          onRemoveMembers={() => conversation && setDialog({ kind: 'remove-members', conversation })}
          onAddMembers={() => conversation && (conversation.type === 'group' ? setDialog({ kind: 'add-members', conversation }) : setDialog({ kind: 'group', initialAgentIds: conversation.agentIds }))}
        />
      </div>
      </div>
        </>
      )}

      {dialog?.kind === 'member-profile' && (
        <MemberProfilePopover anchor={dialog.anchor} onClose={() => setDialog(null)}>
            <button autoFocus className="icon-button member-profile-close" aria-label={t('Close')} onClick={() => setDialog(null)}><X size={18} /></button>
            <ContactCard snapshot={snapshot} selection={{ kind: 'bot', id: dialog.agentId }}
              onMessage={(id) => { setDialog(null); openChat(id) }}
              onEditBot={(agent) => setDialog({ kind: 'bot', agent })}
              onDeleteBot={deleteAgent}
              onTogglePin={togglePin} />
        </MemberProfilePopover>
      )}
      {dialog?.kind === 'bot' && (
        <BotModal
          agent={dialog.agent}
          localAgents={localAgents}
          initialLocalAgentId={dialog.localAgentId}
          onSettings={() => { setDialog(null); setSettingsOpen(true) }}
          onClose={() => setDialog(null)}
          onCreate={createAgent}
          onUpdate={updateAgent}
        />
      )}
      {(dialog?.kind === 'add-members' || dialog?.kind === 'remove-members') && (
        <AddMembersModal remove={dialog.kind === 'remove-members'} snapshot={snapshot} conversation={dialog.conversation} onClose={() => setDialog(null)} onUpdate={updateGroup} />
      )}
      {dialog?.kind === 'group' && (
        <GroupModal
          snapshot={snapshot}
          conversation={dialog.conversation}
          initialAgentIds={dialog.initialAgentIds}
          onClose={() => setDialog(null)}
          onCreate={createGroup}
          onStartDirect={startDirectChat}
          onOpenConversation={openChat}
          onUpdate={updateGroup}
          onNewBot={() => setDialog({ kind: 'bot' })}
        />
      )}
      {dialog?.kind === 'endpoint' && (
        <EndpointModal
          endpoint={snapshot.endpoint}
          models={snapshot.models.length}
          onClose={() => setDialog(null)}
          onSave={async (input) => {
            const next = await window.douchat.setEndpoint(input)
            setSnapshot(next)
            setToast(next.models.length ? tr('Connected · {count} models', { count: next.models.length }) : t('Endpoint saved'))
          }}
          onTest={(input) => window.douchat.testEndpoint(input)}
        />
      )}
      {settingsOpen && (
        <SettingsPanel
          user={authState.user}
          agents={localAgents}
          scanning={scanning}
          error={scanError}
          tab={settingsTab}
          onTab={setSettingsTab}
          onClose={() => setSettingsOpen(false)}
          onSignOut={async () => {
            const next = await window.douchat.signOut()
            setSettingsOpen(false)
            setAuthState(next)
          }}
          onUpdateProfile={async (input) => {
            const next = await window.douchat.updateProfile(input)
            setAuthState(next)
            if (next.status !== 'signed-in') setSettingsOpen(false)
          }}
          onDetect={() => void scanAgents()}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
