import type { SocialSnapshot } from '../../../shared/social'
import { t } from '../preferences'
import { Check, Pencil, MessageSquare, MoreHorizontal, Star, Users, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { AgentConfig, AppSnapshot, Conversation } from '../../../shared/types'
import type { ContactSelection } from './ContactList'
import { AgentAvatar, UserAvatar, ConversationAvatar, agentDisplayName, agentSourceLabel } from './common'

function Field({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="contact-field">
      <span>{label}</span>
      <p>{value}</p>
    </div>
  )
}

export function ContactCard({
  readOnly = false,
  ownerName,
  snapshot,
  social,
  onFriendMessage,
  onRespondRequest,
  selection,
  onMessage,
  onStartDirect,
  onEditBot,
  onEditPermissions,
  onDeleteBot,
  onDeleteConversation,
  onRemoveFromContacts,
  onTogglePin
}: {
  ownerName?: string
  readOnly?: boolean
  snapshot: AppSnapshot
  social?: SocialSnapshot
  onFriendMessage?: (id: string) => void
  onRespondRequest?: (id: string, accept: boolean) => Promise<void>
  selection?: ContactSelection
  onMessage: (conversationId: string) => void
  onStartDirect: (agentId: string) => void
  onEditPermissions?: (agent: AgentConfig) => void
  onEditBot: (agent: AgentConfig) => void
  onRemoveFromContacts?: (conversation: Conversation) => void
  onDeleteConversation?: (conversation: Conversation) => void
  onDeleteBot: (agent: AgentConfig) => void
  onTogglePin: (conversation: Conversation) => void
}): ReactElement {
  const [friendBusy, setFriendBusy] = useState(false)
  const [friendError, setFriendError] = useState('')
  const friend = selection?.kind === 'friend' ? social?.friendships.find((item) => item.person.id === selection.id) : undefined
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const agent = selection?.kind === 'bot' ? snapshot.agents.find((item) => item.id === selection.id) : undefined
  const group =
    selection?.kind === 'group' ? snapshot.conversations.find((item) => item.id === selection.id) : undefined

  useEffect(() => {
    setProfileMenuOpen(false)
    setFriendError('')
  }, [selection?.id, selection?.kind])

  useEffect(() => {
    if (!profileMenuOpen) return
    const close = (event: MouseEvent): void => {
      if (!profileMenuRef.current?.contains(event.target as Node)) setProfileMenuOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setProfileMenuOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', escape)
    }
  }, [profileMenuOpen])

  const person = friend?.person ?? (selection?.kind === 'friend' ? social?.rooms.flatMap((room) => room.members).find((member) => member.id === selection.id) : undefined)
  if (person) {
    const direct = snapshot.conversations.find((conversation) => conversation.person?.id === person.id)
    const incoming = friend?.status === 'pending' && friend?.recipientId === social?.userId
    const status = !friend ? '' : friend?.status === 'accepted' ? t('Added') : friend?.status === 'declined' ? t('Declined') : incoming ? t('Awaiting acceptance') : t('Request sent')
    const respond = async (accept: boolean) => {
      if (!friend || !onRespondRequest || friendBusy) return
      setFriendBusy(true); setFriendError('')
      try { await onRespondRequest(friend.id, accept) }
      catch (error) { setFriendError(error instanceof Error ? error.message : String(error)) }
      finally { setFriendBusy(false) }
    }
    return <main className="workspace contact-card-pane contact-profile-pane">
      <div className="contact-profile-scroll"><div className="contact-profile-sheet">
        <section className="contact-profile-header"><UserAvatar src={person.image || ''} name={person.name} size={64} /><div className="contact-profile-identity"><div className="contact-profile-name"><h1>{person.name}</h1>{direct && <button className={`profile-star ${direct.pinned ? 'is-starred' : ''}`} onClick={() => onTogglePin(direct)} aria-label={t(direct.pinned ? 'Unpin' : 'Pin to top')} title={t(direct.pinned ? 'Unpin' : 'Pin to top')}><Star size={16} fill={direct.pinned ? 'currentColor' : 'none'} /></button>}</div><p>{friend?.status === 'accepted' ? t('Friend') : t('Douchat user')}</p></div></section>
        <section className="contact-profile-section"><h2>{t('Contact details')}</h2><Field label={t('Name')} value={person.name} />{friend?.status === 'accepted' && person.email && <Field label={t('Email')} value={person.email} />}</section>
        <section className="contact-profile-section"><h2>{t('More information')}</h2>{status && <Field label={t('Status')} value={status} />}<Field label={t('Shared groups')} value={String(social?.rooms.filter((room) => room.kind === 'group' && room.members.some((person) => person.id === person.id)).length ?? 0)} /></section>
        {friendError && <p className="friend-profile-error" role="alert">{friendError}</p>}
        <div className="contact-profile-actions">
          {incoming && <><button disabled={friendBusy} onClick={() => void respond(true)}><Check size={24} /><span>{t('Accept request')}</span></button><button className="friend-decline-action" disabled={friendBusy} onClick={() => void respond(false)}><X size={24} /><span>{t('Decline request')}</span></button></>}
          {friend?.status === 'accepted' && <button onClick={() => onFriendMessage?.(person.id)}><MessageSquare size={24} strokeWidth={1.7} /><span>{t('Send message')}</span></button>}
          {!incoming && friend?.status !== 'accepted' && <span className="friend-profile-status">{status}</span>}
        </div>
      </div></div>
    </main>
  }

  if (!agent && !group) {
    return (
      <main className="workspace contact-empty">
        <div className="contact-empty-copy">
          <Users size={30} />
          <p>{t('Pick an agent or a group to see its profile.')}</p>
        </div>
      </main>
    )
  }

  if (agent) {
    const displayName = agentDisplayName(agent)
    const sourceLabel = agentSourceLabel(agent)
    const direct = snapshot.conversations.find(
      (conversation) => conversation.type === 'direct' && conversation.agentIds[0] === agent.id
    )
    const sharedGroupCount = snapshot.conversations.filter(
      (conversation) => conversation.type === 'group' && conversation.agentIds.includes(agent.id)
    ).length
    return (
      <main className="workspace contact-card-pane contact-profile-pane">
        <div className="contact-profile-scroll">
          <div className="contact-profile-sheet">
            <section className="contact-profile-header">
              <AgentAvatar agent={agent} size={64} />
              <div className="contact-profile-identity">
                <div className="contact-profile-name"><h1>{displayName}</h1>
                  {direct && <button className={`profile-star ${direct.pinned ? 'is-starred' : ''}`} onClick={() => onTogglePin(direct)} aria-label={t(direct.pinned ? 'Unpin' : 'Pin to top')} title={t(direct.pinned ? 'Unpin' : 'Pin to top')}><Star size={16} fill={direct.pinned ? 'currentColor' : 'none'} /></button>}
                </div>
                <p>{sourceLabel}</p>
              </div>
              {!readOnly && <div className="profile-menu-anchor" ref={profileMenuRef}>
                <button className="profile-edit" onClick={() => setProfileMenuOpen((open) => !open)} aria-label={t('Agent menu')} aria-haspopup="menu" aria-expanded={profileMenuOpen} title={t('Agent menu')}><MoreHorizontal size={21} /></button>
                {profileMenuOpen && <div className="dropdown-menu profile-actions-menu" role="menu">
                  <button role="menuitem" onClick={() => { setProfileMenuOpen(false); onEditBot(agent) }}>{t('Edit agent')}</button>
                  {onEditPermissions && <button role="menuitem" onClick={() => { setProfileMenuOpen(false); onEditPermissions(agent) }}>{t('Agent permissions')}</button>}
                  {agent.systemRole !== 'admin' && <>
                    <div className="dropdown-separator" />
                    <button role="menuitem" className="danger" onClick={() => { setProfileMenuOpen(false); onDeleteBot(agent) }}>{t('Delete agent')}</button>
                  </>}
                </div>}
              </div>}
            </section>

            <section className="contact-profile-section">
              <h2>{t('Agent details')}</h2>
              <Field label={t('Name')} value={displayName} />
              {readOnly && ownerName && <Field label={t('Owned by')} value={ownerName} />}
              {agent.labels?.trim() && <Field label={t('Labels')} value={agent.labels} />}
            </section>

            <section className="contact-profile-section">
              <h2>{t('More information')}</h2>
              <Field label={t('Shared groups')} value={String(sharedGroupCount)} />
              <Field label={t('Source')} value={sourceLabel} />
              {agent.createdAt > 0 && <Field label={t('Added on')} value={new Date(agent.createdAt).toLocaleDateString(document.documentElement.lang, { year: 'numeric', month: '2-digit', day: '2-digit' })} />}
            </section>

            <div className="contact-profile-actions">
              {readOnly
                ? <p className="contact-profile-message-hint">{t('This agent belongs to another member. Direct messaging is not available.')}</p>
                : <button onClick={() => direct ? onMessage(direct.id) : onStartDirect(agent.id)}><MessageSquare size={24} strokeWidth={1.7} /><span>{t('Send message')}</span></button>}
            </div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="workspace contact-card-pane group-profile-pane">
      <div className="group-profile-layout">
        <section className="group-profile-main" aria-labelledby="group-profile-name">
          <ConversationAvatar conversation={group!} agents={snapshot.agents} userName={snapshot.userName} userAvatar={snapshot.userAvatar} size={88} />
          <h1 id="group-profile-name">{group!.name}</h1>
          <button className="group-profile-primary" onClick={() => onMessage(group!.id)}>
            <MessageSquare size={17} />
            {t('Open the group chat')}
          </button>
        </section>
      </div>
      {onRemoveFromContacts && <button className="group-remove-contact" onClick={() => onRemoveFromContacts(group!)}>{t('Remove from contacts')}</button>}
    </main>
  )
}

export function SelfProfileCard({ name, email, avatar, onEdit }: { name: string; email: string; avatar: string; onEdit: () => void }): ReactElement {
  return <main className="workspace contact-card-pane contact-profile-pane">
    <div className="contact-profile-scroll"><div className="contact-profile-sheet">
      <section className="contact-profile-header"><UserAvatar name={name} src={avatar} size={64} /><div className="contact-profile-identity"><div className="contact-profile-name"><h1>{name}</h1></div><p>{t('Myself')}</p></div></section>
      <section className="contact-profile-section"><h2>{t('Contact details')}</h2><Field label={t('Name')} value={name} /><Field label={t('Email')} value={email} /></section>
      <div className="contact-profile-actions"><button onClick={onEdit}><Pencil size={24} strokeWidth={1.7} /><span>{t('Edit profile')}</span></button></div>
    </div></div>
  </main>
}
