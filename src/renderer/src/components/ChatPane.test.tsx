// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentConfig, ChatMessage, Conversation } from '../../../shared/types'

vi.mock('../preferences', () => ({
  t: (text: string) => text,
  tr: (text: string, values: Record<string, string | number>) => Object.entries(values).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
    text
  )
}))

vi.mock('./MessageMarkdown', () => ({
  MessageMarkdown: ({ text }: { text: string }) => <div data-testid="private-message-content">{text}</div>
}))

vi.mock('./common', () => ({
  AgentAvatar: ({ agent }: { agent: { name: string } }) => <span data-testid="agent-avatar" data-agent-name={agent.name} />,
  EmptyAvatar: () => <span data-testid="empty-avatar" />,
  UserAvatar: ({ name }: { name: string }) => <span data-testid="user-avatar" data-user-name={name} />,
  agentDisplayName: (agent: { name: string }) => agent.name,
  conversationDisplayName: (conversation: { name: string }) => conversation.name,
  dayLabel: () => '',
  formatTime: () => '',
  isDifferentDay: () => false
}))

import {
  groupConversationMessages,
  groupDeliveryReplies,
  MessageDeliveries,
  MessageGroupRow,
  MessageSourceCard,
  visibleConversationMessages
} from './ChatPane'

const deliveries = [
  {
    id: 'private-1',
    recipientId: 'agent-1',
    recipientName: '拽姐',
    content: '先确认她有没有空。',
    replies: [
      { id: 'reply-1', senderId: 'agent-1', senderName: '拽姐', content: '我有空，七点见。', createdAt: 1, replyGroupId: 'reply-group-1' },
      { id: 'reply-2', senderId: 'agent-1', senderName: '拽姐', content: '规则先说好。', createdAt: 1, replyGroupId: 'reply-group-1' }
    ]
  },
  { id: 'private-2', recipientId: 'agent-2', recipientName: '小微', content: '准备一副牌。' }
]

const agents: AgentConfig[] = [
  { id: 'agent-1', name: '拽姐', role: '', instructions: '', color: '#ff5da8', provider: '', model: '', createdAt: 0 },
  { id: 'agent-2', name: '小微', role: '', instructions: '', color: '#7c6cf2', provider: '', model: '', createdAt: 0 }
]

const outbound: ChatMessage = {
  id: 'outbound-1',
  conversationId: 'direct-sender',
  topicId: 'topic-1',
  authorId: 'sender-1',
  authorName: '豆博士',
  text: '我发出了邀请。',
  kind: 'message',
  createdAt: 10,
  deliveries: [{ id: 'delivery-1', recipientId: 'agent-1', recipientName: '拽姐', content: '今晚七点半，老地方见。' }]
}

const incomingReply: ChatMessage = {
  id: 'incoming-1',
  conversationId: 'direct-agent-1',
  topicId: 'topic-2',
  authorId: 'agent-1',
  authorName: '拽姐',
  text: '好，我会准时到。',
  kind: 'message',
  createdAt: 20,
  source: { kind: 'bot', id: 'sender-1', name: '豆博士' }
}

const directConversation: Conversation = {
  id: 'direct-agent-1',
  type: 'direct',
  name: 'agent-1',
  agentIds: ['agent-1'],
  topics: [],
  activeTopicId: 'topic-2',
  unread: 0,
  readAt: 0,
  createdAt: 0,
  updatedAt: 0
}

describe('private delivery disclosure', () => {
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

  it('keeps private content sealed until the delivery summary is opened', async () => {
    await act(async () => root.render(<MessageDeliveries deliveries={deliveries} agents={agents} />))

    const toggle = container.querySelector<HTMLButtonElement>('.bubble-deliveries')
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(toggle?.textContent).toContain('Sent private message to 拽姐, 小微')
    expect(container.textContent).not.toContain('先确认她有没有空。')
    expect(container.textContent).not.toContain('我有空，七点见。')

    await act(async () => toggle?.click())

    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('To拽姐')
    expect(container.textContent).not.toContain('Private message to')
    expect(container.textContent).toContain('拽姐')
    expect(container.textContent).toContain('先确认她有没有空。')
    expect(container.textContent).toContain('小微')
    expect(container.textContent).toContain('准备一副牌。')
    expect(container.textContent).toContain('拽姐 replied')
    expect(container.textContent).toContain('我有空，七点见。')
    expect(container.textContent).toContain('规则先说好。')
    expect(container.querySelectorAll('.bubble-delivery-reply')).toHaveLength(1)
    expect(container.querySelectorAll('.bubble-delivery-reply-author')).toHaveLength(1)
    expect(container.querySelectorAll('.bubble-delivery-reply-segment')).toHaveLength(2)
    expect(container.querySelectorAll('[data-testid="agent-avatar"]')).toHaveLength(2)
    expect(container.querySelector('[data-testid="empty-avatar"]')).toBeNull()

    await act(async () => toggle?.click())
    expect(container.textContent).not.toContain('准备一副牌。')
  })

  it('shows an incoming private source with the same compact avatar card', async () => {
    await act(async () => root.render(
      <MessageSourceCard
        source={{ kind: 'bot', id: 'agent-1', name: '拽姐', content: '今晚七点半，老地方见。' }}
        agents={agents}
      />
    ))

    const toggle = container.querySelector<HTMLButtonElement>('.bubble-deliveries')
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).toContain('Received privately from 拽姐')
    expect(container.textContent).not.toContain('今晚七点半，老地方见。')

    await act(async () => toggle?.click())

    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('.bubble-private-source')).not.toBeNull()
    expect(container.querySelector('[data-testid="agent-avatar"]')?.getAttribute('data-agent-name')).toBe('拽姐')
    expect(container.textContent).toContain('From拽姐')
    expect(container.textContent).not.toContain('Private message from')
    expect(container.textContent).toContain('今晚七点半，老地方见。')
  })

  it('recovers legacy private content and replies from related messages', async () => {
    await act(async () => root.render(
      <MessageSourceCard
        source={incomingReply.source!}
        agents={agents}
        receiverId="agent-1"
        receivedAt={incomingReply.createdAt}
        relatedMessages={[outbound, incomingReply]}
      />
    ))

    const toggle = container.querySelector<HTMLButtonElement>('.bubble-deliveries')
    await act(async () => toggle?.click())
    expect(container.textContent).toContain('今晚七点半，老地方见。')

    await act(async () => root.render(
      <MessageDeliveries
        deliveries={outbound.deliveries!}
        agents={agents}
        senderId="sender-1"
        sentAt={outbound.createdAt}
        relatedMessages={[outbound, incomingReply]}
      />
    ))
    const sentToggle = container.querySelector<HTMLButtonElement>('.bubble-deliveries')
    await act(async () => sentToggle?.click())
    expect(container.textContent).toContain('拽姐 replied')
    expect(container.textContent).toContain('好，我会准时到。')
  })

  it('renders one source card and one bubble for a multi-part private reply', async () => {
    const source = { kind: 'bot' as const, id: 'sender-1', name: '豆博士', content: '一起打牌吗？' }
    const replies = ['第一段回复', '第二段回复', '第三段回复'].map((text, index): ChatMessage => ({
      id: `private-reply-${index}`,
      conversationId: directConversation.id,
      topicId: 'topic-2',
      authorId: 'agent-1',
      authorName: '拽姐',
      text,
      kind: 'message',
      createdAt: 10,
      replyGroupId: 'private-reply-group',
      source
    }))

    await act(async () => root.render(
      <MessageGroupRow
        messages={replies}
        agent={agents[0]}
        agents={agents}
        relatedMessages={replies}
        userName="You"
        userAvatar=""
        showAuthor={false}
      />
    ))

    expect(container.querySelectorAll('.message-bubble')).toHaveLength(1)
    expect(container.querySelectorAll('.bubble-private-source-disclosure')).toHaveLength(1)
    expect(container.querySelectorAll('.bubble-reply-segment')).toHaveLength(3)
    expect(container.textContent).toContain('第一段回复')
    expect(container.textContent).toContain('第三段回复')
  })
})

describe('direct-chat transcript visibility', () => {
  it('hides legacy handoffs and standalone replies from delegated agents', () => {
    const user: ChatMessage = {
      id: 'user-1', conversationId: directConversation.id, topicId: 'topic-2', authorId: 'user',
      authorName: 'You', text: 'Ask for help.', kind: 'message', createdAt: 1
    }
    const handoff: ChatMessage = {
      id: 'handoff-1', conversationId: directConversation.id, topicId: 'topic-2', authorId: 'agent-1',
      authorName: '拽姐', text: '拽姐 → 豆博士 · Help', kind: 'handoff', createdAt: 2
    }
    const leakedReply: ChatMessage = {
      id: 'leaked-1', conversationId: directConversation.id, topicId: 'topic-2', authorId: 'agent-2',
      authorName: '豆博士', text: 'Internal answer.', kind: 'message', createdAt: 3
    }

    expect(visibleConversationMessages(
      directConversation,
      [user, handoff, leakedReply, incomingReply]
    ).map((message) => message.id)).toEqual(['user-1', 'incoming-1'])
  })

  it('groups contiguous bubbles produced by the same reply turn', () => {
    const source = { kind: 'bot' as const, id: 'sender-1', name: '豆博士', content: '一起打牌吗？' }
    const replies = ['第一段回复', '第二段回复', '第三段回复'].map((text, index): ChatMessage => ({
      id: `reply-${index}`,
      conversationId: directConversation.id,
      topicId: 'topic-2',
      authorId: 'agent-1',
      authorName: '拽姐',
      text,
      kind: 'message',
      createdAt: 10,
      replyGroupId: 'reply-group-1',
      source
    }))

    expect(groupConversationMessages(replies)).toEqual([replies])
  })

  it('groups delivery replies from the same recipient turn', () => {
    const replies = deliveries[0].replies!
    expect(groupDeliveryReplies(replies)).toEqual([replies])
  })
})
