import { t } from '../preferences'
import { ChevronRight, Plus, Search, Star, Users, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { AgentConfig, AppSnapshot, Conversation } from '../../../shared/types'
import { contactSections, matchesContactQuery } from '../../../shared/bot/contacts'
import { AgentAvatar, ConversationAvatar, SidebarResizer } from './common'

export type ContactSelection = { kind: 'bot'; id: string } | { kind: 'group'; id: string }

export function ContactList({
  snapshot,
  selected,
  onSelect,
  onManage,
  onSettings,
  onCreateGroup
}: {
  snapshot: AppSnapshot
  selected?: ContactSelection
  onSelect: (selection: ContactSelection) => void
  onManage: () => void
  onSettings: () => void
  onCreateGroup: () => void
}): ReactElement {
  const [query, setQuery] = useState('')
  const [groupsOpen, setGroupsOpen] = useState(false)
  const [botsOpen, setBotsOpen] = useState(true)

  const groups = useMemo(
    () =>
      snapshot.conversations
        .filter((conversation) => conversation.type === 'group' && matchesContactQuery(conversation.name, query))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [snapshot.conversations, query]
  )

  const pinnedBotIds = useMemo(
    () =>
      new Set(
        snapshot.conversations
          .filter((conversation) => conversation.type === 'direct' && conversation.pinned)
          .map((conversation) => conversation.agentIds[0])
      ),
    [snapshot.conversations]
  )

  const bots = useMemo(
    () => snapshot.agents.filter((agent) => matchesContactQuery(agent.name, query)),
    [snapshot.agents, query]
  )
  const starred = bots.filter((agent) => pinnedBotIds.has(agent.id))
  const sections = useMemo(() => contactSections(bots.filter((agent) => !pinnedBotIds.has(agent.id))), [bots, pinnedBotIds])

  const botRow = (agent: AgentConfig): ReactElement => (
    <button
      key={agent.id}
      className={`contact-row ${selected?.kind === 'bot' && selected.id === agent.id ? 'active' : ''}`}
      onClick={() => onSelect({ kind: 'bot', id: agent.id })}
    >
      <AgentAvatar agent={agent} size={34} />
      <span className="contact-row-copy">
        <strong>{agent.name}</strong>
        <small>{agent.role}{agent.localAgentId ? ` · ${agent.localAgentId}` : ''}</small>
      </span>
      <span className={`contact-state ${snapshot.agentStatuses[agent.id] ?? 'idle'}`} />
    </button>
  )

  const groupRow = (conversation: Conversation): ReactElement => (
    <button
      key={conversation.id}
      className={`contact-row ${selected?.kind === 'group' && selected.id === conversation.id ? 'active' : ''}`}
      onClick={() => onSelect({ kind: 'group', id: conversation.id })}
    >
      <ConversationAvatar conversation={conversation} agents={snapshot.agents} size={34} />
      <span className="contact-row-copy">
        <strong>{conversation.name}</strong>
        <small>{conversation.agentIds.length} members</small>
      </span>
    </button>
  )

  return (
    <aside className="sidebar contacts-sidebar">
      <SidebarResizer />
      <div className="sidebar-titlebar window-drag">
        <div className="search-box no-drag">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Search contacts')} />
          {query && (
            <button onClick={() => setQuery('')} aria-label={t('Clear search')}>
              <X size={13} />
            </button>
          )}
        </div>
        <div className="sidebar-titlebar-actions no-drag">
          <button className="sidebar-add" onClick={onManage} aria-label={t('Create contact')} title={t('Create contact')}>
            <Plus size={18} />
          </button>
        </div>
      </div>

      <button className="contacts-manage" onClick={onSettings}>
        <Users size={16} />
        <span>Manage local agents</span>
      </button>

      <div className="contact-list">
        <button className="contact-folder" onClick={() => setGroupsOpen((open) => !open)} aria-expanded={groupsOpen}>
          <ChevronRight size={15} className={groupsOpen ? 'open' : ''} />
          <span>{t('Group chats')}</span>
          <em>{groups.length}</em>
        </button>
        {groupsOpen && (
          <div className="contact-folder-body">
            {groups.map(groupRow)}
            <button className="contact-row ghost" onClick={onCreateGroup}>
              <span className="contact-add">
                <Plus size={15} />
              </span>
              <span className="contact-row-copy">
                <strong>{t('New group')}</strong>
                <small>Put several bots in one room</small>
              </span>
            </button>
          </div>
        )}

        <button className="contact-folder" onClick={() => setBotsOpen((open) => !open)} aria-expanded={botsOpen}>
          <ChevronRight size={15} className={botsOpen ? 'open' : ''} />
          <span>{t('Bots')}</span>
          <em>{bots.length}</em>
        </button>
        {botsOpen && (
          <div className="contact-folder-body">
            {starred.length > 0 && (
              <>
                <div className="contact-letter starred">
                  <Star size={12} />
                  <span>Starred</span>
                </div>
                {starred.map(botRow)}
              </>
            )}
            {sections.map((section) => (
              <div key={section.letter}>
                <div className="contact-letter">{section.letter}</div>
                {section.contacts.map(botRow)}
              </div>
            ))}
            {!bots.length && <p className="empty-search">No bots match “{query.trim()}”.</p>}
          </div>
        )}
      </div>
    </aside>
  )
}
