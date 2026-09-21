import { useEffect, useRef, useState } from 'react'
import { MessageCircle, Plus, Send, UsersRound, X } from 'lucide-react'
import type { AgentConfig } from '../../../shared/types'
import type { SocialAction, SocialMessage, SocialResult, SocialRoom, SocialSnapshot } from '../../../shared/social'
import { resolveInterfaceLanguage, usePreferences } from '../preferences'
import { UserAvatar } from './common'

export function SocialWorkspace({ agents, userId, onAddFriend, embedded = false, friendId, roomId, showRequests = false, startGroup = false, onRoomCreated, onOpenDirectChat }: { onOpenDirectChat?: (id: string) => void; agents: AgentConfig[]; userId: string; onAddFriend: () => void; embedded?: boolean; friendId?: string; roomId?: string; showRequests?: boolean; startGroup?: boolean; onRoomCreated?: (id: string) => void }) {
  const prefs = usePreferences()
  const zh = resolveInterfaceLanguage(prefs.language) === 'zh-CN'
  const l = (cn: string, en: string) => zh ? cn : en
  const [snapshot, setSnapshot] = useState<SocialSnapshot>()
  const [activeId, setActiveId] = useState(roomId || '')
  const [messages, setMessages] = useState<SocialMessage[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [target, setTarget] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(startGroup)
  const [groupName, setGroupName] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const activeRef = useRef(activeId)
  activeRef.current = activeId
  const bottom = useRef<HTMLDivElement>(null)
  const scrollToBottom = useRef(true)
  const lastSend = useRef<{ signature: string; id: string } | undefined>(undefined)
  const room = snapshot?.rooms.find((item) => item.id === activeId)
  const friends = snapshot?.friendships.filter((item) => item.status === 'accepted') ?? []
  const pending = snapshot?.friendships.filter((item) => item.status === 'pending') ?? []
  const myAgents = agents.filter((a) => (!a.ownerId || a.ownerId === userId))
  const ownRoomAgents = room?.agents.filter((a) => a.ownerId === userId) ?? []
  const roomName = (item: SocialRoom) => item.kind === 'direct' ? item.members.find((p) => p.id !== userId)?.name || item.name : item.name
  const draft = drafts[activeId] || ''
  useEffect(() => { if (room?.kind === 'direct') onOpenDirectChat?.(`friend:${userId}:${room.id}`) }, [room?.id, room?.kind])
  useEffect(() => {
    if (!friendId) return
    let active = true
    void window.douchat.socialAction({ action: 'create-room', kind: 'direct', friendIds: [friendId] }).then((result) => {
      if (active && result.roomId) setActiveId(result.roomId)
      return window.douchat.getSocialSnapshot()
    }).then((next) => { if (active) setSnapshot(next) }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [friendId])
  function merge(incoming: SocialMessage[]) {
    setMessages((previous) => {
      const byId = new Map(previous.map((m) => [m.id, m]))
      incoming.forEach((m) => byId.set(m.id, m))
      return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    })
  }
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const next = await window.douchat.getSocialSnapshot()
        if (!stopped && next.userId === userId) setSnapshot(next)
      } catch (cause) { if (!stopped) setError(String(cause instanceof Error ? cause.message : cause)) }
      finally { if (!stopped) timer = setTimeout(refresh, 3000) }
    }
    void refresh()
    return () => { stopped = true; clearTimeout(timer) }
  }, [userId])
  useEffect(() => {
    setMessages([]); setTarget(''); setHasMore(false)
    scrollToBottom.current = true
    if (!activeId) return
    let stopped = false
    let firstPage = true
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const result = await window.douchat.socialAction({ action: 'messages', roomId: activeId })
        if (!stopped) { merge(result.messages || []); if (firstPage) { setHasMore(Boolean(result.hasMore)); firstPage = false } }
      } catch (cause) { if (!stopped) setError(String(cause instanceof Error ? cause.message : cause)) }
      finally { if (!stopped) timer = setTimeout(refresh, 2000) }
    }
    void refresh()
    return () => { stopped = true; clearTimeout(timer) }
  }, [activeId])
  useEffect(() => { if (scrollToBottom.current) bottom.current?.scrollIntoView({ block: 'end' }) }, [messages])
  useEffect(() => {
    if (target && !ownRoomAgents.some((a) => a.id === target)) setTarget('')
  }, [room?.agents, target])
  async function action(input: SocialAction): Promise<SocialResult | undefined> {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await window.douchat.socialAction(input)
      try {
        const next = await window.douchat.getSocialSnapshot()
        if (next.userId === userId) setSnapshot(next)
      } catch { /* Polling refreshes the already-confirmed mutation. */ }
      return result
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return undefined }
    finally { setBusy(false) }
  }
  async function send() {
    if (!room || !draft.trim() || busy) return
    const content = draft.trim()
    const capturedId = room.id
    const signature = JSON.stringify([capturedId, content, target])
    if (lastSend.current?.signature !== signature) lastSend.current = { signature, id: crypto.randomUUID() }
    const result = await action({ action: 'send', roomId: capturedId, content, id: lastSend.current.id, ...(target ? { agentId: target } : {}) })
    if (!result) return
    lastSend.current = undefined
    setDrafts((previous) => previous[capturedId]?.trim() === content ? { ...previous, [capturedId]: '' } : previous)
    if (activeRef.current === capturedId) {
      try {
        const next = await window.douchat.socialAction({ action: 'messages', roomId: capturedId })
        if (activeRef.current === capturedId) { scrollToBottom.current = true; merge(next.messages || []) }
      } catch { /* Polling recovers the confirmed message. */ }
    }
  }
  return <div className={`social-workspace ${embedded ? 'embedded' : ''}`}>
    {!embedded && <aside className="social-sidebar">
      <header><h2>{l('好友与群聊', 'Friends & groups')}</h2><button className="icon-button" title={l('创建群聊', 'Create group')} aria-label={l('创建群聊', 'Create group')} onClick={() => setCreating(true)}><Plus size={20} /></button></header>
      <button className="social-add-friend-button" onClick={onAddFriend}><Plus size={17} />{l('添加朋友', 'Add friend')}</button>
      {pending.length > 0 && <section className="social-requests"><h3>{l('好友申请', 'Friend requests')} · {pending.length}</h3>{pending.map((request) => <div className="social-request" key={request.id}>
        <strong>{request.person.name}</strong><small>{request.person.email}</small>
        {request.recipientId === userId ? <div><button disabled={busy} onClick={() => void action({ action: 'respond', id: request.id, accept: true })}>{l('接受', 'Accept')}</button><button disabled={busy} onClick={() => void action({ action: 'respond', id: request.id, accept: false })}>{l('拒绝', 'Decline')}</button></div> : <small>{l('等待对方接受', 'Awaiting acceptance')}</small>}
      </div>)}</section>}
      <section className="social-friends"><h3>{l('好友', 'Friends')} · {friends.length}</h3>{friends.map((friend) => <button key={friend.id} disabled={busy} onClick={() => void action({ action: 'create-room', kind: 'direct', friendIds: [friend.person.id] }).then((result) => { if (result?.roomId) setActiveId(result.roomId) })}><UserAvatar name={friend.person.name} src="" size={30} /><span>{friend.person.name}<small>{friend.person.email}</small></span><MessageCircle size={15} /></button>)}{!friends.length && <p>{l('点击“添加朋友”，搜索邮箱后发送申请。', 'Enter a friend’s registered email to send your first request.')}</p>}</section>
      <section className="social-room-list"><h3>{l('会话', 'Conversations')}</h3>{snapshot?.rooms.map((item) => <button className={item.id === activeId ? 'selected' : ''} key={item.id} onClick={() => setActiveId(item.id)}>{item.kind === 'group' ? <UsersRound size={20} /> : <MessageCircle size={20} />}<span>{roomName(item)}<small>{item.kind === 'group' ? l(`${item.members.length} 人 · ${item.agents.length} 个 agent`, `${item.members.length} people · ${item.agents.length} agents`) : l('好友私聊', 'Direct message')}</small></span></button>)}</section>
    </aside>}
    <main className="social-chat">
      {error && <div className="social-feedback error" role="alert">{error}<button aria-label={l('关闭提示', 'Dismiss')} onClick={() => setError('')}><X size={16} /></button></div>}
      {notice && <div className="social-feedback" role="status">{notice}</div>}
      {showRequests ? <section className="friend-requests-panel"><h2>{l('好友申请', 'Friend requests')}</h2>{pending.map((request) => <div className="social-request" key={request.id}><strong>{request.person.name}</strong><small>{request.person.email}</small>{request.recipientId === userId ? <div><button disabled={busy} onClick={() => void action({ action: 'respond', id: request.id, accept: true })}>{l('接受', 'Accept')}</button><button disabled={busy} onClick={() => void action({ action: 'respond', id: request.id, accept: false })}>{l('拒绝', 'Decline')}</button></div> : <small>{l('等待对方接受', 'Awaiting acceptance')}</small>}</div>)}{!pending.length && <p>{l('暂无好友申请', 'No friend requests')}</p>}<button className="secondary-button" onClick={onAddFriend}>{l('添加朋友', 'Add friend')}</button></section> : room?.kind === 'direct' ? null : room ? <>
        <header className="social-chat-header"><h2>{roomName(room)}</h2><p>{room.kind === 'group' ? l('每个人只能指挥自己的 agent', 'Everyone directs only their own agents') : l('好友私聊', 'Direct message')}</p></header>
        {room.kind === 'group' && <div className="social-members">
          {room.members.map((person) => <span key={person.id} className="social-member">{person.name}{person.id === userId ? l('（我）', ' (you)') : ''}</span>)}
          {room.agents.map((agent) => <span key={agent.id} className={`social-member agent ${agent.ownerId === userId ? 'owned' : ''}`}><strong>{agent.name}</strong><small>{room.members.find((p) => p.id === agent.ownerId)?.name}{l('的 agent', '’s agent')}</small>{agent.ownerId === userId && <button disabled={busy} title={l('移出群聊', 'Remove from group')} aria-label={`${l('移出群聊', 'Remove from group')}: ${agent.name}`} onClick={() => void action({ action: 'remove-agent', roomId: room.id, localId: agent.localId })}><X size={12} /></button>}</span>)}
          <select aria-label={l('添加我的 agent', 'Add my agent')} value="" disabled={busy} onChange={(e) => { if (e.target.value) void action({ action: 'add-agent', roomId: room.id, localId: e.target.value }) }}><option value="">+ {l('添加我的 agent', 'Add my agent')}</option>{myAgents.filter((a) => !ownRoomAgents.some((m) => m.localId === a.id)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        </div>}
        <div className="social-messages" role="log" aria-label={l('聊天消息', 'Messages')} onScroll={(e) => { const el = e.currentTarget; scrollToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100 }}>
          {hasMore && <button className="social-load-more" disabled={busy} onClick={() => { const id = room.id; void action({ action: 'messages', roomId: id, before: messages[0]?.id }).then((result) => { if (result && activeRef.current === id) { scrollToBottom.current = false; merge(result.messages || []); setHasMore(Boolean(result.hasMore)) } }) }}>{l('加载更早的消息', 'Load earlier messages')}</button>}
          {!messages.length && <div className="social-empty"><MessageCircle size={32} /><p>{l('聊点什么吧。', 'Start the conversation.')}</p></div>}
          {messages.map((message) => <div key={message.id} className="social-message-pair"><article className={`social-message ${message.authorId === userId ? 'mine' : ''}`}><small>{message.authorName} · {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small><div>{message.agentId && <span className="social-target">@{message.agentName} </span>}{message.content}</div>{message.agentId && <small className="social-task-status">{({ pending: l('等待主人设备执行', 'Waiting for owner’s device'), running: l('正在执行', 'Working'), succeeded: l('已完成', 'Completed'), failed: l('执行失败', 'Failed'), sent: '' })[message.status]}</small>}</article>{message.reply && <article className={`social-message agent-reply ${message.status === 'failed' ? 'failed' : ''}`}><small>{message.agentName} · {message.authorName}{l('的 agent', '’s agent')}</small><div>{message.reply}</div></article>}</div>)}
          <div ref={bottom} />
        </div>
        <form className="social-composer" onSubmit={(e) => { e.preventDefault(); void send() }}>
          {room.kind === 'group' && <label>{l('发送给', 'Send to')}<select aria-label={l('任务接收者', 'Task recipient')} value={target} onChange={(e) => setTarget(e.target.value)}><option value="">{l('群聊（不执行任务）', 'Group (chat only)')}</option>{ownRoomAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}{l('（我的 agent）', ' (my agent)')}</option>)}</select></label>}
          <div><textarea aria-label={l('消息', 'Message')} placeholder={target ? l('让我的 agent 做什么…', 'Give your agent a task…') : l('发送消息…', 'Write a message…')} maxLength={16000} value={draft} onChange={(e) => setDrafts((previous) => ({ ...previous, [activeId]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} /><button disabled={busy || !draft.trim()} type="submit" aria-label={l('发送', 'Send')}><Send size={19} /></button></div>
          {target && <small>{l('任务由你的设备执行，回复对全群可见。', 'Your device runs this task. The reply is visible to the whole group.')}</small>}
        </form>
      </> : <div className="social-empty"><UsersRound size={42} /><h2>{l('和朋友、自己的 agent 一起聊', 'Chat with friends and your agents')}</h2><p>{l('接受好友申请后即可私聊，也可以创建群聊。', 'Accept a friend request to chat directly or create a group.')}</p></div>}
    </main>
    {creating && <div className="modal-backdrop" onClick={() => setCreating(false)}><form className="social-group-dialog" role="dialog" aria-modal="true" aria-label={l('创建群聊', 'Create group')} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') setCreating(false) }} onSubmit={(e) => { e.preventDefault(); void action({ action: 'create-room', kind: 'group', name: groupName, friendIds: selected }).then((result) => { if (result?.roomId) { setActiveId(result.roomId); setCreating(false); setGroupName(''); setSelected([]); onRoomCreated?.(result.roomId) } }) }}><header><h2>{l('创建群聊', 'Create group')}</h2><button type="button" aria-label={l('关闭', 'Close')} onClick={() => setCreating(false)}><X size={20} /></button></header><label>{l('群名称', 'Group name')}<input autoFocus required maxLength={100} value={groupName} onChange={(e) => setGroupName(e.target.value)} /></label><p>{l('选择好友，大家都可以添加自己的 agent。', 'Choose friends. Each person can add their own agents.')}</p>{friends.map((friend) => <label className="social-friend-choice" key={friend.id}><input type="checkbox" checked={selected.includes(friend.person.id)} onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, friend.person.id] : ids.filter((id) => id !== friend.person.id))} />{friend.person.name}<small>{friend.person.email}</small></label>)}{!friends.length && <p>{l('先添加一位好友，即可创建群聊。', 'Add a friend first to create a group.')}</p>}{error && <p role="alert">{error}</p>}<button className="social-create" disabled={busy || !selected.length || !groupName.trim()}>{l('创建群聊', 'Create group')}</button></form></div>}
  </div>
}
