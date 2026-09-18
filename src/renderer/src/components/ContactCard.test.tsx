// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentConfig, AppSnapshot, Conversation } from '../../../shared/types'

vi.mock('../preferences', () => ({
  t: (text: string) => text
}))

vi.mock('./common', () => ({
  AgentAvatar: ({ agent }: { agent: AgentConfig }) => <span data-agent-avatar={agent.id} />,
  ConversationAvatar: ({ conversation }: { conversation: Conversation }) => (
    <span data-conversation-avatar={conversation.id} />
  ),
  agentDisplayName: (agent: AgentConfig) => agent.name
}))

import { ContactCard } from './ContactCard'

const agents: AgentConfig[] = [
  { id: 'alpha', name: 'Alpha', role: '', instructions: '', color: '#14B8A6', provider: '', model: '', createdAt: 1 },
  { id: 'beta', name: 'Beta', role: '', instructions: '', color: '#7C6CF2', provider: '', model: '', createdAt: 2 }
]

const group: Conversation = {
  id: 'group-team',
  type: 'group',
  name: 'Team room',
  description: 'A busy group description that should not compete with the open action.',
  agentIds: ['alpha', 'beta'],
  leadAgentId: 'alpha',
  topics: [],
  activeTopicId: '',
  unread: 0,
  readAt: 0,
  createdAt: 1,
  updatedAt: 1
}

const snapshot = { agents, conversations: [group] } as AppSnapshot

describe('group contact profile', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('keeps the group page focused on entering the chat', async () => {
    const onMessage = vi.fn()
    await act(async () => root.render(
      <ContactCard
        snapshot={snapshot}
        selection={{ kind: 'group', id: group.id }}
        onMessage={onMessage}
        onEditBot={vi.fn()}
        onDeleteBot={vi.fn()}
        onTogglePin={vi.fn()}
      />
    ))

    expect(container.querySelector('[data-conversation-avatar="group-team"]')).not.toBeNull()
    expect(container.querySelector('.group-profile-main h1')?.textContent).toBe('Team room')
    expect(container.querySelector('.contact-members')).toBeNull()
    expect(container.textContent).not.toContain(group.description)
    expect(container.querySelector('.group-profile-toolbar')).toBeNull()
    expect(container.querySelector('.group-profile-footer')).toBeNull()

    const open = container.querySelector<HTMLButtonElement>('.group-profile-primary')!
    await act(async () => open.click())

    expect(onMessage).toHaveBeenCalledWith(group.id)
  })
})
