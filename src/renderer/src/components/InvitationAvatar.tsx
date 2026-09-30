import { UserRound } from 'lucide-react'
import type { AgentConfig, Conversation } from '../../../shared/types'
import { agentIcons } from '../agentIcons'
import { GeneratedAgentAvatar } from '../generatedAvatar'
import { conversationMembers, isDrDou } from './common'

/** SVG counterpart of the chat avatar, so the exported poster is self-contained. */
export function InvitationAvatar({ conversation, agents, userName, userAvatar }: {
  conversation: Conversation; agents: AgentConfig[]; userName: string; userAvatar: string
}) {
  const picture = (src: string) => <image href={src} width="64" height="64" preserveAspectRatio="xMidYMid slice" />
  const agentFace = (agent: AgentConfig) => {
    const src = agent.avatar || (!agent.avatarEmoji ? (agent.localAgentId ? agentIcons[agent.localAgentId] : undefined) || (isDrDou(agent) ? agentIcons['dr-dou-human'] : undefined) : undefined)
    return <>
      <rect width="64" height="64" rx="6" fill={src || agent.avatarEmoji || agent.avatarSeed ? '#f1f3f7' : agent.color || '#afb1b4'} />
      {src ? picture(src) : agent.avatarEmoji ? <text x="32" y="47" fontSize="44" textAnchor="middle">{agent.avatarEmoji}</text>
        : agent.avatarSeed ? <GeneratedAgentAvatar seed={agent.avatarSeed} />
        : <g fill="#fff"><rect x="22" y="25" width="5" height="13" rx="2.5" /><rect x="37" y="25" width="5" height="13" rx="2.5" /></g>}
    </>
  }
  if (conversation.avatar || conversation.avatarEmoji) return <svg x="252" y="250" width="216" height="216" viewBox="0 0 64 64" data-invitation-avatar="custom" style={{ borderRadius: 6, overflow: 'hidden' }}>
    {conversation.avatar ? picture(conversation.avatar) : <text x="32" y="49" fontSize="48" textAnchor="middle">{conversation.avatarEmoji}</text>}
  </svg>
  const people = conversation.socialRoom?.members ?? [{ id: 'user', name: userName, image: userAvatar }]
  const members = conversationMembers(conversation, agents).slice(0, Math.max(0, 9 - Math.min(people.length, 9)))
  const tiles = [...members.map(agentFace), ...people.slice(0, 9 - members.length).map(person => <>
    <rect width="64" height="64" rx="6" fill="#e7edf7" />
    {person.image ? picture(person.image) : <UserRound x={13} y={13} width={38} height={38} color="#5476ab" />}
  </>)]
  const columns = tiles.length === 1 ? 1 : tiles.length <= 4 ? 2 : 3
  const gap = 4, size = (216 - gap * (columns - 1)) / columns
  const rows = Math.ceil(tiles.length / columns)
  const height = rows * size + Math.max(0, rows - 1) * gap
  const top = (216 - height) / 2
  return <svg x="240" y="238" width="240" height="240" viewBox="-12 -12 240 240" data-invitation-avatar="mosaic">
    <rect x="-10" y={top - 10} width="236" height={height + 20} rx="18" fill="#ffffff" />
    {tiles.map((tile, index) => {
      const row = Math.floor(index / columns)
      const rowCount = Math.min(columns, tiles.length - row * columns)
      const rowOffset = (216 - (rowCount * size + (rowCount - 1) * gap)) / 2
      return <svg key={index} x={rowOffset + (index % columns) * (size + gap)} y={top + row * (size + gap)} width={size} height={size} viewBox="0 0 64 64" style={{ borderRadius: 6, overflow: 'hidden' }}>{tile}</svg>
    })}
  </svg>
}

export async function invitationSvgSource(svg: SVGSVGElement): Promise<string> {
  const copy = svg.cloneNode(true) as SVGSVGElement
  // SVG images loaded into a canvas cannot fetch nested external images.
  // Inline the same avatar assets shown in the preview before rasterizing.
  await Promise.all(Array.from(copy.querySelectorAll('image')).map(async image => {
    const href = image.getAttribute('href')
    if (!href || href.startsWith('data:')) return
    const url = new URL(href, svg.ownerDocument.baseURI)
    if (url.protocol === 'https:') {
      // Remote photos use img-src (connect-src intentionally excludes HTTPS).
      const photo = new Image(); photo.crossOrigin = 'anonymous'; photo.referrerPolicy = 'no-referrer'; photo.src = url.href
      await photo.decode()
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Could not export group avatar')
      const side = Math.min(photo.naturalWidth, photo.naturalHeight)
      context.drawImage(photo, (photo.naturalWidth - side) / 2, (photo.naturalHeight - side) / 2, side, side, 0, 0, 256, 256)
      image.setAttribute('href', canvas.toDataURL('image/png'))
      return
    }
    const response = await fetch(url.href)
    if (!response.ok) throw new Error('Could not load group avatar')
    const blob = await response.blob()
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('Could not read group avatar'))
      reader.readAsDataURL(blob)
    })
    image.setAttribute('href', data)
  }))
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`
}
