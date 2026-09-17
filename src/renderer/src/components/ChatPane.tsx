import douchatLogo from '../../../../resources/icons/douchat.png'
import { t } from '../preferences'
import { AtSign, Check, ChevronDown, Copy, Lock, MoreHorizontal, Smile, TriangleAlert, Sparkles, Square } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'
import type {
  AgentConfig,
  ChatMessage,
  Conversation,
  ConversationActivityState,
  MessageAttachment,
  Topic
} from '../../../shared/types'
import { MessageMarkdown } from './MessageMarkdown'
import { summarizeRuntimeError } from '../../../shared/bot/errors'
import { insertMention, mentionQuery, type MentionQuery } from '../../../shared/bot/mentions'
import { AgentAvatar, ConversationAvatar, EmptyAvatar, UserAvatar, dayLabel, formatTime, isDifferentDay } from './common'

function MessageImage({ attachment }: { attachment: MessageAttachment }): ReactElement {
  const [source, setSource] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setSource('')
    setFailed(false)
    void window.douchat.getAttachmentData(attachment.id).then((dataUrl) => {
      if (active) setSource(dataUrl)
    }).catch(() => {
      if (active) setFailed(true)
    })
    return () => { active = false }
  }, [attachment.id])

  if (failed) return <div className="message-image-state">图片加载失败</div>
  if (!source) return <div className="message-image-state is-loading" aria-label="正在加载图片" />
  return <img className="message-image" src={source} alt={attachment.name || 'Agent generated image'} />
}

function MessageAttachments({ attachments }: { attachments?: MessageAttachment[] }): ReactElement | null {
  if (!attachments?.length) return null
  return (
    <div className={`message-attachments count-${Math.min(attachments.length, 4)}`}>
      {attachments.map((attachment) => <MessageImage key={attachment.id} attachment={attachment} />)}
    </div>
  )
}

function MessageGroupRow({
  messages,
  agent,
  showAuthor
}: {
  messages: ChatMessage[]
  agent?: AgentConfig
  showAuthor: boolean
}): ReactElement {
  const first = messages[0]
  return (
    <div className="message-row agent-message-row">
      <div className="message-avatar-slot">
        {agent ? <AgentAvatar agent={agent} size={36} /> : <EmptyAvatar size={36} />}
      </div>
      <div className="message-body">
        {(showAuthor || first.source) && (
          <div className="message-author">
            {first.authorName}
            {first.source && (
              <span className="message-source">
                <Sparkles size={10} />
                {first.source.kind === 'group' ? `private from ${first.source.name}` : `via ${first.source.name}`}
              </span>
            )}
          </div>
        )}
        {messages.map((message) => (
          <div key={message.id} className={`message-bubble agent-bubble ${message.error ? 'has-error' : ''} ${message.attachments?.length ? 'has-attachments' : ''} ${!message.text && message.attachments?.length ? 'image-only' : ''}`}>
            {message.text && <MessageMarkdown text={message.text} />}
            <MessageAttachments attachments={message.attachments} />
            {message.error && <span className="bubble-error">{message.error}</span>}
            {message.deliveries?.length ? (
              <span className="bubble-deliveries">
                <Lock size={10} />
                {message.deliveries.map((delivery) => `Sent privately to ${delivery.recipientName}`).join(' · ')}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

/** A failure shows its headline; the raw dump it was summarised from stays one
 *  click away rather than filling the thread. */
function SystemMessage({ message }: { message: ChatMessage }): ReactElement {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  // Messages written before failures were summarised, and any path that still
  // hands over a raw dump, get folded here rather than filling the thread.
  const summary = message.detail
    ? { title: message.text, detail: message.detail }
    : message.text.length > 200
      ? summarizeRuntimeError(message.text)
      : null
  if (!summary) return <div className="system-message">{message.text}</div>

  return (
    <div className={`system-message is-error ${open ? 'is-open' : ''}`}>
      <div className="system-line">
        <TriangleAlert size={13} />
        <span>{summary.title}</span>
        <button
          className="system-toggle"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          {open ? 'Hide' : 'Details'}
          <ChevronDown size={11} className={open ? 'open' : ''} />
        </button>
      </div>
      {open && (
        <div className="system-detail">
          <pre>{summary.detail}</pre>
          <button
            className="system-copy"
            onClick={() => {
              void navigator.clipboard.writeText(summary.detail).then(() => setCopied(true))
            }}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
    </div>
  )
}

function MessageRow({
  message,
  agent,
  userName,
  userAvatar,
  showAuthor
}: {
  message: ChatMessage
  agent?: AgentConfig
  userName: string
  userAvatar: string
  showAuthor: boolean
}): ReactElement {
  if (message.kind === 'handoff') {
    return (
      <div className="handoff-row">
        <span className="handoff-line" />
        <span className="handoff-chip">
          <Sparkles size={12} />
          {message.text}
        </span>
        <span className="handoff-line" />
      </div>
    )
  }
  if (message.kind === 'system') return <SystemMessage message={message} />
  if (message.authorId === 'user') {
    return (
      <div className="message-row user-message-row">
        <div className="message-bubble user-bubble">{message.text}</div>
        <UserAvatar
          src={userAvatar}
          name={userName}
          size={36}
          className="user-chat-avatar"
        />
      </div>
    )
  }
  return <MessageGroupRow messages={[message]} agent={agent} showAuthor={showAuthor} />
}

export function ChatPane({
  userName,
  userAvatar,
  conversation,
  topic,
  messages: recentMessages,
  agents,
  members,
  activity,
  offline,
  onConnect,
  inspectorOpen,
  onToggleInspector,
  onSend,
  onStop
}: {
  userName: string
  userAvatar: string
  conversation?: Conversation
  topic?: Topic
  messages: ChatMessage[]
  agents: AgentConfig[]
  members: AgentConfig[]
  activity?: ConversationActivityState
  offline: boolean
  onConnect: () => void
  inspectorOpen: boolean
  onToggleInspector: () => void
  onSend: (text: string) => Promise<void>
  onStop: () => void
}): ReactElement {
  const [history, setHistory] = useState(() => ({ source: recentMessages, messages: recentMessages.slice(-50) }))
  const [hasMore, setHasMore] = useState(recentMessages.length > 50)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyError, setHistoryError] = useState(false)
  const loadingRef = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  let messages = history.messages
  if (history.source !== recentMessages) {
    const updates = new Map(recentMessages.map((message) => [message.id, message]))
    const known = new Set(history.messages.map((message) => message.id))
    const lastKnownIndex = recentMessages.reduce((last, message, index) => known.has(message.id) ? index : last, -1)
    messages = recentMessages.length ? [
      ...history.messages.map((message) => updates.get(message.id) ?? message),
      ...recentMessages.slice(lastKnownIndex + 1)
    ] : []
    if (!history.messages.length) messages = recentMessages.slice(-50)
    setHistory({ source: recentMessages, messages })
    if (!recentMessages.length) setHasMore(false)
  }
  const [draft, setDraft] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [mention, setMention] = useState<MentionQuery | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const working = Boolean(activity)

  useEffect(() => {
    setDraft('')
    setMention(null)
    setEmojiOpen(false)
  }, [conversation?.id, topic?.id])

  const nearBottom = useRef(true)
  const initialScroll = useRef(true)
  const prependPosition = useRef<{ height: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const node = scrollRef.current
    if (!node) return
    if (prependPosition.current) {
      node.scrollTop = prependPosition.current.top + node.scrollHeight - prependPosition.current.height
      prependPosition.current = null
    } else if (initialScroll.current || nearBottom.current) {
      node.scrollTop = node.scrollHeight
      initialScroll.current = false
    }
  }, [messages, activity?.phase, activity?.label])

  async function loadOlder(): Promise<void> {
    const node = scrollRef.current
    if (!node || !conversation || !topic || !hasMore || loadingRef.current) return
    loadingRef.current = true
    setLoadingHistory(true)
    setHistoryError(false)
    try {
      const page = await window.douchat.getMessagePage(conversation.id, topic.id, messages[0]?.id)
      if (!alive.current) return
      prependPosition.current = { height: node.scrollHeight, top: node.scrollTop }
      setHistory((current) => {
        const ids = new Set(current.messages.map((message) => message.id))
        return { ...current, messages: [...page.messages.filter((message) => !ids.has(message.id)), ...current.messages] }
      })
      setHasMore(page.hasMore)
    } catch {
      if (alive.current) setHistoryError(true)
    } finally {
      loadingRef.current = false
      if (alive.current) setLoadingHistory(false)
    }
  }

  const mentionOptions = useMemo(() => {
    if (!mention || conversation?.type !== 'group') return []
    const needle = mention.query.normalize('NFKC').toLocaleLowerCase()
    return [
      { id: 'all', name: 'all', label: 'Everyone', agent: undefined as AgentConfig | undefined },
      ...members.map((member) => ({ id: member.id, name: member.name, label: member.name, agent: member }))
    ].filter((option) => `${option.label} ${option.name}`.normalize('NFKC').toLocaleLowerCase().includes(needle))
  }, [mention, members, conversation?.type])

  useEffect(() => setMentionIndex(0), [mention?.query])

  const applyMention = (name: string): void => {
    if (!mention) return
    const next = insertMention(draft, mention, name)
    setDraft(next.value)
    setMention(null)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(next.cursor, next.cursor)
    })
  }

  const trackMention = (value: string, cursor: number | null): void => {
    if (conversation?.type !== 'group' || cursor === null) {
      setMention(null)
      return
    }
    setMention(mentionQuery(value, cursor, members.map((member) => ({ id: member.id, name: member.name }))))
  }

  const send = async (): Promise<void> => {
    const content = draft.trim()
    if (!content || !conversation || sending || working) return
    setDraft('')
    setMention(null)
    setSending(true)
    try {
      await onSend(content)
    } catch {
      setDraft(content)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (mention && mentionOptions.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setMentionIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + mentionOptions.length) % mentionOptions.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        applyMention(mentionOptions[Math.min(mentionIndex, mentionOptions.length - 1)].name)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMention(null)
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  const activityLabel = (): string => {
    if (!activity) return ''
    if (activity.phase === 'planning') return t('Coordinating the group')
    if (activity.phase === 'greeting') return t('Preparing a greeting')
    if (activity.phase === 'delivering') return t('Delivering a message')
    return t('Preparing a reply')
  }


  if (!conversation) return (
    <main className="workspace empty-conversation" aria-label={t('No conversation selected')}>
      <img className="empty-conversation-mark" src={douchatLogo} alt="Douchat" draggable={false} />
    </main>
  )

  return (
    <main className="workspace">
      <header className="workspace-header window-drag">
        <div className="workspace-identity">
          <div>
            <strong>
              {conversation?.name || 'Douchat'}
              {conversation?.type === 'group' ? ` (${members.length})` : ''}
            </strong>
          </div>
        </div>
        <div className="workspace-header-actions no-drag">
          <button onClick={onToggleInspector} aria-label={t('Chat details')} title={t('Chat details')} aria-expanded={inspectorOpen}>
            <MoreHorizontal size={20} />
          </button>
        </div>
      </header>

      <div className="message-scroll" ref={scrollRef} onScroll={(event) => {
        const node = event.currentTarget
        nearBottom.current = node.scrollHeight - node.clientHeight - node.scrollTop < 64
        if (node.scrollTop < 80 && !initialScroll.current && !historyError) void loadOlder()
      }}>
        <div className="message-canvas">
          {hasMore && <button className="history-load" disabled={loadingHistory} onClick={() => void loadOlder()}>{t(loadingHistory ? 'Loading…' : historyError ? 'Retry loading earlier messages' : 'Load earlier messages')}</button>}
          {!messages.length && !working && (
            <div className="empty-thread">
              {conversation ? <ConversationAvatar conversation={conversation} agents={agents} size={46} /> : <EmptyAvatar size={46} />}
              <h1>{t('No messages yet')}</h1>
              <p>
                Send a message to {conversation?.name || 'a contact'}
                {conversation?.type === 'group' ? ', or @ a member to address them directly.' : '.'}
              </p>
            </div>
          )}
          {messages.map((message, index) => {
            const previous = messages[index - 1]
            const agent = agents.find((item) => item.id === message.authorId)
            const breaks = !previous || isDifferentDay(message, previous) || message.createdAt - previous.createdAt >= 300_000
            return (
              <div key={message.id}>
                {breaks && (
                  <div className="date-separator">
                    <span>{isDifferentDay(message, previous) ? `${dayLabel(message.createdAt)} ` : ''}{formatTime(message.createdAt)}</span>
                  </div>
                )}
                <MessageRow
                  message={message}
                  agent={agent}
                  userName={userName}
                  userAvatar={userAvatar}
                  showAuthor={conversation?.type === 'group'}
                />
              </div>
            )
          })}
          {activity && (
            <div className="typing-row">
              {activity.agentIds
                .map((id) => agents.find((agent) => agent.id === id))
                .filter((agent): agent is AgentConfig => Boolean(agent))
                .map((agent) => (
                  <AgentAvatar key={agent.id} agent={agent} size={36} />
                ))}
              <div className="typing-content" role="status">
                <span className="typing-label">{activity.agentIds.map((id) => agents.find((agent) => agent.id === id)?.name).filter(Boolean).join('、') || activity.label}</span>
                <span className="typing-bubble typing-activity"><span>{activityLabel()}</span><span className="reply-status-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></span>
              </div>
            </div>
          )}
          {activity?.takeover && (
            <div className="system-message">
              {activity.takeover.unavailableName} is unavailable — {activity.takeover.replacementName} is standing in.
            </div>
          )}
        </div>
      </div>

      <div className="composer-wrap">
        {offline && (
          <div className="offline-banner">
            <span>Choose a local agent or connect a model endpoint to start chatting.</span>
            <button onClick={onConnect}>Choose agent</button>
          </div>
        )}
        {mention && mentionOptions.length > 0 && (
          <div className="mention-menu" role="listbox" aria-label="Mention a member">
            <div className="mention-title">Mention a member</div>
            {mentionOptions.map((option, index) => (
              <button
                key={option.id}
                role="option"
                aria-selected={index === mentionIndex}
                className={index === mentionIndex ? 'selected' : ''}
                onMouseEnter={() => setMentionIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyMention(option.name)}
              >
                {option.agent ? <AgentAvatar agent={option.agent} size={22} /> : <span className="mention-all"><AtSign size={13} /></span>}
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        )}
        <div className={`composer ${draft.trim() ? 'has-content' : ''}`}>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              trackMention(event.target.value, event.target.selectionStart)
            }}
            onKeyUp={(event) => trackMention(event.currentTarget.value, event.currentTarget.selectionStart)}
            onClick={(event) => trackMention(event.currentTarget.value, event.currentTarget.selectionStart)}
            onKeyDown={handleKeyDown}
            placeholder={
              conversation
                ? `Message ${conversation.name}${conversation.type === 'group' ? ' · @ to mention' : ''}`
                : 'Create a bot to start chatting'
            }
            rows={2}
            disabled={!conversation}
          />
          <div className="composer-bottom">
            <div className="composer-tools">
              <button className="emoji-toggle" onClick={() => setEmojiOpen((open) => !open)} aria-label={t('Emoji')} aria-expanded={emojiOpen}><Smile size={22} /></button>
              {conversation?.type === 'group' && <button className="emoji-toggle" aria-label="Mention a member" onClick={() => {
                const next = `${draft}${draft && !draft.endsWith(' ') ? ' ' : ''}@`
                setDraft(next); trackMention(next, next.length); textareaRef.current?.focus()
              }}><AtSign size={21} /></button>}
            </div>
            {emojiOpen && <div className="emoji-picker" aria-label="Choose an emoji">{['😀', '😂', '🥰', '👍', '🎉', '❤️', '🙏', '🤔'].map((emoji) => <button key={emoji} onClick={() => { setDraft((text) => text + emoji); setEmojiOpen(false); textareaRef.current?.focus() }}>{emoji}</button>)}</div>}
          {working ? (
            <button className="stop-button" onClick={onStop} aria-label="Stop the current reply" title="Stop">
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              className="send-button"
              onClick={() => void send()}
              disabled={sending || !draft.trim()}
              aria-label={t('Send message')}
            >
              Send
            </button>
          )}
          </div>
        </div>
      </div>
    </main>
  )
}
