import { conversationMembers } from './common'
import type { SocialSnapshot } from '../../../shared/social'
import { LocalAgentSelect } from './LocalAgentSelect'
import { t, tr } from '../preferences'
import { readAvatarFile } from '../avatarFile'
import { CalendarClock, Camera, Check, ChevronDown, ChevronRight, Cloud, Laptop, PlugZap, Search, Smile, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactElement } from 'react'
import type {
  AgentConfig,
  LocalAgent,
  AppSnapshot,
  EndpointInput,
  EndpointSettings,
  EndpointTestResult,
  Conversation,
  CreateAgentInput,
  CreateGroupInput,
  CreateRoutineInput,
  RoutineSchedule,
  UpdateAgentInput
} from '../../../shared/types'
import { AgentAvatar, UserAvatar, ConversationAvatar, agentDisplayName, colors, conversationDisplayName } from './common'

const avatarEmojis = [
  '😀', '😄', '😊', '😌', '😎', '🤓', '🥳', '😂', '😍', '🤔', '🫡', '🤖',
  '👩', '👨', '👧', '👦', '👩‍💻', '🧑‍🚀', '🧙', '🥷', '👩‍🎨', '👨‍🔬', '🧑‍🏫', '🕵️',
  '🐱', '🐶', '🦊', '🐼', '🐸', '🦄', '🐯', '🦁', '🐵', '🐧', '🐨', '🐰',
  '🌟', '🌈', '🔥', '💡', '🎨', '🎵', '🧠', '💻', '🚀', '🌙', '☀️', '👻'
]

export function BotModal({
  agent,
  localAgents,
  initialLocalAgentId,
  onSettings,
  onAddFriend,
  onClose,
  onCreate,
  onUpdate
}: {
  agent?: AgentConfig
  localAgents: LocalAgent[]
  initialLocalAgentId?: string
  onAddFriend?: () => void
  onSettings: () => void
  onClose: () => void
  onCreate: (input: CreateAgentInput) => Promise<void>
  onUpdate: (agentId: string, input: UpdateAgentInput) => Promise<void>
}): ReactElement {
  const [localAgentId, setLocalAgentId] = useState(agent?.localAgentId ?? initialLocalAgentId ?? (!agent ? localAgents.find((item) => item.installed)?.id : '') ?? '')
  const [agentSource, setAgentSource] = useState<'cloud' | 'local'>(agent?.localAgentId || initialLocalAgentId ? 'local' : 'cloud')
  const localAgent = localAgents.find((item) => item.id === localAgentId)
  const [error, setError] = useState('')
  const [name, setName] = useState(agent?.name ?? localAgents.find((item) => item.id === initialLocalAgentId)?.name ?? '')
  const [avatar, setAvatar] = useState(agent?.avatar ?? '')
  const [avatarEmoji, setAvatarEmoji] = useState(agent?.avatarEmoji ?? '')
  const [role] = useState(agent?.role ?? 'Assistant')
  const [instructions, setInstructions] = useState(agent?.instructions ?? '')
  const [labels, setLabels] = useState(agent?.labels ?? '')
  const [color] = useState(agent?.color ?? colors[2])
  const [saving, setSaving] = useState(false)
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const avatarFile = useRef<HTMLInputElement>(null)
  const emojiPicker = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!emojiPickerOpen) return
    const close = (event: PointerEvent): void => {
      if (!emojiPicker.current?.contains(event.target as Node)) setEmojiPickerOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setEmojiPickerOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', escape)
    }
  }, [emojiPickerOpen])

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!name.trim()) return
    if (!agent && !role.trim()) return
    if (!agent && agentSource === 'local' && !localAgent?.installed) return
    setSaving(true)
    setError('')
    try {
      if (agent) {
        await onUpdate(agent.id, {
          name: name.trim(),
          avatar,
          avatarEmoji,
          instructions: instructions.trim(),
          labels: labels.trim()
        })
        onClose()
        return
      }
      const input = {
        name: name.trim(),
        role: role.trim(),
        instructions: instructions.trim(),
        labels: labels.trim(),
        color,
        localAgentId: agentSource === 'local' ? localAgentId : ''
      }
      await onCreate(input)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save agent')
    } finally {
      setSaving(false)
    }
  }

  async function chooseAvatar(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    try {
      setAvatar(await readAvatarFile(file))
      setAvatarEmoji('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('This picture could not be used.'))
    }
  }

  if (!agent) return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <form className="agent-modal create-contact-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="create-contact-title">
        <div className="modal-heading">
          <h2 id="create-contact-title">{t('Create agent')}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('Close')}><X size={18} /></button>
        </div>
        <label className="field-row"><span>{t('Agent name')}</span>
          <input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder={t('Enter agent name')} />
        </label>
        <div className="field-row agent-source-field"><span>{t('Runs with')}</span>
          <div className="agent-source-cards" role="radiogroup" aria-label={t('Runs with')}>
            <button type="button" role="radio" aria-checked={agentSource === 'cloud'} className={agentSource === 'cloud' ? 'selected' : ''} onClick={() => setAgentSource('cloud')}>
              <span className="agent-source-icon"><Cloud size={18} strokeWidth={1.9} /></span>
              <span className="agent-source-copy"><strong>{t('Use cloud model')}</strong><small>{t('Douchat cloud model')}</small></span>
              <span className="agent-source-radio" aria-hidden="true"><i /></span>
            </button>
            <button type="button" role="radio" aria-checked={agentSource === 'local'} className={agentSource === 'local' ? 'selected' : ''} onClick={() => setAgentSource('local')}>
              <span className="agent-source-icon"><Laptop size={18} strokeWidth={1.9} /></span>
              <span className="agent-source-copy"><strong>{t('Use local agent')}</strong><small>{t('AI tools on this computer')}</small></span>
              <span className="agent-source-radio" aria-hidden="true"><i /></span>
            </button>
          </div>
        </div>
        {agentSource === 'local' && <div className="field-row"><span>{t('Local agent')}</span>
          <LocalAgentSelect agents={localAgents.filter((item) => item.installed)} value={localAgentId} onChange={setLocalAgentId} />
        </div>}
        {agentSource === 'local' && !localAgents.some((item) => item.installed) && <p className="settings-note">{t('No available local agents')} <button type="button" className="local-settings-link" onClick={onSettings}>{t('Settings')}</button></p>}
        {error && <p className="settings-error" role="alert">{t(error)}</p>}
        <div className="modal-footer">
          {onAddFriend && <button type="button" className="create-contact-friend-entry" disabled={saving} onClick={onAddFriend}>{t('Add friend')}</button>}
          <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>{t('Cancel')}</button>
          <button className="primary-button" type="submit" disabled={saving || !name.trim() || (agentSource === 'local' && !localAgent?.installed)}>{t(saving ? 'Saving…' : 'Create agent')}</button>
        </div>
      </form>
    </div>
  )

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <form className="agent-modal edit-contact-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="edit-contact-title">
        <div className="edit-contact-heading">
          <h2 id="edit-contact-title">{t('Edit agent')}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('Close')} disabled={saving}><X size={18} /></button>
        </div>

        <div className="edit-contact-avatar-field" ref={emojiPicker}>
          <span>{t('Avatar')}</span>
          <div className="edit-contact-avatar-row">
            <button type="button" className="edit-contact-avatar" onClick={() => avatarFile.current?.click()} aria-label={t('Choose picture')}>
              <AgentAvatar agent={{ ...agent, avatar, avatarEmoji }} size={76} />
              <span><Camera size={17} strokeWidth={1.8} /></span>
            </button>
            <div className="edit-contact-avatar-actions">
              <button type="button" className="edit-contact-picture-action" onClick={() => avatarFile.current?.click()}>{t('Choose picture')}</button>
              <div className="edit-contact-emoji-picker">
                <button
                  type="button"
                  className={`edit-contact-emoji-trigger${avatarEmoji ? ' has-value' : ''}`}
                  aria-haspopup="dialog"
                  aria-expanded={emojiPickerOpen}
                  aria-label={t('Choose emoji')}
                  onClick={() => setEmojiPickerOpen((open) => !open)}
                >
                  <span className="edit-contact-emoji-trigger-icon">{avatarEmoji || <Smile size={17} strokeWidth={1.8} />}</span>
                  <ChevronDown size={14} strokeWidth={1.8} />
                </button>
                {emojiPickerOpen && (
                  <div className="edit-contact-emoji-card" role="dialog" aria-label={t('Choose emoji')}>
                    <div className="edit-contact-emoji-card-heading">
                      <strong>{t('Choose emoji')}</strong>
                      <button
                        type="button"
                        onClick={() => {
                          setAvatarEmoji('')
                          setEmojiPickerOpen(false)
                        }}
                      >{t('Use default avatar')}</button>
                    </div>
                    <div className="edit-contact-emoji-grid" role="listbox" aria-label={t('Choose emoji')}>
                      {avatarEmoji && !avatarEmojis.includes(avatarEmoji) && (
                        <button
                          type="button"
                          role="option"
                          aria-selected="true"
                          className="selected"
                          data-emoji={avatarEmoji}
                          onClick={() => setEmojiPickerOpen(false)}
                        >{avatarEmoji}</button>
                      )}
                      {avatarEmojis.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          role="option"
                          aria-selected={avatarEmoji === emoji}
                          className={avatarEmoji === emoji ? 'selected' : ''}
                          data-emoji={emoji}
                          onClick={() => {
                            setAvatarEmoji(emoji)
                            setAvatar('')
                            setEmojiPickerOpen(false)
                          }}
                        >{emoji}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {(avatar || avatarEmoji) && <button type="button" className="edit-contact-picture-action muted" onClick={() => { setAvatar(''); setAvatarEmoji('') }}>{t('Remove')}</button>}
            </div>
            <input ref={avatarFile} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void chooseAvatar(event)} />
          </div>
        </div>

        <label className="edit-contact-field"><span>{t('Nickname')}</span>
          <input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder={t('Enter agent name')} />
        </label>
        <label className="edit-contact-field"><span>{t('Description')}</span>
          <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={4} placeholder={t('Add a description')} />
        </label>
        <label className="edit-contact-field"><span>{t('Labels')}</span>
          <input value={labels} onChange={(event) => setLabels(event.target.value)} placeholder={t('Search or create labels')} />
        </label>

        {error && <p className="settings-error" role="alert">{t(error)}</p>}
        <div className="edit-contact-footer">
          <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>{t('Cancel')}</button>
          <button className="primary-button" type="submit" disabled={saving || !name.trim()}>{t(saving ? 'Saving…' : 'Done')}</button>
        </div>
      </form>
    </div>
  )
}

export function AddMembersModal({ onRemoveContacts, onAddContacts, initialFriendIds, onCreateSocialGroup, social, onStartFriend, snapshot, conversation, onClose, onUpdate, manage = false, remove = false, initialAgentIds, onCreate, onStartDirect, onOpenConversation }: {
  snapshot: AppSnapshot
  onRemoveContacts?: (friendIds: string[], agentIds: string[]) => Promise<void>
  onAddContacts?: (friendIds: string[], agentIds: string[]) => Promise<void>
  social?: SocialSnapshot
  onStartFriend?: (id: string) => Promise<void>
  initialFriendIds?: string[]
  onCreateSocialGroup?: (friendIds: string[], agentIds: string[], memberOrder?: string[]) => Promise<void>
  conversation?: Conversation
  remove?: boolean
  manage?: boolean
  initialAgentIds?: string[]
  onCreate?: (input: CreateGroupInput) => Promise<void>
  onStartDirect?: (agentId: string) => Promise<void>
  onOpenConversation?: (conversationId: string) => Promise<void>
  onClose: () => void
  onUpdate: (id: string, input: { name: string; description: string; agentIds: string[]; leadAgentId: string }) => Promise<void>
}): ReactElement {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>(manage ? conversation?.agentIds ?? initialAgentIds ?? [] : [])
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>(initialFriendIds ?? [])
  const [memberOrder, setMemberOrder] = useState<string[]>([...(initialFriendIds ?? []).map((id) => `person:${id}`), ...(initialAgentIds ?? []).map((id) => `agent:${id}`)])
  const [friendsOpen, setFriendsOpen] = useState(true)
  const [selectedConversationId, setSelectedConversationId] = useState('')
  const [groupsOpen, setGroupsOpen] = useState(false)
  const [contactsOpen, setContactsOpen] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const startMode = manage && !conversation && !(initialAgentIds?.length) && !(initialFriendIds?.length)
  const members = new Set(manage || remove ? [] : conversation?.socialRoom
    ? conversation.socialRoom.agents.filter((agent) => agent.ownerId === social?.userId).map((agent) => agent.localId)
    : conversation?.agentIds ?? [])
  const humanMembers = new Set(conversation?.socialRoom?.members.map((person) => person.id) ?? [])
  const needle = query.trim().toLocaleLowerCase()
  const pickerAgents = remove && conversation?.socialRoom ? conversationMembers(conversation, snapshot.agents).filter((agent) => conversation.socialRoom!.members[0]?.id === social?.userId || agent.ownerId === social?.userId) : snapshot.agents
  const matchingAgents = pickerAgents.filter((agent) => (!remove || conversation?.agentIds.includes(agent.id)) && `${agent.name} ${agentDisplayName(agent)}`.toLocaleLowerCase().includes(needle))
    .sort((a, b) => Number(b.systemRole === 'admin') - Number(a.systemRole === 'admin') || agentDisplayName(a).localeCompare(agentDisplayName(b)))
  const matchingGroups = startMode
    ? snapshot.conversations.filter((item) => item.type === 'group' && `${item.name} ${conversationDisplayName(item, snapshot.agents)}`.toLocaleLowerCase().includes(needle))
      .sort((a, b) => conversationDisplayName(a, snapshot.agents).localeCompare(conversationDisplayName(b, snapshot.agents)))
    : []
  const friends = remove && conversation?.socialRoom ? conversation.socialRoom.members.filter((person) => person.id !== conversation.socialRoom!.members[0]?.id && conversation.socialRoom!.members[0]?.id === social?.userId).map((person) => ({ person })) : (social?.friendships ?? []).filter((item) => item.status === 'accepted')
  const matchingFriends = friends.filter((item) => `${item.person.name} ${item.person.email}`.toLocaleLowerCase().includes(needle))
  const selectedFriends = friends.filter((item) => selectedFriendIds.includes(item.person.id))
  const selectedConversation = matchingGroups.find((item) => item.id === selectedConversationId)
    ?? snapshot.conversations.find((item) => item.id === selectedConversationId && item.type === 'group')
  const selectedDirect = selected.length === 1
    ? snapshot.conversations.find((item) => item.type === 'direct' && item.agentIds[0] === selected[0])
    : undefined
  const toggle = (id: string): void => {
    setMemberOrder((order) => selected.includes(id) ? order.filter((key) => key !== `agent:${id}`) : [...order, `agent:${id}`])
    setSelectedConversationId('')
    setSelected((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])
  }
  const chooseConversation = (id: string): void => {
    setSelectedFriendIds([])
    setSelected([])
    setSelectedConversationId((current) => current === id ? '' : id)
  }
  const selectionCount = selectedConversationId ? 1 : selected.length + selectedFriendIds.length
  const invalid = remove && onRemoveContacts ? selectionCount < 1 : onAddContacts && conversation && !remove ? selectionCount < 1 : selectedFriendIds.length
    ? selectionCount === 1 && startMode ? !onStartFriend : selectionCount < 2 || !onCreateSocialGroup
    : startMode
      ? selectionCount < 1 || (Boolean(selectedConversationId) && !onOpenConversation) || (selected.length === 1 && !onStartDirect)
      : selected.length < (manage ? 2 : 1) || (remove && selected.length >= (conversation?.agentIds.length ?? 0))
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (invalid || saving) return
    setSaving(true)
    setError('')
    try {
      if (remove && onRemoveContacts) { await onRemoveContacts(selectedFriendIds, selected); onClose(); return }
      if (onAddContacts && conversation && !remove) {
        await onAddContacts(selectedFriendIds, selected)
        onClose()
        return
      }
      if (selectedFriendIds.length) {
        if (selectionCount === 1 && startMode && onStartFriend) await onStartFriend(selectedFriendIds[0])
        else if (onCreateSocialGroup) await onCreateSocialGroup(selectedFriendIds, selected, memberOrder)
        onClose()
        return
      }
      if (startMode && selectedConversationId && onOpenConversation) {
        await onOpenConversation(selectedConversationId)
        onClose()
        return
      }
      if (startMode && selected.length === 1) {
        if (selectedDirect && onOpenConversation) await onOpenConversation(selectedDirect.id)
        else if (onStartDirect) await onStartDirect(selected[0])
        onClose()
        return
      }
      const agentIds = remove ? (conversation?.agentIds ?? []).filter((id) => !selected.includes(id)) : manage ? selected : [...new Set([...(conversation?.agentIds ?? []), ...selected])]
      const input = {
        name: conversation?.name ?? snapshot.agents.filter((agent) => selected.includes(agent.id)).map((agent) => agent.name).join('、'),
        description: conversation?.description ?? '', agentIds,
        leadAgentId: conversation?.leadAgentId && agentIds.includes(conversation.leadAgentId) ? conversation.leadAgentId : agentIds[0]
      }
      if (conversation) await onUpdate(conversation.id, input)
      else if (onCreate) await onCreate(input)
      onClose()
    } catch (error) {
      setError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : t('Could not save changes'))
    } finally { setSaving(false) }
  }
  const title = remove
    ? 'Remove group members'
    : manage
      ? conversation
        ? 'Group members'
        : startMode && selectionCount <= 1
          ? 'New chat'
          : 'Create group'
      : 'Add group members'
  const action = remove
    ? 'Remove'
    : manage
      ? conversation
        ? 'Save'
        : startMode
          ? selectedConversationId
            ? 'Open group'
            : selectionCount > 1
              ? 'Create group'
              : selectedDirect
                ? 'Open chat'
                : 'Start chat'
          : 'Create group'
      : 'Add'
  return (
    <div className="modal-backdrop" onMouseDown={(event) => !saving && event.target === event.currentTarget && onClose()}>
      <form className="agent-modal add-members-modal" role="dialog" aria-modal="true" aria-labelledby="add-members-title" onSubmit={submit}
        onKeyDown={(event) => { if (event.key === 'Escape' && !saving) { event.stopPropagation(); onClose() } }}>
        <section className="member-picker-source">
          <label className="member-picker-search"><Search size={17} /><input autoFocus aria-label={t('Search')} placeholder={t('Search')} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <div className="member-picker-list">
            {startMode && <>
              <button type="button" className="member-picker-folder" aria-expanded={groupsOpen || Boolean(needle)} onClick={() => setGroupsOpen((open) => !open)}>
                <ChevronRight size={15} className={groupsOpen || needle ? 'open' : ''} /><span>{t('Existing groups')}</span><em>{matchingGroups.length}</em>
              </button>
              {(groupsOpen || Boolean(needle)) && <div className="member-picker-folder-body">
                {matchingGroups.map((item) => {
                  const checked = selectedConversationId === item.id
                  return <button type="button" key={item.id} className={`member-picker-row ${checked ? 'selected' : ''}`} role="radio" aria-checked={checked} disabled={saving} onClick={() => chooseConversation(item.id)}>
                    <span className={`member-picker-check ${checked ? 'checked' : ''}`}><Check size={13} /></span>
                    <ConversationAvatar conversation={item} agents={snapshot.agents} userName={snapshot.userName} userAvatar={snapshot.userAvatar} size={36} /><span className="member-picker-name">{conversationDisplayName(item, snapshot.agents)}</span>
                  </button>
                })}
                {!matchingGroups.length && <p className="member-picker-empty compact">{t('No matching groups')}</p>}
              </div>}
              <button type="button" className="member-picker-folder" aria-expanded={contactsOpen || Boolean(needle)} onClick={() => setContactsOpen((open) => !open)}>
                <ChevronRight size={15} className={contactsOpen || needle ? 'open' : ''} /><span>{t('Agents')}</span><em>{matchingAgents.length}</em>
              </button>
            </>}
            {!startMode && <h3>{t('Agents')}</h3>}
            {(!startMode || contactsOpen || Boolean(needle)) && matchingAgents.map((agent) => {
              const joined = members.has(agent.id)
              const checked = selected.includes(agent.id)
              return <button type="button" key={agent.id} className={`member-picker-row ${checked ? 'selected' : ''}`} role="checkbox" aria-checked={joined || checked} disabled={joined || saving} onClick={() => toggle(agent.id)}>
                <span className={`member-picker-check ${joined || checked ? 'checked' : ''}`}><Check size={13} /></span>
                <AgentAvatar agent={agent} size={36} /><span className="member-picker-name">{agentDisplayName(agent)}</span>
                {joined && <small>{t('Already added')}</small>}
              </button>
            })}
            {(!startMode || contactsOpen || Boolean(needle)) && !matchingAgents.length && <p className="member-picker-empty">{t('No matching agents')}</p>}
            {social && <>
              <button type="button" className="member-picker-folder" aria-expanded={friendsOpen || Boolean(needle)} onClick={() => setFriendsOpen((open) => !open)}><ChevronRight size={15} className={friendsOpen || needle ? 'open' : ''} /><span>{t('Friends')}</span><em>{matchingFriends.length}</em></button>
              {(friendsOpen || Boolean(needle)) && <div className="member-picker-folder-body">{matchingFriends.map(({ person }) => {
                const joined = !remove && humanMembers.has(person.id)
                const checked = joined || selectedFriendIds.includes(person.id)
                return <button type="button" className={`member-picker-row ${checked ? 'selected' : ''}`} role="checkbox" aria-checked={checked} key={person.id} disabled={saving || joined} onClick={() => { setSelectedConversationId(''); setMemberOrder((order) => checked ? order.filter((key) => key !== `person:${person.id}`) : [...order, `person:${person.id}`]); setSelectedFriendIds((ids) => checked ? ids.filter((id) => id !== person.id) : [...ids, person.id]) }}><span className={`member-picker-check ${checked ? 'checked' : ''}`}><Check size={13} /></span><UserAvatar src={person.image || ''} name={person.name} size={36} /><span className="member-picker-name">{person.name}</span>{joined && <small>{t('Already added')}</small>}</button>
              })}{!matchingFriends.length && <p className="member-picker-empty compact">{t('No matching friends')}</p>}</div>}
            </>}
          </div>
        </section>
        <section className="member-picker-selection">
          <header><h2 id="add-members-title">{t(title)}</h2><span>{t('Selected')}: {selectionCount}</span></header>
          <div className="member-picker-list">
            {selectedFriends.map((selectedFriend) => <div className="member-picker-chosen" key={selectedFriend.person.id}><UserAvatar src={selectedFriend.person.image || ''} name={selectedFriend.person.name} size={36} /><span className="member-picker-name">{selectedFriend.person.name}</span><button type="button" disabled={saving} onClick={() => setSelectedFriendIds((ids) => ids.filter((id) => id !== selectedFriend.person.id))} aria-label={`${t('Remove')} ${selectedFriend.person.name}`}><X size={13} /></button></div>)}
            {selectedConversation && <div className="member-picker-chosen"><ConversationAvatar conversation={selectedConversation} agents={snapshot.agents} userName={snapshot.userName} userAvatar={snapshot.userAvatar} size={36} /><span className="member-picker-name">{conversationDisplayName(selectedConversation, snapshot.agents)}</span><button type="button" disabled={saving} onClick={() => setSelectedConversationId('')} aria-label={`${t('Remove')} ${conversationDisplayName(selectedConversation, snapshot.agents)}`}><X size={13} /></button></div>}
            {selected.map((id) => {
              const agent = pickerAgents.find((item) => item.id === id)
              return agent && <div className="member-picker-chosen" key={id}><AgentAvatar agent={agent} size={36} /><span className="member-picker-name">{agentDisplayName(agent)}</span><button type="button" disabled={saving} onClick={() => toggle(id)} aria-label={`${t('Remove')} ${agentDisplayName(agent)}`}><X size={13} /></button></div>
            })}
            {!selectionCount && <p className="member-picker-empty">{t(remove ? 'Select members to remove' : startMode ? 'Select a contact to start chatting, or open an existing group.' : 'Select contacts to add')}</p>}
          </div>
          {remove && selected.length >= (conversation?.agentIds.length ?? 0) && <p className="member-picker-error">{t('Keep at least one member')}</p>}
          {error && <p role="alert" className="member-picker-error">{error}</p>}
          <footer><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>{t('Cancel')}</button><button type="submit" className="primary-button" disabled={invalid || saving}>{saving ? t('Saving…') : t(action)}</button></footer>
        </section>
      </form>
    </div>
  )
}

export function GroupModal(props: {
  snapshot: AppSnapshot
  onRemoveContacts?: (friendIds: string[], agentIds: string[]) => Promise<void>
  onAddContacts?: (friendIds: string[], agentIds: string[]) => Promise<void>
  social?: SocialSnapshot
  onStartFriend?: (id: string) => Promise<void>
  initialFriendIds?: string[]
  onCreateSocialGroup?: (friendIds: string[], agentIds: string[], memberOrder?: string[]) => Promise<void>
  conversation?: Conversation
  initialAgentIds?: string[]
  onClose: () => void
  onCreate: (input: CreateGroupInput) => Promise<void>
  onStartDirect: (agentId: string) => Promise<void>
  onOpenConversation: (conversationId: string) => Promise<void>
  onUpdate: (id: string, input: { name: string; description: string; agentIds: string[]; leadAgentId: string }) => Promise<void>
  onNewBot: () => void
}): ReactElement {
  return <AddMembersModal {...props} manage />
}

export function RoutineModal({
  snapshot,
  initialAgentId,
  initialConversationId,
  onClose,
  onCreate
}: {
  snapshot: AppSnapshot
  initialAgentId?: string
  initialConversationId?: string
  onClose: () => void
  onCreate: (input: CreateRoutineInput) => Promise<void>
}): ReactElement {
  const firstAgent = snapshot.agents.find((agent) => agent.id === initialAgentId) ?? snapshot.agents[0]
  const defaultConversation =
    snapshot.conversations.find((conversation) => conversation.id === initialConversationId) ??
    snapshot.conversations.find(
      (conversation) => conversation.type === 'direct' && conversation.agentIds[0] === firstAgent?.id
    ) ??
    snapshot.conversations[0]
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [agentId, setAgentId] = useState(firstAgent?.id ?? '')
  const [conversationId, setConversationId] = useState(defaultConversation?.id ?? '')
  const [cadence, setCadence] = useState<'daily' | 'weekdays' | 'weekly' | 'interval'>('daily')
  const [time, setTime] = useState('09:00')
  const [day, setDay] = useState('1')
  const [intervalMinutes, setIntervalMinutes] = useState('60')
  const [saving, setSaving] = useState(false)

  function changeAgent(nextAgentId: string): void {
    setAgentId(nextAgentId)
    const direct = snapshot.conversations.find(
      (conversation) => conversation.type === 'direct' && conversation.agentIds[0] === nextAgentId
    )
    if (direct) setConversationId(direct.id)
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!name.trim() || !prompt.trim() || !agentId || !conversationId) return
    const schedule: RoutineSchedule =
      cadence === 'interval'
        ? { kind: 'interval', intervalMinutes: Math.max(1, Number(intervalMinutes) || 60) }
        : {
            kind: 'weekly',
            days: cadence === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : cadence === 'weekdays' ? [1, 2, 3, 4, 5] : [Number(day)],
            time
          }
    setSaving(true)
    try {
      await onCreate({
        name: name.trim(),
        prompt: prompt.trim(),
        agentId,
        conversationId,
        schedule,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const selectedAgent = snapshot.agents.find((agent) => agent.id === agentId)

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="agent-modal routine-modal" onSubmit={submit}>
        <div className="modal-heading">
          <div>
            <span className="eyebrow">{t('Automation')}</span>
            <h2>{t('Create a routine')}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('Close')}>
            <X size={18} />
          </button>
        </div>

        <div className="routine-preview">
          <span className="routine-clock">
            <CalendarClock size={21} />
          </span>
          <div>
            <strong>{name.trim() || t('Untitled routine')}</strong>
            <span>{tr('{name} will run this in a private computer.', { name: selectedAgent ? agentDisplayName(selectedAgent) : t('Choose an agent') })}</span>
          </div>
        </div>

        <label className="field-row">
          <span>{t('Name')}</span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('e.g. Review the morning brief')}
          />
        </label>

        <label className="field-row">
          <span>{t('What should happen?')}</span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t('Give the agent a complete instruction, including the expected result.')}
            rows={4}
          />
        </label>

        <div className="field-row two-fields">
          <label>
            <span>{t('Agent')}</span>
            <select value={agentId} onChange={(event) => changeAgent(event.target.value)}>
              {snapshot.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agentDisplayName(agent)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('Post results to')}</span>
            <select value={conversationId} onChange={(event) => setConversationId(event.target.value)}>
              {snapshot.conversations
                .filter((conversation) => conversation.agentIds.includes(agentId))
                .map((conversation) => (
                  <option key={conversation.id} value={conversation.id}>
                    {conversationDisplayName(conversation, snapshot.agents)}
                  </option>
                ))}
            </select>
          </label>
        </div>

        <div className="field-row routine-schedule-fields">
          <span>{t('Schedule')}</span>
          <div className="schedule-grid">
            <select value={cadence} onChange={(event) => setCadence(event.target.value as typeof cadence)}>
              <option value="daily">{t('Every day')}</option>
              <option value="weekdays">{t('Weekdays')}</option>
              <option value="weekly">{t('Every week')}</option>
              <option value="interval">{t('Repeating interval')}</option>
            </select>
            {cadence === 'weekly' && (
              <select value={day} onChange={(event) => setDay(event.target.value)}>
                {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((label, index) => (
                  <option key={label} value={index}>
                    {t(label)}
                  </option>
                ))}
              </select>
            )}
            {cadence === 'interval' ? (
              <select value={intervalMinutes} onChange={(event) => setIntervalMinutes(event.target.value)}>
                <option value="15">{t('Every 15 minutes')}</option>
                <option value="30">{t('Every 30 minutes')}</option>
                <option value="60">{t('Every hour')}</option>
                <option value="360">{t('Every 6 hours')}</option>
                <option value="720">{t('Every 12 hours')}</option>
              </select>
            ) : (
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            )}
          </div>
          <small>{tr('Times use {timezone}.', { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</small>
        </div>

        <div className="modal-footer">
          <p>{t('The app must be running. Missed times run once when the computer wakes.')}</p>
          <button className="primary-button" type="submit" disabled={saving || !name.trim() || !prompt.trim()}>
            {t(saving ? 'Creating…' : 'Create routine')}
          </button>
        </div>
      </form>
    </div>
  )
}

export function EndpointModal({
  endpoint,
  models,
  onClose,
  onSave,
  onTest
}: {
  endpoint: EndpointSettings
  models: number
  onClose: () => void
  onSave: (input: EndpointInput) => Promise<void>
  onTest: (input: EndpointInput) => Promise<EndpointTestResult>
}): ReactElement {
  const [baseUrl, setBaseUrl] = useState(endpoint.baseUrl)
  const [apiKey, setApiKey] = useState('')
  const [result, setResult] = useState<EndpointTestResult>()
  const [busy, setBusy] = useState(false)

  const input = (): EndpointInput => ({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || undefined })

  /** A missing IPC handler means the window reloaded onto a newer renderer
   * while the old main process kept running. Say so instead of failing mute. */
  const failure = (cause: unknown): EndpointTestResult => {
    const message = cause instanceof Error ? cause.message : String(cause)
    return {
      ok: false,
      models: 0,
      error: /no handler registered/i.test(message)
        ? 'This window is newer than the running app. Quit and start it again (npm run dev).'
        : message
    }
  }

  async function test(): Promise<EndpointTestResult> {
    setBusy(true)
    try {
      const check = await onTest(input()).catch(failure)
      setResult(check)
      return check
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    const check = await test()
    if (!check.ok) return
    setBusy(true)
    try {
      await onSave(input())
      onClose()
    } catch (cause) {
      setResult(failure(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="agent-modal" onSubmit={submit}>
        <div className="modal-heading">
          <div>
            <span className="eyebrow">{t('Models')}</span>
            <h2>{t('Connect an endpoint')}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('Close')}>
            <X size={18} />
          </button>
        </div>

        <div className="routine-preview">
          <span className="routine-clock">
            <PlugZap size={20} />
          </span>
          <div>
            <strong>{endpoint.hasApiKey ? tr('{count} chat models available', { count: models }) : t('Not connected yet')}</strong>
            <span>
              {endpoint.source === 'env'
                ? t('Currently read from .env — saving here overrides it.')
                : t('Any OpenAI-compatible base URL works, including a local router.')}
            </span>
          </div>
        </div>

        <label className="field-row">
          <span>{t('Base URL')}</span>
          <input
            autoFocus
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="http://localhost:8080/api/v1"
            spellCheck={false}
          />
        </label>

        <label className="field-row">
          <span>{t('API key')}</span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={endpoint.hasApiKey ? t('Saved — type to replace it') : 'sk-…'}
            spellCheck={false}
          />
          <small>{t("Stored on this computer, in the app's own data folder.")}</small>
        </label>

        {result && (
          <p className={`endpoint-result ${result.ok ? 'ok' : 'failed'}`}>
            {result.ok ? tr('Reached the endpoint · {count} chat models', { count: result.models }) : t(result.error ?? '')}
          </p>
        )}

        <div className="modal-footer">
          <button type="button" className="quiet-link" onClick={() => void test()} disabled={busy}>
            {t('Test connection')}
          </button>
          <button className="primary-button" type="submit" disabled={busy || !baseUrl.trim()}>
            {t(busy ? 'Checking…' : 'Save and connect')}
          </button>
        </div>
      </form>
    </div>
  )
}
