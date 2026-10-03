import { Bot, UserRound, Users } from 'lucide-react'
import { useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { AgentConfig, ChatMessage, Conversation } from '../../../shared/types'
import { agentIcons } from '../agentIcons'
import { localAgentsReady, remoteAdapter, remoteHost } from './RemoteMark'
import { GeneratedAgentAvatar } from '../generatedAvatar'
import { t, tr } from '../preferences'
import { SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, setSidebarWidth, useSidebarWidth } from '../sidebarWidth'

export const colors = ['#14B8A6', '#FF5DA8', '#7C6CF2', '#F59E42', '#3B82F6', '#84A737']

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

export function localAgentDisplayName(localAgentId: string): string {
  return localAgentNames[localAgentId] ?? localAgentId
}

export function agentSourceLabel(agent: AgentConfig): string {
  return agent.localAgentId
    ? remoteHost(agent.localAgentId)
      ? `${t('Remote agent')} · ${remoteHost(agent.localAgentId)} · ${agent.localAgentName || localAgentDisplayName(agent.localAgentId)}`
      : `${t('Agent')} · ${agent.localAgentName || localAgentDisplayName(agent.localAgentId)}`
    : agent.provider.startsWith('custom:') ? t('Custom model') : t('Douchat Cloud')
}

export function isDrDou(agent: AgentConfig): boolean {
  return agent.systemRole === 'admin' || agent.id.startsWith('dr-dou-')
}

/** Built-in identities are stored under a stable canonical name, while their
 * presentation follows the interface language. A user-supplied rename wins. */
export function agentDisplayName(agent: AgentConfig): string {
  return isDrDou(agent) && agent.name === 'Dr. Dou' ? t('Dr. Dou') : agent.name
}

export function agentDisplayRole(agent: AgentConfig): string {
  if (agent.systemRole === 'admin') return t('System administrator')
  return isDrDou(agent) && agent.role === '豆博士' ? t('Douchat assistant') : agent.role
}

export function conversationDisplayName(conversation: Conversation, agents: AgentConfig[], compact = false): string {
  if (conversation.type !== 'direct') {
    if (!compact) return conversation.name
    const shorten = (text: string, limit: number): string => {
      const characters = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(part => part.segment)
      return characters.length > limit ? characters.slice(0, limit).join('') + '…' : text
    }
    const members = conversationMembers(conversation, agents)
    const names = members.map(member => member.name)
    const humanNames = conversation.socialRoom?.members.filter(member => member.id !== conversation.ownerId).map(member => member.name) ?? []
    // Older member pickers saved the generated roster as an explicit name.
    // Recognize that presentation without rewriting the stored group name.
    const nameParts = conversation.name.split(/[,、]/u).map(name => name.trim()).filter(Boolean)
    const sameNames = (expected: string[]) => nameParts.length === expected.length && [...nameParts].sort().every((name, index) => name === [...expected].sort()[index])
    const rosterName = conversation.autoNamed || sameNames(names) || sameNames([...names, ...humanNames])
    const count = members.length + (conversation.socialRoom?.members.length ?? 1)
    if (rosterName && nameParts.length >= 2 && (nameParts.length > 3 || shorten(conversation.name, 32) !== conversation.name)) {
      const [first, second] = nameParts.slice(0, 2).map(name => {
        const member = members.find(member => member.name === name)
        return shorten(member ? agentDisplayName(member) : name, 12)
      })
      return tr('{first}, {second} and others ({count} members)', { first, second, count })
    }
    const shortName = shorten(conversation.name, 32)
    return shortName === conversation.name ? conversation.name : `${shortName} (${count})`
  }
  const agent = agents.find((item) => item.id === conversation.agentIds[0])
  return agent ? agentDisplayName(agent) : conversation.name
}

export function AgentAvatar({ agent, size = 36 }: { agent: AgentConfig; size?: number }): ReactElement {
  // Remote agents have custom ids; show the icon of the agent they run, as the picker does.
  const logo = agent.localAgentId ? agentIcons[agent.localAgentId] ?? agentIcons[remoteAdapter(agent.localAgentId) ?? ''] : undefined
  const builtInPicture = isDrDou(agent) ? agentIcons['dr-dou-human'] : undefined
  const emoji = agent.avatarEmoji
  const picture = agent.avatar || (!emoji ? logo || builtInPicture : undefined)
  // Custom and remote agents learn their icon from the first local agent scan:
  // show a quiet placeholder until then, and a stable generated face if none exists.
  const loading = !picture && !emoji && Boolean(agent.localAgentId) && !localAgentsReady()
  const seed = agent.avatarSeed || (agent.localAgentId ? agent.id : undefined)
  const generated = !picture && !emoji && !loading && Boolean(seed)
  const displayName = agentDisplayName(agent)
  return (
    <span
      className={`agent-avatar${logo && !agent.avatar && !emoji ? ' local-agent-avatar' : ''}${builtInPicture && !agent.avatar && !emoji ? ' built-in-agent-avatar' : ''}${agent.avatar ? ' custom-agent-avatar' : ''}${emoji ? ' emoji-agent-avatar' : ''}${generated ? ' generated-agent-avatar' : ''}${loading ? ' loading-agent-avatar' : ''}`}
      data-agent={agent.localAgentId}
      style={{ '--agent-color': agent.color, '--avatar-size': `${size}px` } as CSSProperties}
      aria-label={displayName}
      title={displayName}
    >
      {picture ? <img src={picture} alt="" /> : emoji ? <span className="avatar-emoji" aria-hidden="true">{emoji}</span> : loading ? null : generated ? <GeneratedAgentAvatar seed={seed!} /> : <span className="avatar-eyes">
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
  const [loadedSrc, setLoadedSrc] = useState('')
  const [failedSrc, setFailedSrc] = useState('')
  const canLoadPhoto = Boolean(src) && failedSrc !== src
  const hasPhoto = canLoadPhoto && loadedSrc === src

  return (
    <span
      className={`user-avatar ${hasPhoto ? 'has-photo' : ''} ${className}`.trim()}
      style={{ '--avatar-size': `${size}px` } as CSSProperties}
      title={name}
      aria-label={name}
    >
      {canLoadPhoto && (
        <img
          className={hasPhoto ? 'is-loaded' : ''}
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onLoad={() => {
            setFailedSrc('')
            setLoadedSrc(src)
          }}
          onError={() => {
            setFailedSrc(src)
            setLoadedSrc((loaded) => loaded === src ? '' : loaded)
          }}
        />
      )}
      {!hasPhoto && <UserRound size={Math.round(size * 0.58)} strokeWidth={1.8} />}
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
  userName,
  userAvatar,
  size = 38
}: {
  conversation: Conversation
  agents: AgentConfig[]
  userName: string
  userAvatar: string
  size?: number
}): ReactElement {
  if (conversation.person) return <UserAvatar src={conversation.person.image || ''} name={conversation.person.name} size={size} />
  const members = conversationMembers(conversation, agents)
  if (conversation.type === 'direct') {
    return members[0] ? <AgentAvatar agent={members[0]} size={size} /> : <EmptyAvatar size={size} />
  }
  if (conversation.avatar || conversation.avatarEmoji) {
    return <AgentAvatar agent={{ id: conversation.id, name: conversation.name,
      avatar: conversation.avatar, avatarEmoji: conversation.avatarEmoji,
      color: '#6b8afd', role: '', instructions: '', provider: '', model: '', createdAt: 0 }} size={size} />
  }
  // The person is a member of every group too. Reserve the last mosaic tile
  // for them so they stay visible even when a room has many agents.
  const people = conversation.socialRoom?.members ?? [{ id: 'user', name: userName, image: userAvatar }]
  const visibleAgents = members.slice(0, Math.max(0, 9 - Math.min(people.length, 9)))
  const visiblePeople = people.slice(0, 9 - visibleAgents.length)
  const tileCount = visibleAgents.length + visiblePeople.length
  const columns = tileCount === 1 ? 1 : tileCount <= 4 ? 2 : 3
  const tileSize = (size - 4 - (columns - 1) * 1.5) / columns
  return (
    <span
      className={`agent-avatar group-mosaic ${tileCount > 4 ? 'dense' : ''}`}
      style={{ '--avatar-size': `${size}px` } as CSSProperties}
      data-count={tileCount}
      title={conversation.name}
    >
      {visibleAgents.map((member) => (
        <AgentAvatar key={member.id} agent={member} size={tileSize} />
      ))}
      {visiblePeople.map((person) => <UserAvatar key={person.id} src={person.image || ''} name={person.name || t('You')} size={tileSize} />)}
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
  if (conversation.socialRoom) return conversation.socialRoom.agents.map((remote) => {
    const local = remote.ownerId === conversation.ownerId ? agents.find((agent) => agent.id === remote.localId) : undefined
    return { role: '', instructions: '', color: '#6b8afd', provider: '', model: '', createdAt: 0,
      avatar: remote.avatar, avatarEmoji: remote.avatarEmoji, avatarSeed: remote.avatarSeed,
      localAgentId: remote.localAgentId, systemRole: remote.systemRole,
      ...(remote.color ? { color: remote.color } : {}),
      ...local, id: remote.id, ownerId: remote.ownerId, name: remote.name }
  })
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

/** Only offer callable agents; execution permissions are checked again when sending. */
export function mentionableAgents(conversation: Conversation | undefined, members: AgentConfig[]): AgentConfig[] {
  if (!conversation?.socialRoom) return members
  const memberIds = new Set(conversation.socialRoom.agents
    .filter((agent) => agent.ownerId === conversation.ownerId || agent.interactionHumans === 'allow' || agent.interactionHumans === 'ask')
    .map((agent) => agent.id))
  return members.filter((agent) => memberIds.has(agent.id))
}
