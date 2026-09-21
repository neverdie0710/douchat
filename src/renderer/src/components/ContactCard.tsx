import { t } from '../preferences'
import { MessageSquare, MoreHorizontal, Star, Users } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { AgentConfig, AppSnapshot, Conversation } from '../../../shared/types'
import type { ContactSelection } from './ContactList'
import { AgentAvatar, ConversationAvatar, agentDisplayName, agentSourceLabel } from './common'

function Field({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="contact-field">
      <span>{label}</span>
      <p>{value}</p>
    </div>
  )
}

export function ContactCard({
  snapshot,
  selection,
  onMessage,
  onStartDirect,
  onEditBot,
  onDeleteBot,
  onTogglePin
}: {
  snapshot: AppSnapshot
  selection?: ContactSelection
  onMessage: (conversationId: string) => void
  onStartDirect: (agentId: string) => void
  onEditBot: (agent: AgentConfig) => void
  onDeleteBot: (agent: AgentConfig) => void
  onTogglePin: (conversation: Conversation) => void
}): ReactElement {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const agent = selection?.kind === 'bot' ? snapshot.agents.find((item) => item.id === selection.id) : undefined
  const group =
    selection?.kind === 'group' ? snapshot.conversations.find((item) => item.id === selection.id) : undefined

  useEffect(() => {
    setProfileMenuOpen(false)
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
              <div className="profile-menu-anchor" ref={profileMenuRef}>
                <button className="profile-edit" onClick={() => setProfileMenuOpen((open) => !open)} aria-label={t('Agent menu')} aria-haspopup="menu" aria-expanded={profileMenuOpen} title={t('Agent menu')}><MoreHorizontal size={21} /></button>
                {profileMenuOpen && <div className="dropdown-menu profile-actions-menu" role="menu">
                  <button role="menuitem" onClick={() => { setProfileMenuOpen(false); onEditBot(agent) }}>{t('Edit agent')}</button>
                  {agent.systemRole !== 'admin' && <>
                    <div className="dropdown-separator" />
                    <button role="menuitem" className="danger" onClick={() => { setProfileMenuOpen(false); onDeleteBot(agent) }}>{t('Delete agent')}</button>
                  </>}
                </div>}
              </div>
            </section>

            <section className="contact-profile-section">
              <h2>{t('Agent details')}</h2>
              <Field label={t('Name')} value={displayName} />
              {agent.labels?.trim() && <Field label={t('Labels')} value={agent.labels} />}
            </section>

            <section className="contact-profile-section">
              <h2>{t('More information')}</h2>
              <Field label={t('Shared groups')} value={String(sharedGroupCount)} />
              <Field label={t('Source')} value={sourceLabel} />
              <Field label={t('Added on')} value={new Date(agent.createdAt).toLocaleDateString(document.documentElement.lang, { year: 'numeric', month: '2-digit', day: '2-digit' })} />
            </section>

            <div className="contact-profile-actions"><button onClick={() => direct ? onMessage(direct.id) : onStartDirect(agent.id)}><MessageSquare size={24} strokeWidth={1.7} /><span>{t('Send message')}</span></button></div>
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
    </main>
  )
}
