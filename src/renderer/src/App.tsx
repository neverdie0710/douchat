import { X } from 'lucide-react'
import { t, usePreferences } from './preferences'
import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type {
  AgentConfig,
  LocalAgent,
  AppSnapshot,
  Conversation,
  CreateAgentInput,
  CreateGroupInput,
  DesktopAuthState,
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
import { conversationMembers } from './components/common'
import { LoginScreen } from './components/LoginScreen'

type Dialog =
  | { kind: 'member-profile'; agentId: string; anchor: ProfileAnchor }
  | { kind: 'bot'; agent?: AgentConfig; localAgentId?: string }
  | { kind: 'add-members' | 'remove-members'; conversation: Conversation }
  | { kind: 'group'; conversation?: Conversation; initialAgentIds?: string[] }
  | { kind: 'endpoint' }
  | null

export function App(): ReactElement {
  usePreferences()
  const [authState, setAuthState] = useState<DesktopAuthState>({ status: 'checking' })
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const detachedId = new URLSearchParams(window.location.search).get('conversation')
  const [activeId, setActiveId] = useState(detachedId || 'crew')
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
    catch (error) { setScanError(error instanceof Error ? error.message : 'Could not detect local agents. Try Refresh.') }
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
      setActiveId(snapshot.conversations.find((item) => !item.hidden)?.id ?? '')
    }
  }, [snapshot, activeId])

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
    setToast(error instanceof Error ? error.message : fallback)

  async function send(text: string): Promise<void> {
    if (!conversation) return
    try {
      await window.douchat.sendMessage(conversation.id, text)
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
    setToast(`${created.name} joined the workspace`)
  }

  async function updateAgent(agentId: string, input: UpdateAgentInput): Promise<void> {
    setSnapshot(await window.douchat.updateAgent(agentId, input))
    setToast(`${input.name ?? 'Bot'} updated`)
  }

  function deleteAgent(agent: AgentConfig): void {
    if (!window.confirm(`Delete ${agent.name}? Their chat and group memberships are removed.`)) return
    void window.douchat
      .deleteAgent(agent.id)
      .then((next) => {
        setSnapshot(next)
        setDialog(null)
        setToast(`${agent.name} was removed`)
      })
      .catch((error) => fail(error, 'Bot could not be deleted'))
  }

  async function createGroup(input: CreateGroupInput): Promise<void> {
    const next = await window.douchat.createGroup(input)
    setSnapshot(next)
    const created = [...next.conversations].filter((item) => item.type === 'group').sort((a, b) => b.createdAt - a.createdAt)[0]
    if (created) setActiveId(created.id)
    setToast(`${input.name} is ready`)
  }

  async function updateGroup(
    conversationId: string,
    input: { name: string; description: string; agentIds: string[]; leadAgentId: string }
  ): Promise<void> {
    setSnapshot(await window.douchat.updateConversation(conversationId, input))
    setToast('Group updated')
  }

  function deleteConversation(target: Conversation): void {
    /* Native confirmation is handled by the main process. */
    void window.douchat
      .deleteConversation(target.id)
      .then(setSnapshot)
      .catch((error) => fail(error, 'Chat could not be deleted'))
  }

  function openChat(conversationId: string): void {
    setView('chats')
    void window.douchat.updateConversation(conversationId, { hidden: false })
      .then(() => window.douchat.markConversationRead(conversationId))
      .then((next) => { setSnapshot(next); setActiveId(conversationId) })
      .catch((error) => fail(error, 'Chat could not be opened'))
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
        <span>Opening Douchat…</span>
      </div>
    )
  }

  return (
    <div className={`app-shell messenger with-rail ${detachedId ? 'detached-chat' : ''} ${view === 'chats' && showInspector ? 'with-inspector' : ''}`}>
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
            onManage={() => setDialog({ kind: 'bot' })}
            onSettings={() => setSettingsOpen(true)}
            onCreateGroup={() => setDialog({ kind: 'group' })}
          />
          <ContactCard
            snapshot={snapshot}
            selection={contact}
            onMessage={openChat}
            onEditBot={(agent) => setDialog({ kind: 'bot', agent })}
            onDeleteBot={deleteAgent}
            onEditGroup={(target) => setDialog({ kind: 'group', conversation: target })}
            onSelect={setContact}
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
        <button className="chat-details-dismiss" onClick={() => setShowInspector(false)} aria-label="Close chat details" tabIndex={-1} />
        <InspectorRail
          snapshot={snapshot}
          conversation={conversation}
          members={members}
          selectedAgentId={inspectorAgentId}
          onSelectAgent={(agentId, anchor) => { setInspectorAgentId(agentId); setDialog({ kind: 'member-profile', agentId, anchor }) }}
          onClose={() => setShowInspector(false)}
          onRemoveMembers={() => conversation && setDialog({ kind: 'remove-members', conversation })}
          onAddMembers={() => conversation && (conversation.type === 'group' ? setDialog({ kind: 'add-members', conversation }) : setDialog({ kind: 'group', initialAgentIds: conversation.agentIds }))}
          onEditConversation={() => conversation && editConversation(conversation)}
          onEditBot={(agent) => setDialog({ kind: 'bot', agent })}

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
              onEditGroup={(target) => setDialog({ kind: 'group', conversation: target })}
              onSelect={(selection) => { setDialog(null); setContact(selection); setView('contacts') }}
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
            setToast(next.models.length ? `Connected · ${next.models.length} models` : 'Endpoint saved')
          }}
          onTest={(input) => window.douchat.testEndpoint(input)}
        />
      )}
      {settingsOpen && (
        <SettingsPanel
          snapshot={snapshot}
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
          onRefresh={() => void scanAgents()}
          onCreate={(agent) => {
            setSettingsOpen(false)
            setDialog({ kind: 'bot', localAgentId: agent.id })
          }}
          onContact={(id) => {
            setContact({ kind: 'bot', id })
            setSettingsOpen(false)
            setView('contacts')
          }}
          onEndpoint={() => {
            setSettingsOpen(false)
            setDialog({ kind: 'endpoint' })
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
