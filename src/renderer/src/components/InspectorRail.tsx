import type { ProfileAnchor } from './MemberProfilePopover'
import { t } from '../preferences'
import { ChevronRight, Minus, Plus, Search, X } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import type { AgentConfig, AppSnapshot, ChatMessage, Conversation } from '../../../shared/types'
import { AgentAvatar } from './common'

export function InspectorRail({
  snapshot,
  conversation,
  members,
  selectedAgentId,
  onSelectAgent,
  onEditConversation,
  onAddMembers,
  onRemoveMembers,
  onEditBot
}: {
  snapshot: AppSnapshot
  conversation?: Conversation
  members: AgentConfig[]
  selectedAgentId?: string
  onSelectAgent: (agentId: string, anchor: ProfileAnchor) => void
  onClose: () => void
  onAddMembers: () => void
  onRemoveMembers: () => void
  onEditConversation: () => void
  onEditBot: (agent: AgentConfig) => void
}): ReactElement {
  const [memberQuery, setMemberQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  useEffect(() => { setMemberQuery(''); setSearching(false); setQuery(''); setResults([]); setConfirmClear(false); setError('') }, [conversation?.id])
  useEffect(() => {
    let cancelled = false
    setResults([])
    if (!searching || !conversation || !query.trim()) return
    const timer = setTimeout(() => {
      void window.douchat.searchMessages(conversation.id, query).then((messages) => {
        if (!cancelled) setResults(messages)
      }).catch(() => { if (!cancelled) setError(t('Could not load messages')) })
    }, 200)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [searching, query, conversation?.id, snapshot.messages])
  async function update(action: () => Promise<unknown>): Promise<void> {
    setBusy(true); setError('')
    try { await action(); setConfirmClear(false) }
    catch { setError(t('Could not save changes')) }
    finally { setBusy(false) }
  }
  function highlight(value: string): ReactElement {
    const needle = memberQuery.trim().toLocaleLowerCase()
    const index = value.toLocaleLowerCase().indexOf(needle)
    return index < 0 || !needle ? <>{value}</> : <>{value.slice(0, index)}<mark>{value.slice(index, index + needle.length)}</mark>{value.slice(index + needle.length)}</>
  }
  const orderedMembers = [...members].sort((a, b) => Number(b.id === conversation?.leadAgentId) - Number(a.id === conversation?.leadAgentId))
  const agent = members.find((item) => item.id === selectedAgentId) ?? members[0] ?? snapshot.agents[0]
  return (
    <aside className="inspector-rail" aria-label={t('Chat details')}>
      <div className="inspector-scroll">
        {conversation && (
          <section className="member-section">
            {conversation.type === 'group' && <label className="group-member-search"><Search size={16} /><input aria-label={t('Search group members')} placeholder={t('Search group members')} value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} />{memberQuery && <button type="button" aria-label={t('Clear search')} onClick={() => setMemberQuery('')}><X size={14} /></button>}</label>}
            {conversation.type === 'group' && memberQuery.trim() ? <div className="group-member-results">
              {orderedMembers.filter((member) => member.name.toLocaleLowerCase().includes(memberQuery.trim().toLocaleLowerCase())).map((member) => <button key={member.id} className={member.id === agent?.id ? 'active' : ''} aria-pressed={member.id === agent?.id} onClick={(event) => onSelectAgent(member.id, (event.currentTarget.querySelector('.agent-avatar') ?? event.currentTarget).getBoundingClientRect())}><AgentAvatar agent={member} size={40} /><span><strong>{highlight(member.name)}</strong></span></button>)}
              {!members.some((member) => member.name.toLocaleLowerCase().includes(memberQuery.trim().toLocaleLowerCase())) && <p>{t('No matching contacts')}</p>}
            </div> : <div className="member-grid">
              {orderedMembers.map((member) => (
                <button
                  key={member.id}
                  className={`member-tile ${member.id === agent?.id ? 'active' : ''}`}
                  onClick={(event) => onSelectAgent(member.id, (event.currentTarget.querySelector('.agent-avatar') ?? event.currentTarget).getBoundingClientRect())}
                  title={`${member.name} · ${member.role}`}
                >
                  <AgentAvatar agent={member} size={40} />
                  <span>{member.name}</span>
                  <span className={`member-state ${snapshot.agentStatuses[member.id] ?? 'idle'}`} />
                </button>
              ))}
              {<button className="member-tile add" onClick={onAddMembers} aria-label="Add a member">
                <span className="member-add">
                  <Plus size={26} strokeWidth={1.5} />
                </span>
                <span>{t('Add')}</span>
              </button>}
              {conversation.type === 'group' && <button className="member-tile add" onClick={onRemoveMembers} aria-label={t('Remove group members')}><span className="member-add"><Minus size={26} strokeWidth={1.5} /></span><span>{t('Remove')}</span></button>}
            </div>}
            {conversation.type === 'direct' ? <div className="direct-chat-options">
              <button className="detail-search-button" onClick={() => setSearching(!searching)}>{t('Search chat history')} <ChevronRight size={16} /></button>
              {searching && <div className="detail-search">
                <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Search chat history')} aria-label={t('Search chat history')} />
                <div className="detail-search-results">
                  {query.trim() && !results.length && <p>{t('No matching messages')}</p>}
                  {results.map((message) => <article key={message.id}><small>{message.authorName} · {new Date(message.createdAt).toLocaleString()}</small><p>{message.text}</p></article>)}
                  {results.length === 100 && <p>{t('Showing latest 100 matches')}</p>}
                </div>
              </div>}
              <div className="detail-toggles">
                <label>{t('Mute notifications')}<button type="button" className="detail-switch" role="switch" aria-label={t('Mute notifications')} aria-checked={!!conversation.muted} disabled={busy} onClick={() => void update(() => window.douchat.updateConversation(conversation.id, { muted: !conversation.muted }))} /></label>
                <label>{t('Pin to top')}<button type="button" className="detail-switch" role="switch" aria-label={t('Pin to top')} aria-checked={!!conversation.pinned} disabled={busy} onClick={() => void update(() => window.douchat.setConversationPinned(conversation.id, !conversation.pinned))} /></label>
              </div>
              {confirmClear ? <div className="detail-clear-confirm"><p>{t('Clear all messages in this chat? This cannot be undone.')}</p><button disabled={busy} onClick={() => setConfirmClear(false)}>{t('Cancel')}</button><button className="danger" disabled={busy} onClick={() => void update(() => window.douchat.clearConversation(conversation.id))}>{t('Clear chat history')}</button></div> : <button className="detail-clear" onClick={() => setConfirmClear(true)}>{t('Clear chat history')}</button>}
              {error && <p role="alert">{error}</p>}
            </div> : !memberQuery.trim() ? <div className="chat-detail-options">
              <button onClick={onEditConversation}>{t('Chat settings')} <ChevronRight size={16} /></button>
              {agent && <button onClick={() => onEditBot(agent)}>{t('Bot settings')} <ChevronRight size={16} /></button>}
            </div> : null}

          </section>
        )}

      </div>
    </aside>
  )
}
