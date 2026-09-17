import { t } from '../preferences'
import { Crown, MessageSquare, MoreHorizontal, Star, Pencil, Pin, PinOff, Sparkles, Users } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { AgentConfig, AppSnapshot, Conversation } from '../../../shared/types'
import type { ContactSelection } from './ContactList'
import { AgentAvatar, ConversationAvatar, conversationMembers } from './common'

const localAgentNames: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
  grok: 'Grok Build',
  openclaw: 'OpenClaw',
  fastclaw: 'FastClaw',
  hermes: 'Hermes',
  opencode: 'OpenCode',
  cursor: 'Cursor',
  kimi: 'Kimi',
  omp: 'OMP'
}

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
  onEditBot,
  onDeleteBot,
  onEditGroup,
  onSelect,
  onTogglePin
}: {
  snapshot: AppSnapshot
  selection?: ContactSelection
  onMessage: (conversationId: string) => void
  onEditBot: (agent: AgentConfig) => void
  onDeleteBot: (agent: AgentConfig) => void
  onEditGroup: (conversation: Conversation) => void
  onSelect: (selection: ContactSelection) => void
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
          <p>Pick a bot or a group to see its profile.</p>
        </div>
      </main>
    )
  }

  if (agent) {
    const baseAgentName = agent.localAgentId
      ? localAgentNames[agent.localAgentId] ?? agent.localAgentId
      : t('Cloud agent')
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
                <div className="contact-profile-name"><h1>{agent.name}</h1>
                  {direct && <button className={`profile-star ${direct.pinned ? 'is-starred' : ''}`} onClick={() => onTogglePin(direct)} aria-label={t(direct.pinned ? 'Unpin' : 'Pin to top')} title={t(direct.pinned ? 'Unpin' : 'Pin to top')}><Star size={16} fill={direct.pinned ? 'currentColor' : 'none'} /></button>}
                </div>
                <p>{baseAgentName}</p>
              </div>
              <div className="profile-menu-anchor" ref={profileMenuRef}>
                <button className="profile-edit" onClick={() => setProfileMenuOpen((open) => !open)} aria-label={t('Contact menu')} aria-haspopup="menu" aria-expanded={profileMenuOpen} title={t('Contact menu')}><MoreHorizontal size={21} /></button>
                {profileMenuOpen && <div className="dropdown-menu profile-actions-menu" role="menu">
                  <button role="menuitem" onClick={() => { setProfileMenuOpen(false); onEditBot(agent) }}>{t('Edit contact information')}</button>
                  <div className="dropdown-separator" />
                  <button role="menuitem" className="danger" onClick={() => { setProfileMenuOpen(false); onDeleteBot(agent) }}>{t('Delete contact')}</button>
                </div>}
              </div>
            </section>

            <section className="contact-profile-section">
              <h2>{t('Contact details')}</h2>
              <Field label={t('Name')} value={agent.name} />
              {agent.labels?.trim() && <Field label={t('Labels')} value={agent.labels} />}
            </section>

            <section className="contact-profile-section">
              <h2>{t('More information')}</h2>
              <Field label={t('Shared groups')} value={String(sharedGroupCount)} />
              <Field label={t('Source')} value={t(agent.localAgentId ? 'Local agent' : 'Model endpoint')} />
              <Field label={t('Added on')} value={new Date(agent.createdAt).toLocaleDateString(document.documentElement.lang, { year: 'numeric', month: '2-digit', day: '2-digit' })} />
            </section>

            {direct && <div className="contact-profile-actions"><button onClick={() => onMessage(direct.id)}><MessageSquare size={24} strokeWidth={1.7} /><span>{t('Send message')}</span></button></div>}
          </div>
        </div>
      </main>
    )
  }

  const members = conversationMembers(group, snapshot.agents)
  return (
    <main className="workspace contact-card-pane">
      <header className="workspace-header window-drag">
        <div className="workspace-identity">
          <strong>{group!.name}</strong>
        </div>
        <div className="workspace-header-actions no-drag">
          <button onClick={() => onTogglePin(group!)} aria-label={group!.pinned ? 'Unpin' : 'Pin'} title={group!.pinned ? 'Unpin' : 'Pin to top'}>
            {group!.pinned ? <PinOff size={16} /> : <Pin size={16} />}
          </button>
          <button onClick={() => onEditGroup(group!)} aria-label="Edit group" title="Edit group">
            <Pencil size={16} />
          </button>
        </div>
      </header>

      <div className="contact-card-scroll">
        <section className="contact-hero">
          <ConversationAvatar conversation={group!} agents={snapshot.agents} size={84} />
          <div>
            <h1>{group!.name}</h1>
            <p>{members.length} members</p>
            <span className="contact-status idle">{group!.topics.length} topics</span>
          </div>
        </section>

        {group!.description && <Field label="What this group is for" value={group!.description} />}

        <div className="contact-field">
          <span>Members</span>
          <div className="contact-members">
            {members.map((member) => (
              <button key={member.id} onClick={() => onSelect({ kind: 'bot', id: member.id })}>
                <AgentAvatar agent={member} size={44} />
                <small>{member.name}</small>
                {group!.leadAgentId === member.id && (
                  <span className="member-lead" title="Lead member">
                    <Crown size={10} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="contact-field">
          <span>How this group works</span>
          <p className="quiet">
            <Sparkles size={12} /> The lead member opens the conversation, dispatches work and consolidates the result.
            Mention a member with @ to address them directly.
          </p>
        </div>

        <button className="contact-primary" onClick={() => onMessage(group!.id)}>
          <MessageSquare size={16} />
          Open the group chat
        </button>
        <button className="contact-secondary" onClick={() => onEditGroup(group!)}>
          <Users size={15} />
          Manage members
        </button>
      </div>
    </main>
  )
}
