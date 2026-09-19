import douchatLogo from '../../../../resources/icons/douchat.png'
import { t, tr } from '../preferences'
import { AtSign, Check, ChevronDown, Copy, CornerDownRight, LoaderCircle, Lock, Mic, MoreHorizontal, Smile, TriangleAlert, Sparkles, Square, X } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent, KeyboardEvent, ReactElement } from 'react'
import type {
  AgentConfig,
  ChatMessage,
  Conversation,
  ConversationActivityState,
  MessageAttachment,
  MessageDelivery,
  MessageImageInput,
  MessageSource,
  Topic
} from '../../../shared/types'
import { MessageMarkdown } from './MessageMarkdown'
import { summarizeRuntimeError } from '../../../shared/bot/errors'
import { insertMention, mentionQuery, type MentionQuery } from '../../../shared/bot/mentions'
import { AgentAvatar, EmptyAvatar, UserAvatar, agentDisplayName, conversationDisplayName, dayLabel, formatTime, isDifferentDay } from './common'
import {
  speechRecognitionConstructor,
  speechRecognitionErrorMessage,
  speechRecognitionLanguage,
  type SpeechRecognitionLike
} from '../speechRecognition'

const MAX_PASTED_IMAGES = 4
const MAX_PASTED_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_PASTED_IMAGE_TOTAL_BYTES = 20 * 1024 * 1024
const PASTED_IMAGE_TYPES = new Set<MessageAttachment['mimeType']>(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

interface PendingImage {
  id: string
  name: string
  mimeType: MessageAttachment['mimeType']
  size: number
  data: Uint8Array
  previewUrl: string
}

type VoiceInputState = 'idle' | 'starting' | 'listening' | 'processing'

async function readPastedImage(file: File): Promise<PendingImage> {
  const buffer = await file.arrayBuffer()
  const previewUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid image data'))
    reader.onerror = () => reject(reader.error ?? new Error('Invalid image data'))
    reader.readAsDataURL(new Blob([buffer], { type: file.type }))
  })
  return {
    id: crypto.randomUUID(),
    name: file.name || 'pasted-image',
    mimeType: file.type as MessageAttachment['mimeType'],
    size: file.size,
    data: new Uint8Array(buffer),
    previewUrl
  }
}

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

  if (failed) return <div className="message-image-state">{t('Image could not be loaded')}</div>
  if (!source) return <div className="message-image-state is-loading" aria-label={t('Loading image')} />
  return <img className="message-image" src={source} alt={attachment.name || t('Agent generated image')} />
}

function MessageAttachments({ attachments }: { attachments?: MessageAttachment[] }): ReactElement | null {
  if (!attachments?.length) return null
  return (
    <div className={`message-attachments count-${Math.min(attachments.length, 4)}`}>
      {attachments.map((attachment) => <MessageImage key={attachment.id} attachment={attachment} />)}
    </div>
  )
}

function deliveryRecipientName(delivery: MessageDelivery): string {
  return delivery.recipientName === 'Dr. Dou' ? t('Dr. Dou') : delivery.recipientName
}

function sourceContentFromMessages(
  source: MessageSource,
  receiverId: string,
  receivedAt: number,
  messages: ChatMessage[]
): string {
  return messages
    .filter((message) => message.authorId === source.id && message.createdAt <= receivedAt)
    .sort((left, right) => right.createdAt - left.createdAt)
    .flatMap((message) => message.deliveries ?? [])
    .find((delivery) => delivery.recipientId === receiverId)?.content ?? ''
}

function repliesForDelivery(
  delivery: MessageDelivery,
  senderId: string,
  sentAt: number,
  messages: ChatMessage[]
): NonNullable<MessageDelivery['replies']> {
  const messagesById = new Map(messages.map((message) => [message.id, message]))
  const replies = (delivery.replies ?? []).map((reply) => {
    const replyGroupId = reply.replyGroupId ?? messagesById.get(reply.id)?.replyGroupId
    return replyGroupId && !reply.replyGroupId ? { ...reply, replyGroupId } : reply
  })
  const known = new Set(replies.map((reply) => reply.id))
  const nextDeliveryAt = messages
    .filter((message) => message.authorId === senderId && message.createdAt > sentAt)
    .filter((message) => message.deliveries?.some((candidate) => candidate.recipientId === delivery.recipientId))
    .reduce((earliest, message) => Math.min(earliest, message.createdAt), Number.POSITIVE_INFINITY)
  for (const message of messages) {
    if (
      known.has(message.id) ||
      message.authorId !== delivery.recipientId ||
      message.source?.kind !== 'bot' ||
      message.source.id !== senderId ||
      message.createdAt < sentAt ||
      message.createdAt >= nextDeliveryAt
    ) continue
    replies.push({
      id: message.id,
      senderId: message.authorId,
      senderName: message.authorName,
      content: message.text,
      createdAt: message.createdAt,
      replyGroupId: message.replyGroupId,
      attachments: message.attachments,
      error: message.error
    })
    known.add(message.id)
  }
  return replies.sort((left, right) => left.createdAt - right.createdAt)
}

type DeliveryReply = NonNullable<MessageDelivery['replies']>[number]

export function groupDeliveryReplies(replies: DeliveryReply[]): DeliveryReply[][] {
  const groups: DeliveryReply[][] = []
  for (const reply of replies) {
    const previousGroup = groups.at(-1)
    const previous = previousGroup?.at(-1)
    const sameReplyTurn = Boolean(
      previous &&
      previous.senderId === reply.senderId &&
      (
        (reply.replyGroupId && previous.replyGroupId === reply.replyGroupId) ||
        (!reply.replyGroupId && !previous.replyGroupId && previous.createdAt === reply.createdAt)
      )
    )
    if (sameReplyTurn) previousGroup!.push(reply)
    else groups.push([reply])
  }
  return groups
}

export function MessageDeliveries({
  deliveries,
  agents = [],
  userName = '',
  userAvatar = '',
  senderId = '',
  sentAt = 0,
  relatedMessages = []
}: {
  deliveries: MessageDelivery[]
  agents?: AgentConfig[]
  userName?: string
  userAvatar?: string
  senderId?: string
  sentAt?: number
  relatedMessages?: ChatMessage[]
}): ReactElement {
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  const recipientNames = deliveries.map(deliveryRecipientName).join(', ')
  const summary = tr('Sent private message to {names}', { names: recipientNames })

  return (
    <div className={`bubble-delivery-disclosure ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="bubble-deliveries"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={detailsId}
        title={t(open ? 'Hide private messages' : 'Show private messages')}
      >
        <Lock size={10} />
        <span>{summary}</span>
        <ChevronDown className="bubble-delivery-chevron" size={12} aria-hidden="true" />
      </button>
      {open && (
        <div className="bubble-delivery-details" id={detailsId}>
          {deliveries.map((delivery) => {
            const recipient = agents.find((agent) => agent.id === delivery.recipientId)
            const recipientName = deliveryRecipientName(delivery)
            const replies = repliesForDelivery(delivery, senderId, sentAt, relatedMessages)
            const replyGroups = groupDeliveryReplies(replies)
            return (
              <section className="bubble-delivery-note" key={delivery.id}>
                <div
                  className="bubble-delivery-recipient"
                  aria-label={tr('To {name}', { name: recipientName })}
                >
                  <span>{t('To')}</span>
                  <span className="bubble-delivery-inline-avatar" aria-hidden="true">
                    {recipient
                      ? <AgentAvatar agent={recipient} size={18} />
                      : delivery.recipientId === 'human'
                        ? <UserAvatar src={userAvatar} name={userName || recipientName} size={18} />
                        : <EmptyAvatar size={18} />}
                  </span>
                  <span>{recipientName}</span>
                </div>
                <div className="bubble-delivery-copy">
                  <div className="bubble-delivery-content">
                    <MessageMarkdown text={delivery.content} />
                  </div>
                  {replies.length ? (
                    <div className="bubble-delivery-replies">
                      {replyGroups.map((replyGroup) => {
                        const firstReply = replyGroup[0]
                        return (
                          <div className="bubble-delivery-reply" key={firstReply.id}>
                            <div className="bubble-delivery-reply-author">
                              <CornerDownRight size={11} aria-hidden="true" />
                              {tr('{name} replied', { name: firstReply.senderName })}
                            </div>
                            {replyGroup.map((reply) => (
                              <div className="bubble-delivery-reply-segment" key={reply.id}>
                                {reply.content ? (
                                  <div className="bubble-delivery-reply-content">
                                    <MessageMarkdown text={reply.content} />
                                  </div>
                                ) : null}
                                <MessageAttachments attachments={reply.attachments} />
                                {reply.error ? <span className="bubble-error">{t(reply.error)}</span> : null}
                              </div>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function MessageSourceCard({
  source,
  agents = [],
  fallbackContent = '',
  receiverId = '',
  receivedAt = 0,
  relatedMessages = []
}: {
  source: MessageSource
  agents?: AgentConfig[]
  fallbackContent?: string
  receiverId?: string
  receivedAt?: number
  relatedMessages?: ChatMessage[]
}): ReactElement {
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  const sender = agents.find((agent) => agent.id === source.id)
  const senderName = source.name === 'Dr. Dou' ? t('Dr. Dou') : source.name
  const content = source.content?.trim() ||
    sourceContentFromMessages(source, receiverId, receivedAt, relatedMessages).trim() ||
    fallbackContent.trim()
  return (
    <div className={`bubble-private-source-disclosure ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="bubble-deliveries"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={detailsId}
        title={t(open ? 'Hide private messages' : 'Show private messages')}
      >
        <Lock size={10} />
        <span>{tr('Received privately from {name}', { name: senderName })}</span>
        <ChevronDown className="bubble-delivery-chevron" size={12} aria-hidden="true" />
      </button>
      {open && (
        <div className="bubble-delivery-details bubble-private-source" id={detailsId}>
          <section className="bubble-delivery-note">
            <div
              className="bubble-delivery-recipient"
              aria-label={tr('From {name}', { name: senderName })}
            >
              <span>{t('From')}</span>
              <span className="bubble-delivery-inline-avatar" aria-hidden="true">
                {sender
                  ? <AgentAvatar agent={sender} size={18} />
                  : <EmptyAvatar size={18} group={source.kind === 'group'} />}
              </span>
              <span>{senderName}</span>
            </div>
            <div className="bubble-delivery-copy">
              <div className="bubble-delivery-content">
                <MessageMarkdown text={content || t('Private message details are unavailable.')} />
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

export function MessageGroupRow({
  messages,
  agent,
  agents,
  relatedMessages,
  userName,
  userAvatar,
  showAuthor
}: {
  messages: ChatMessage[]
  agent?: AgentConfig
  agents: AgentConfig[]
  relatedMessages: ChatMessage[]
  userName: string
  userAvatar: string
  showAuthor: boolean
}): ReactElement {
  const first = messages[0]
  const mergePrivateReply = Boolean(
    first.replyGroupId &&
    first.source?.kind === 'bot' &&
    messages.length > 1 &&
    messages.every((message) =>
      message.replyGroupId === first.replyGroupId &&
      message.source?.kind === first.source?.kind &&
      message.source?.id === first.source?.id
    )
  )
  const bubbleGroups = mergePrivateReply ? [messages] : messages.map((message) => [message])
  return (
    <div className="message-row agent-message-row">
      <div className="message-avatar-slot">
        {agent ? <AgentAvatar agent={agent} size={36} /> : <EmptyAvatar size={36} />}
      </div>
      <div className="message-body">
        {(showAuthor || first.source) && (
          <div className="message-author">
            {agent ? agentDisplayName(agent) : first.authorName}
          </div>
        )}
        {bubbleGroups.map((bubbleMessages) => {
          const bubble = bubbleMessages[0]
          const hasError = bubbleMessages.some((message) => Boolean(message.error))
          const hasAttachments = bubbleMessages.some((message) => Boolean(message.attachments?.length))
          const hasText = bubbleMessages.some((message) => Boolean(message.text))
          return (
            <div key={bubble.id} className={`message-bubble agent-bubble ${hasError ? 'has-error' : ''} ${hasAttachments ? 'has-attachments' : ''} ${!hasText && hasAttachments ? 'image-only' : ''}`}>
              {bubble.source ? (
                <MessageSourceCard
                  source={bubble.source}
                  agents={agents}
                  receiverId={bubble.authorId}
                  receivedAt={bubble.createdAt}
                  relatedMessages={relatedMessages}
                  fallbackContent={bubble.source.kind === 'group' ? bubble.text : ''}
                />
              ) : null}
              {bubbleMessages.map((message) => message.source?.kind !== 'group' ? (
                <div className="bubble-reply-segment" key={message.id}>
                  {message.text ? (
                    <div className="bubble-primary-content">
                      <MessageMarkdown text={message.text} />
                    </div>
                  ) : null}
                  <MessageAttachments attachments={message.attachments} />
                  {message.error ? <span className="bubble-error">{t(message.error)}</span> : null}
                  {message.deliveries?.length ? (
                    <MessageDeliveries
                      deliveries={message.deliveries}
                      agents={agents}
                      userName={userName}
                      userAvatar={userAvatar}
                      senderId={message.authorId}
                      sentAt={message.createdAt}
                      relatedMessages={relatedMessages}
                    />
                  ) : null}
                </div>
              ) : null)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** A failure uses one calm, predictable label; the actionable/raw detail stays
 *  one click away rather than filling the thread. */
export function SystemMessage({ message }: { message: ChatMessage }): ReactElement {
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
  if (!summary) return <div className="system-message">{t(message.text)}</div>

  return (
    <div className={`system-message is-error ${open ? 'is-open' : ''}`}>
      <div className="system-line">
        <TriangleAlert size={13} />
        <span>{t('Something went wrong')}</span>
        <button
          className="system-toggle"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          {t(open ? 'Hide' : 'Details')}
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
            {t(copied ? 'Copied' : 'Copy')}
          </button>
        </div>
      )}
    </div>
  )
}

function MessageRow({
  messages,
  agent,
  agents,
  relatedMessages,
  userName,
  userAvatar,
  showAuthor
}: {
  messages: ChatMessage[]
  agent?: AgentConfig
  agents: AgentConfig[]
  relatedMessages: ChatMessage[]
  userName: string
  userAvatar: string
  showAuthor: boolean
}): ReactElement {
  const message = messages[0]
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
    const hasAttachments = Boolean(message.attachments?.length)
    return (
      <div className="message-row user-message-row">
        <div className={`message-bubble user-bubble ${hasAttachments ? 'has-attachments' : ''} ${!message.text && hasAttachments ? 'image-only' : ''}`}>
          {message.text && <span>{message.text}</span>}
          <MessageAttachments attachments={message.attachments} />
        </div>
        <UserAvatar
          src={userAvatar}
          name={userName}
          size={36}
          className="user-chat-avatar"
        />
      </div>
    )
  }
  return (
    <MessageGroupRow
      messages={messages}
      agent={agent}
      agents={agents}
      relatedMessages={relatedMessages}
      userName={userName}
      userAvatar={userAvatar}
      showAuthor={showAuthor}
    />
  )
}

export function visibleConversationMessages(
  conversation: Conversation | undefined,
  messages: ChatMessage[]
): ChatMessage[] {
  if (!conversation || conversation.type !== 'direct') return messages
  const participantIds = new Set(conversation.agentIds)
  return messages.filter((message) =>
    message.kind !== 'handoff' &&
    (message.authorId === 'user' || message.authorId === 'system' || participantIds.has(message.authorId))
  )
}

export function groupConversationMessages(messages: ChatMessage[]): ChatMessage[][] {
  const groups: ChatMessage[][] = []
  for (const message of messages) {
    const previousGroup = groups.at(-1)
    const previous = previousGroup?.at(-1)
    if (
      message.kind === 'message' &&
      message.replyGroupId &&
      previous?.kind === 'message' &&
      previous.replyGroupId === message.replyGroupId &&
      previous.authorId === message.authorId
    ) {
      previousGroup!.push(message)
    } else {
      groups.push([message])
    }
  }
  return groups
}

export function ChatPane({
  userName,
  userAvatar,
  conversation,
  topic,
  messages: recentMessages,
  allMessages,
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
  allMessages: ChatMessage[]
  agents: AgentConfig[]
  members: AgentConfig[]
  activity?: ConversationActivityState
  offline: boolean
  onConnect: () => void
  inspectorOpen: boolean
  onToggleInspector: () => void
  onSend: (text: string, images?: MessageImageInput[]) => Promise<void>
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
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const [attachmentError, setAttachmentError] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [mention, setMention] = useState<MentionQuery | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [sending, setSending] = useState(false)
  const [voiceState, setVoiceState] = useState<VoiceInputState>('idle')
  const [voiceError, setVoiceError] = useState('')
  const [voiceNeedsSettings, setVoiceNeedsSettings] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const voiceAttemptRef = useRef(0)
  const voiceEndTimerRef = useRef<number | null>(null)
  const voiceBaseRef = useRef('')
  const voiceTranscriptRef = useRef('')
  const working = Boolean(activity)
  const conversationName = conversation ? conversationDisplayName(conversation, agents) : ''
  const timelineMessages = visibleConversationMessages(conversation, messages)
  const timelineGroups = groupConversationMessages(timelineMessages)

  useEffect(() => {
    voiceAttemptRef.current += 1
    if (voiceEndTimerRef.current !== null) window.clearTimeout(voiceEndTimerRef.current)
    voiceEndTimerRef.current = null
    recognitionRef.current?.abort()
    recognitionRef.current = null
    voiceTranscriptRef.current = ''
    setVoiceState('idle')
    setVoiceError('')
    setVoiceNeedsSettings(false)
    setDraft('')
    setMention(null)
    setEmojiOpen(false)
  }, [conversation?.id, topic?.id])

  useEffect(() => () => {
    voiceAttemptRef.current += 1
    if (voiceEndTimerRef.current !== null) window.clearTimeout(voiceEndTimerRef.current)
    recognitionRef.current?.abort()
    recognitionRef.current = null
  }, [])

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
      { id: 'all', name: 'all', label: t('Everyone'), agent: undefined as AgentConfig | undefined },
      ...members.map((member) => ({ id: member.id, name: member.name, label: agentDisplayName(member), agent: member }))
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

  const stopVoiceInput = (): void => {
    voiceAttemptRef.current += 1
    const recognition = recognitionRef.current
    if (!recognition) {
      setVoiceState('idle')
      return
    }
    setVoiceState('processing')
    recognition.stop()
    if (voiceEndTimerRef.current !== null) window.clearTimeout(voiceEndTimerRef.current)
    voiceEndTimerRef.current = window.setTimeout(() => {
      if (recognitionRef.current !== recognition) return
      recognition.abort()
      recognitionRef.current = null
      setVoiceState('idle')
    }, 1800)
  }

  const startVoiceInput = async (): Promise<void> => {
    const Recognition = speechRecognitionConstructor()
    if (!Recognition) {
      setVoiceError(t('Voice input is unavailable in this version of Douchat.'))
      setVoiceNeedsSettings(false)
      return
    }

    const attempt = voiceAttemptRef.current + 1
    voiceAttemptRef.current = attempt
    setEmojiOpen(false)
    setMention(null)
    setVoiceError('')
    setVoiceNeedsSettings(false)
    setVoiceState('starting')

    try {
      const access = await window.douchat.requestMicrophoneAccess()
      if (voiceAttemptRef.current !== attempt) return
      if (!navigator.mediaDevices?.getUserMedia) {
        setVoiceError(t('Voice input is unavailable in this version of Douchat.'))
        setVoiceNeedsSettings(false)
        setVoiceState('idle')
        return
      }
      try {
        // The OS status can be stale after the user changes System Settings.
        // A real capture is authoritative and also separates microphone access
        // from the independent browser speech-recognition service.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        stream.getTracks().forEach((track) => track.stop())
      } catch {
        if (voiceAttemptRef.current !== attempt) return
        if (access === 'granted') {
          setVoiceError(t('Microphone permission changed. Restart Douchat and try again.'))
          setVoiceNeedsSettings(false)
        } else {
          setVoiceError(tr('Microphone access is off. Allow {name} in System Settings, then restart the app.', {
            name: window.douchat.microphonePermissionOwner
          }))
          setVoiceNeedsSettings(true)
        }
        setVoiceState('idle')
        return
      }
      if (voiceAttemptRef.current !== attempt) return

      const recognition = new Recognition()
      recognitionRef.current = recognition
      voiceBaseRef.current = draft
      voiceTranscriptRef.current = ''
      recognition.lang = speechRecognitionLanguage(document.documentElement.lang)
      recognition.continuous = true
      recognition.interimResults = true
      recognition.maxAlternatives = 1
      recognition.onstart = () => {
        if (recognitionRef.current === recognition) setVoiceState('listening')
      }
      recognition.onresult = (event) => {
        let transcript = ''
        for (let index = 0; index < event.results.length; index += 1) {
          transcript += event.results[index]?.[0]?.transcript ?? ''
        }
        voiceTranscriptRef.current = transcript.trimStart()
        const separator = voiceBaseRef.current && !/\s$/.test(voiceBaseRef.current) && voiceTranscriptRef.current ? ' ' : ''
        setDraft(`${voiceBaseRef.current}${separator}${voiceTranscriptRef.current}`)
      }
      recognition.onerror = (event) => {
        if (event.error !== 'aborted') {
          // getUserMedia succeeded immediately before recognition started, so
          // these errors come from the recognition service, not microphone TCC.
          setVoiceError(t(speechRecognitionErrorMessage(event.error, true)))
          setVoiceNeedsSettings(false)
        }
      }
      recognition.onend = () => {
        if (voiceEndTimerRef.current !== null) window.clearTimeout(voiceEndTimerRef.current)
        voiceEndTimerRef.current = null
        if (recognitionRef.current !== recognition) return
        recognitionRef.current = null
        setVoiceState('idle')
        textareaRef.current?.focus()
      }
      recognition.start()
    } catch {
      if (voiceAttemptRef.current !== attempt) return
      recognitionRef.current = null
      setVoiceState('idle')
      setVoiceError(t('Voice input could not start. Try again.'))
      setVoiceNeedsSettings(false)
    }
  }

  const toggleVoiceInput = (): void => {
    if (voiceState === 'idle') void startVoiceInput()
    else stopVoiceInput()
  }

  const send = async (): Promise<void> => {
    const content = draft.trim()
    if ((!content && !pendingImages.length) || !conversation || sending || working || voiceState !== 'idle') return
    const sendingImages = pendingImages
    const sendingImageIds = new Set(sendingImages.map((image) => image.id))
    setSending(true)
    try {
      const images: MessageImageInput[] = sendingImages.map(({ name, mimeType, data }) => ({ name, mimeType, data }))
      setDraft('')
      setPendingImages((current) => current.filter((image) => !sendingImageIds.has(image.id)))
      setMention(null)
      setAttachmentError('')
      await onSend(content, images)
    } catch {
      setDraft(content)
      setPendingImages((current) => [
        ...sendingImages.filter((image) => !current.some((candidate) => candidate.id === image.id)),
        ...current
      ])
    } finally {
      setSending(false)
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const imageFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .flatMap((item) => item.getAsFile() ?? [])
    if (!imageFiles.length) return
    event.preventDefault()
    setAttachmentError('')
    if (imageFiles.some((file) => !PASTED_IMAGE_TYPES.has(file.type as MessageAttachment['mimeType']))) {
      setAttachmentError(t('Only PNG, JPEG, WebP, and GIF images are supported.'))
      return
    }
    if (imageFiles.some((file) => !file.size || file.size > MAX_PASTED_IMAGE_BYTES)) {
      setAttachmentError(t('Each image must be 8 MB or smaller.'))
      return
    }
    if (pendingImages.length + imageFiles.length > MAX_PASTED_IMAGES) {
      setAttachmentError(t('You can paste up to 4 images at a time.'))
      return
    }
    const total = pendingImages.reduce((sum, image) => sum + image.size, 0) + imageFiles.reduce((sum, file) => sum + file.size, 0)
    if (total > MAX_PASTED_IMAGE_TOTAL_BYTES) {
      setAttachmentError(t('Images must total 20 MB or less.'))
      return
    }
    void Promise.all(imageFiles.map(readPastedImage)).then((images) => {
      setPendingImages((current) => [...current, ...images])
    }).catch(() => setAttachmentError(t('Pasted image could not be read.')))
  }

  const removePendingImage = (id: string): void => {
    setPendingImages((current) => current.filter((image) => {
      if (image.id !== id) return true
      return false
    }))
    setAttachmentError('')
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
              {conversationName || 'Douchat'}
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
          {timelineGroups.map((messageGroup, index) => {
            const message = messageGroup[0]
            const previous = timelineGroups[index - 1]?.at(-1)
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
                  messages={messageGroup}
                  agent={agent}
                  agents={agents}
                  relatedMessages={allMessages}
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
                <span className="typing-label">{activity.agentIds.map((id) => agents.find((agent) => agent.id === id)).filter((agent): agent is AgentConfig => Boolean(agent)).map(agentDisplayName).join('、') || activity.label}</span>
                <span className="typing-bubble typing-activity"><span>{activityLabel()}</span><span className="reply-status-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></span>
              </div>
            </div>
          )}
          {activity?.takeover && (
            <div className="system-message">
              {tr('{name} is unavailable — {replacement} is standing in.', {
                name: activity.takeover.unavailableName,
                replacement: activity.takeover.replacementName
              })}
            </div>
          )}
        </div>
      </div>

      <div className="composer-wrap">
        {offline && (
          <div className="offline-banner">
            <span>{t('Choose a local agent or connect a model endpoint to start chatting.')}</span>
            <button onClick={onConnect}>{t('Choose agent')}</button>
          </div>
        )}
        {mention && mentionOptions.length > 0 && (
          <div className="mention-menu" role="listbox" aria-label={t('Mention a member')}>
            <div className="mention-title">{t('Mention a member')}</div>
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
        <div className={`composer ${draft.trim() || pendingImages.length ? 'has-content' : ''}`}>
          {pendingImages.length > 0 && (
            <div className="composer-images" aria-label={t('Images ready to send')}>
              {pendingImages.map((image) => (
                <div className="composer-image" key={image.id}>
                  <img src={image.previewUrl} alt={image.name || t('Pasted image')} />
                  <button type="button" onClick={() => removePendingImage(image.id)} aria-label={t('Remove image')} title={t('Remove image')}>
                    <X size={13} strokeWidth={2.2} />
                  </button>
                </div>
              ))}
            </div>
          )}
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
            onPaste={handlePaste}
            placeholder={
              conversation
                ? tr(conversation.type === 'group' ? 'Message {name} · @ to mention' : 'Message {name}', { name: conversationName })
                : t('Create an agent to start chatting')
            }
            rows={2}
            disabled={!conversation}
            readOnly={voiceState !== 'idle'}
          />
          {attachmentError && <div className="composer-attachment-error" role="alert">{attachmentError}</div>}
          {voiceError && (
            <div className="composer-voice-error" role="alert">
              <span>{voiceError}</span>
              {voiceNeedsSettings && (
                <button type="button" onClick={() => void window.douchat.openMicrophoneSettings()}>
                  {t('Open System Settings')}
                </button>
              )}
            </div>
          )}
          <div className="composer-bottom">
            <div className="composer-tools">
              <button type="button" className="emoji-toggle" disabled={voiceState !== 'idle'} onClick={() => setEmojiOpen((open) => !open)} aria-label={t('Emoji')} aria-expanded={emojiOpen}><Smile size={18} strokeWidth={2.1} /></button>
              <button
                type="button"
                className={`voice-toggle is-${voiceState}`}
                onClick={toggleVoiceInput}
                aria-label={t(voiceState === 'idle' ? 'Start voice input' : 'Stop voice input')}
                aria-pressed={voiceState !== 'idle'}
                title={t(voiceState === 'idle' ? 'Voice input' : 'Stop voice input')}
              >
                {voiceState === 'starting' || voiceState === 'processing'
                  ? <LoaderCircle className="voice-spinner" size={17} />
                  : <Mic size={18} strokeWidth={2.1} />}
              </button>
              {voiceState !== 'idle' && (
                <span className="voice-status" role="status">
                  {t(voiceState === 'listening' ? 'Listening…' : voiceState === 'starting' ? 'Starting microphone…' : 'Finishing voice input…')}
                </span>
              )}
              {conversation?.type === 'group' && <button className="emoji-toggle" aria-label={t('Mention a member')} onClick={() => {
                const next = `${draft}${draft && !draft.endsWith(' ') ? ' ' : ''}@`
                setDraft(next); trackMention(next, next.length); textareaRef.current?.focus()
              }} disabled={voiceState !== 'idle'}><AtSign size={18} strokeWidth={2.1} /></button>}
            </div>
            {emojiOpen && <div className="emoji-picker" aria-label={t('Choose an emoji')}>{['😀', '😂', '🥰', '👍', '🎉', '❤️', '🙏', '🤔'].map((emoji) => <button key={emoji} onClick={() => { setDraft((text) => text + emoji); setEmojiOpen(false); textareaRef.current?.focus() }}>{emoji}</button>)}</div>}
          {working ? (
            <button className="stop-button" onClick={onStop} aria-label={t('Stop the current reply')} title={t('Stop')}>
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              className="send-button"
              onClick={() => void send()}
              disabled={sending || voiceState !== 'idle' || (!draft.trim() && !pendingImages.length)}
              aria-label={t('Send message')}
            >
              {t('Send')}
            </button>
          )}
          </div>
        </div>
      </div>
    </main>
  )
}
