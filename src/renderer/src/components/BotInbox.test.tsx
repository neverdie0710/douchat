// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { AppSnapshot } from '../../../shared/types'
vi.mock('../preferences', () => ({
  t: (value: string) => value,
  tr: (value: string, values: Record<string, string>) => Object.entries(values).reduce((text, [key, replacement]) => text.replaceAll(`{${key}}`, replacement), value)
}))
vi.mock('./common', () => ({
  UserAvatar: ({ name, src }: { name: string; src: string }) => <span data-avatar={name} data-src={src} />,
  ConversationAvatar: () => <span />,
  SidebarResizer: () => null,
  conversationDisplayName: (conversation: { name: string }) => conversation.name,
  formatTime: () => '20:48',
  relativeTime: () => 'Today'
}))
import { BotInbox } from './BotInbox'

it('shows human DMs alongside agent chats, ordered by latest message, and opens the selected room', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const onSelect = vi.fn()
  const snapshot = { agents: [], userName: 'Alice', messages: [{ id: 'm', conversationId: 'dm', topicId: 'main', authorId: 'user', authorName: 'Alice', text: 'Hello Bob', kind: 'message', createdAt: Date.parse('2026-09-21T12:48:00Z') }], conversations: [
    { id: 'dm', name: 'Bob', type: 'direct', person: { id: 'bob', name: 'Bob', email: 'bob@example.com', image: 'latest-avatar.png' }, remoteRoomId: 'remote-dm', agentIds: [], createdAt: 2, unread: 1 },
    { id: 'agent', name: 'Agent', type: 'direct', agentIds: [], createdAt: 1, unread: 0 }
  ] } as unknown as AppSnapshot
  try {
    await act(async () => root.render(<BotInbox snapshot={snapshot} activeId="dm" workingIds={new Set()} onSelect={onSelect}
      onCreateBot={vi.fn()} onCreateGroup={vi.fn()} onEdit={vi.fn()} onTogglePin={vi.fn()} onDelete={vi.fn()} onUpdate={vi.fn()} onOpenWindow={vi.fn()}
 />))
    const rows = host.querySelectorAll<HTMLButtonElement>('.conversation-item')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('Bob')
    expect(rows[0].querySelector('.conversation-preview')?.textContent).toBe('Hello Bob')
    expect(rows[0].querySelector('[data-avatar="Bob"]')?.getAttribute('data-src')).toBe('latest-avatar.png')
    expect(rows[0].classList.contains('active')).toBe(true)
    expect(rows[0].querySelector('[data-avatar="Bob"]')).not.toBeNull()
    await act(async () => rows[0].click())
    expect(onSelect).toHaveBeenCalledWith('dm')
  } finally { await act(async () => root.unmount()); host.remove() }
})
