import { Bot, UserRound, Users } from 'lucide-react'
import { useRef } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { AgentConfig, ChatMessage, Conversation } from '../../../shared/types'
import { agentIcons } from '../agentIcons'
import { t } from '../preferences'
import { SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, setSidebarWidth, useSidebarWidth } from '../sidebarWidth'

export const colors = ['#14B8A6', '#FF5DA8', '#7C6CF2', '#F59E42', '#3B82F6', '#84A737']

export function isDrDou(agent: AgentConfig): boolean {
  return agent.id.startsWith('dr-dou-')
}

/** Built-in identities are stored under a stable canonical name, while their
 * presentation follows the interface language. A user-supplied rename wins. */
export function agentDisplayName(agent: AgentConfig): string {
  return isDrDou(agent) && agent.name === 'Dr. Dou' ? t('Dr. Dou') : agent.name
}

export function agentDisplayRole(agent: AgentConfig): string {
  return isDrDou(agent) && agent.role === '豆博士' ? t('Douchat assistant') : agent.role
}

export function conversationDisplayName(conversation: Conversation, agents: AgentConfig[]): string {
  if (conversation.type !== 'direct') return conversation.name
  const agent = agents.find((item) => item.id === conversation.agentIds[0])
  return agent ? agentDisplayName(agent) : conversation.name
}

export function AgentAvatar({ agent, size = 36 }: { agent: AgentConfig; size?: number }): ReactElement {
  const logo = agent.localAgentId ? agentIcons[agent.localAgentId] : undefined
  const builtInPicture = isDrDou(agent) ? agentIcons['dr-dou-human'] : undefined
  const picture = agent.avatar || logo || builtInPicture
  const displayName = agentDisplayName(agent)
  return (
    <span
      className={`agent-avatar${logo && !agent.avatar ? ' local-agent-avatar' : ''}${builtInPicture && !agent.avatar ? ' built-in-agent-avatar' : ''}${agent.avatar ? ' custom-agent-avatar' : ''}`}
      data-agent={agent.localAgentId}
      style={{ '--agent-color': agent.color, '--avatar-size': `${size}px` } as CSSProperties}
      aria-label={displayName}
      title={displayName}
    >
      {picture ? <img src={picture} alt="" /> : <span className="avatar-eyes">
        <i />
        <i />
      </span>}
    </span>
  )
}

/** The person in the conversation, wearing their own picture when they set
 * one. The glyph fallback keeps every unconfigured install looking deliberate. */
export function UserAvatar({
  src,
  name,
  size = 36,
  className = ''
}: {
  src: string
  name: string
  size?: number
  className?: string
}): ReactElement {
  return (
    <span
      className={`user-avatar ${src ? 'has-photo' : ''} ${className}`.trim()}
      style={{ '--avatar-size': `${size}px` } as CSSProperties}
      title={name}
      aria-label={name}
    >
      {src ? <img src={src} alt="" /> : <UserRound size={Math.round(size * 0.58)} strokeWidth={1.8} />}
    </span>
  )
}

export function EmptyAvatar({ size = 36, group = false }: { size?: number; group?: boolean }): ReactElement {
  return (
    <span className="agent-avatar empty-avatar" style={{ '--avatar-size': `${size}px` } as CSSProperties}>
      {group ? <Users size={Math.round(size * 0.46)} strokeWidth={1.8} /> : <Bot size={Math.round(size * 0.48)} strokeWidth={1.8} />}
    </span>
  )
}

/** A group wears a mosaic of its members, the way a messenger shows a room. */
export function ConversationAvatar({
  conversation,
  agents,
  size = 38
}: {
  conversation: Conversation
  agents: AgentConfig[]
  size?: number
}): ReactElement {
  const members = conversation.agentIds
    .map((id) => agents.find((agent) => agent.id === id))
    .filter((agent): agent is AgentConfig => Boolean(agent))
  if (conversation.type === 'direct') {
    return members[0] ? <AgentAvatar agent={members[0]} size={size} /> : <EmptyAvatar size={size} />
  }
  if (!members.length) return <EmptyAvatar size={size} group />
  const tiles = members.slice(0, 9)
  const columns = tiles.length === 1 ? 1 : tiles.length <= 4 ? 2 : 3
  const tileSize = (size - 4 - (columns - 1) * 1.5) / columns
  return (
    <span
      className={`agent-avatar group-mosaic ${tiles.length > 4 ? 'dense' : ''}`}
      style={{ '--avatar-size': `${size}px` } as CSSProperties}
      data-count={tiles.length}
      title={conversation.name}
    >
      {tiles.map((member) => (
        <AgentAvatar key={member.id} agent={member} size={tileSize} />
      ))}
    </span>
  )
}

export function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(document.documentElement.lang || undefined, { hour: 'numeric', minute: '2-digit' }).format(timestamp)
}

export function relativeTime(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000))
  if (minutes < 1) return t('now')
  const relative = new Intl.RelativeTimeFormat(document.documentElement.lang || undefined, { numeric: 'always', style: 'narrow' })
  if (minutes < 60) return relative.format(-minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return relative.format(-hours, 'hour')
  const days = Math.floor(hours / 24)
  if (days < 7) return relative.format(-days, 'day')
  return new Intl.DateTimeFormat(document.documentElement.lang || undefined, { month: 'short', day: 'numeric' }).format(at)
}

export function dayLabel(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return t('Today')
  if (date.toDateString() === yesterday.toDateString()) return t('Yesterday')
  return new Intl.DateTimeFormat(document.documentElement.lang || undefined, { month: 'short', day: 'numeric' }).format(date)
}

export function isDifferentDay(current: ChatMessage, previous?: ChatMessage): boolean {
  return !previous || new Date(current.createdAt).toDateString() !== new Date(previous.createdAt).toDateString()
}

export function conversationMembers(conversation: Conversation | undefined, agents: AgentConfig[]): AgentConfig[] {
  if (!conversation) return []
  return conversation.agentIds
    .map((id) => agents.find((agent) => agent.id === id))
    .filter((agent): agent is AgentConfig => Boolean(agent))
}

/**
 * The seam between a sidebar and what follows it. Every sidebar uses the same
 * handle against the same stored width, so the rail can be dragged from any
 * one of them and the others already agree.
 */
export function SidebarResizer(): ReactElement {
  const width = useSidebarWidth()
  const dragging = useRef(false)
  return (
    <div
      className="sidebar-resizer no-drag"
      role="separator"
      aria-label={t('Resize sidebar')}
      aria-orientation="vertical"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        dragging.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
        event.preventDefault()
      }}
      onPointerMove={(event) => {
        if (dragging.current) setSidebarWidth(event.clientX - event.currentTarget.parentElement!.getBoundingClientRect().left)
      }}
      onPointerUp={(event) => {
        dragging.current = false
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onLostPointerCapture={() => {
        dragging.current = false
      }}
      onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          setSidebarWidth(width + (event.key === 'ArrowLeft' ? -10 : 10))
        }
      }}
    />
  )
}
