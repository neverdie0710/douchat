// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentConfig, ChatMessage, Conversation, ConversationActivityState } from '../../../shared/types'

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
  MessageActions,
  ChatActivity,
  MessageGroupRow,
  MessageRow,
  MessageSourceCard,
  SystemMessage,
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

  it('shows group delivery receipts without a disclosure control', async () => {
    await act(async () => root.render(<MessageDeliveries deliveries={[
      { id: 'secret', recipientId: 'agent-1', recipientName: '拽姐', content: '' }
    ]} agents={agents} />))
    expect(container.textContent).toContain('Sent private message to 拽姐')
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('.bubble-delivery-details')).toBeNull()
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

  it('renders an avatar beside every ordinary bubble from one reply turn', async () => {
    const replies = ['第一条消息', '第二条消息'].map((text, index): ChatMessage => ({
      id: `ordinary-reply-${index}`,
      conversationId: directConversation.id,
      topicId: 'topic-2',
      authorId: 'agent-1',
      authorName: '拽姐',
      text,
      kind: 'message',
      createdAt: 10,
      replyGroupId: 'ordinary-reply-group'
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

    expect(container.querySelectorAll('.message-row')).toHaveLength(2)
    expect(container.querySelectorAll('.message-bubble')).toHaveLength(2)
    expect(container.querySelectorAll('[data-testid="agent-avatar"]')).toHaveLength(2)
  })

  it('shows a plain-language receipt for a completed local-file tool action', async () => {
    await act(async () => root.render(
      <MessageActions actions={[
        { id: 'tool-1', tool: 'computer_open_file', status: 'succeeded', target: 'qin-emperor.mp4' }
      ]} />
    ))

    expect(container.querySelector('.message-action.is-succeeded')).not.toBeNull()
    expect(container.textContent).toContain('Opened qin-emperor.mp4 with the system default app')
    expect(container.textContent).not.toContain('computer_open_file')
  })

  it('collapses multiple tool attempts behind the final successful action', async () => {
    await act(async () => root.render(
      <MessageActions actions={[
        { id: 'tool-1', tool: 'computer_list_files', status: 'failed', target: 'Downloads' },
        { id: 'tool-2', tool: 'computer_list_files', status: 'succeeded', target: 'Videos' },
        { id: 'tool-3', tool: 'computer_open_file', status: 'succeeded', target: 'qin-emperor.mp4' }
      ]} />
    ))

    const toggle = container.querySelector<HTMLButtonElement>('.message-actions-toggle')
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).toContain('Opened qin-emperor.mp4 with the system default app')
    expect(container.textContent).toContain('3 actions')
    expect(container.textContent).not.toContain('Could not check files in Downloads')

    await act(async () => toggle?.click())

    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('Could not check files in Downloads')
    expect(container.textContent).toContain('Checked files in Videos')
  })

  it('keeps completed tool action receipts hidden from chat messages', async () => {
    const message: ChatMessage = {
      id: 'tool-receipt-hidden',
      conversationId: directConversation.id,
      topicId: 'topic-2',
      authorId: 'agent-1',
      authorName: '拽姐',
      text: '已经打开了。',
      kind: 'message',
      createdAt: 20,
      actions: [
        { id: 'tool-1', tool: 'computer_open', status: 'succeeded', target: 'douchat.ai' },
        { id: 'tool-2', tool: 'computer_open', status: 'failed' }
      ]
    }

    await act(async () => root.render(
      <MessageGroupRow
        messages={[message]}
        agent={agents[0]}
        agents={agents}
        relatedMessages={[message]}
        userName="You"
        userAvatar=""
        showAuthor={false}
      />
    ))

    expect(container.textContent).toContain('已经打开了。')
    expect(container.querySelector('.message-actions')).toBeNull()
    expect(container.textContent).not.toContain('Opened douchat.ai')
  })

  it('opens the shared agent profile from an agent message avatar', async () => {
    const openProfile = vi.fn()
    await act(async () => root.render(
      <MessageGroupRow
        messages={[incomingReply]}
        agent={agents[0]}
        agents={agents}
        relatedMessages={[incomingReply]}
        userName="You"
        userAvatar=""
        showAuthor={false}
        onOpenAgentProfile={openProfile}
      />
    ))

    const avatar = container.querySelector<HTMLButtonElement>('.message-avatar-button')
    expect(avatar?.getAttribute('aria-label')).toBe('拽姐 — view profile')
    await act(async () => avatar?.click())
    expect(openProfile).toHaveBeenCalledTimes(1)
    expect(openProfile.mock.calls[0][0]).toBe('agent-1')
    expect(openProfile.mock.calls[0][1]).toMatchObject({ left: 0, right: 0, top: 0 })
  })

  it('renders a human friend with the shared incoming bubble and their own profile', async () => {
    const openProfile = vi.fn()
    const message: ChatMessage = {
      id: 'friend-message', conversationId: 'dm', topicId: 'dm',
      authorId: 'bob', authorName: 'Bob', text: 'Hello', kind: 'message', createdAt: 20
    }
    await act(async () => root.render(<MessageRow messages={[message]} agents={[]} relatedMessages={[message]}
      person={{ id: 'bob', name: 'Bob', email: 'bob@example.com', image: 'bob.png' }}
      onOpenPersonProfile={openProfile} userName="Alice" userAvatar="" showAuthor={false} />))
    expect(container.querySelector('.agent-bubble')?.textContent).toContain('Hello')
    expect(container.querySelector('[data-user-name="Bob"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="empty-avatar"]')).toBeNull()
    await act(async () => container.querySelector<HTMLButtonElement>('.message-avatar-button')!.click())
    expect(openProfile).toHaveBeenCalledOnce()
  })

  it('opens profile editing from the user message avatar', async () => {
    const openUserProfile = vi.fn()
    const userMessage: ChatMessage = {
      id: 'user-profile-message',
      conversationId: directConversation.id,
      topicId: 'topic-2',
      authorId: 'user',
      authorName: 'You',
      text: 'Hello',
      kind: 'message',
      createdAt: 20
    }
    await act(async () => root.render(
      <MessageRow
        messages={[userMessage]}
        agents={agents}
        relatedMessages={[userMessage]}
        userName="You"
        userAvatar=""
        showAuthor={false}
        onOpenUserProfile={openUserProfile}
      />
    ))

    const avatar = container.querySelector<HTMLButtonElement>('.user-profile-avatar-button')
    expect(avatar?.getAttribute('aria-label')).toBe('You — open your profile')
    await act(async () => avatar?.click())
    expect(openUserProfile).toHaveBeenCalledOnce()
  })

  it('shows the current activity inside one reply bubble', async () => {
    const activity: ConversationActivityState = {
      conversationId: directConversation.id,
      topicId: 'topic-2',
      phase: 'replying',
      agentIds: ['agent-1'],
      label: '拽姐',
      startedAt: 1,
      action: { id: 'tool-1', tool: 'computer_list_files', status: 'running', target: 'Other' }
    }

    await act(async () => root.render(<ChatActivity activity={activity} agents={agents} />))

    expect(container.querySelectorAll('.typing-bubble')).toHaveLength(1)
    expect(container.querySelector('.typing-activity-text')?.textContent).toContain('Checking files in Other')
    expect(container.querySelector('.typing-activity-detail')).toBeNull()

    await act(async () => root.render(
      <ChatActivity
        activity={{
          ...activity,
          action: { id: 'tool-2', tool: 'computer_open_file', status: 'running', target: 'agreement.docx' }
        }}
        agents={agents}
      />
    ))

    expect(container.querySelector('.typing-activity-text')?.textContent)
      .toContain('Opening agreement.docx with the system default app')

    await act(async () => root.render(<ChatActivity activity={{ ...activity, action: undefined }} agents={agents} />))
    expect(container.querySelector('.typing-activity-text')?.textContent).toBe('Thinking about the next step')

    await act(async () => root.render(
      <ChatActivity
        activity={{ ...activity, phase: 'planning', agentIds: [], label: 'Coordinating the group', action: undefined }}
        agents={agents}
      />
    ))
    expect(container.querySelector('.typing-label')?.textContent).toBe('Coordinating the group')
    expect(container.querySelector('.avatar')).toBeNull()
    expect(container.querySelector('.typing-activity-text')?.textContent).toBe('Coordinating the group')

    await act(async () => root.render(
      <ChatActivity
        activity={{
          ...activity,
          action: { id: 'tool-3', tool: 'computer_open_file', status: 'succeeded', target: 'agreement.docx' }
        }}
        agents={agents}
      />
    ))
    expect(container.querySelector('.typing-activity-text')?.textContent).toBe('Preparing the result')
  })

  it('shows the specific problem immediately while keeping raw detail folded', async () => {
    const onOpenCredits = vi.fn()
    const detail = '429: {"message":"Douchat credit balance is insufficient"}'
    const message: ChatMessage = {
      id: 'error-1',
      conversationId: directConversation.id,
      topicId: 'topic-2',
      authorId: 'system',
      authorName: 'Douchat',
      text: 'The provider is rate limiting this key · HTTP 429',
      detail,
      kind: 'system',
      createdAt: 30
    }

    await act(async () => root.render(<SystemMessage message={message} onOpenCredits={onOpenCredits} />))

    const toggle = container.querySelector<HTMLButtonElement>('.system-toggle')
    expect(container.textContent).toContain('Douchat does not have enough credits')
    expect(container.textContent).toContain('Top up credits to continue.')
    expect(container.textContent).not.toContain('credit balance')

    const topUp = container.querySelector<HTMLButtonElement>('.system-inline-action')
    expect(topUp?.parentElement?.classList.contains('system-guidance')).toBe(true)
    expect(topUp?.querySelector('svg')).toBeNull()
    await act(async () => topUp?.click())
    expect(onOpenCredits).toHaveBeenCalledOnce()

    await act(async () => toggle?.click())

    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain(detail)
  })

  it('shows a next step for a local Claude startup failure', async () => {
    const message: ChatMessage = {
      id: 'error-2', conversationId: directConversation.id, topicId: 'topic-2',
      authorId: 'system', authorName: 'Douchat', text: 'Claude Code: Exited with status 1',
      detail: 'Run ID: run-1\nCause:\nClaude Code: Exited with status 1', kind: 'system', createdAt: 31
    }
    await act(async () => root.render(<SystemMessage message={message} />))
    expect(container.textContent).toContain('Claude Code could not start')
    expect(container.textContent).toContain('Open Claude Code in Terminal once')
    expect(container.textContent).not.toContain('Run ID: run-1')
  })

  it('shows a next step when a local Claude account is out of credit', async () => {
    const openLocalAgentTerminal = vi.fn(async () => ({ terminal: 'termany' as const }))
    Object.defineProperty(window, 'douchat', {
      configurable: true,
      value: { openLocalAgentTerminal }
    })
    const message: ChatMessage = {
      id: 'error-3', conversationId: directConversation.id, topicId: 'topic-2',
      authorId: 'system', authorName: 'Douchat', text: 'Claude Code: Credit balance is too low',
      detail: 'Run ID: run-2\nCause:\nClaude Code: Credit balance is too low', kind: 'system', createdAt: 32
    }
    await act(async () => root.render(<SystemMessage message={message} />))
    expect(container.textContent).toContain('Claude Code does not have enough credit')
    expect(container.textContent).toContain('add credit or switch to an account with available usage')
    expect(container.textContent).not.toContain('Run ID: run-2')

    await act(async () => container.querySelector<HTMLButtonElement>('.system-toggle')?.click())
    const action = [...container.querySelectorAll<HTMLButtonElement>('.system-recovery-action')]
      .find((button) => button.textContent?.includes('Open Claude Code'))
    expect(action).toBeTruthy()
    await act(async () => action?.click())
    expect(openLocalAgentTerminal).toHaveBeenCalledWith('claude')
  })

  it('unlocks a stuck Claude terminal action after six seconds', async () => {
    vi.useFakeTimers()
    try {
      const openLocalAgentTerminal = vi.fn(() => new Promise<{ terminal: 'termany' | 'system' }>(() => undefined))
      Object.defineProperty(window, 'douchat', {
        configurable: true,
        value: { openLocalAgentTerminal }
      })
      const message: ChatMessage = {
        id: 'error-4', conversationId: directConversation.id, topicId: 'topic-2',
        authorId: 'system', authorName: 'Douchat', text: 'Claude Code: Credit balance is too low',
        detail: 'Cause:\nClaude Code: Credit balance is too low', kind: 'system', createdAt: 33
      }
      await act(async () => root.render(<SystemMessage message={message} />))
      await act(async () => container.querySelector<HTMLButtonElement>('.system-toggle')?.click())
      const action = container.querySelector<HTMLButtonElement>('.system-recovery-action')

      await act(async () => action?.click())
      expect(action?.disabled).toBe(true)
      expect(action?.textContent).toContain('Opening')

      await act(async () => vi.advanceTimersByTimeAsync(6_100))

      expect(action?.disabled).toBe(false)
      expect(action?.textContent).toContain('Open Claude Code')
      expect(container.textContent).toContain('Opening Claude Code timed out')
    } finally {
      vi.useRealTimers()
    }
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

  it('groups contiguous private-reply segments produced by the same turn', () => {
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

  it('keeps ordinary bubbles from the same reply turn as separate avatar rows', () => {
    const replies = ['第一条消息', '第二条消息'].map((text, index): ChatMessage => ({
      id: `ordinary-${index}`,
      conversationId: directConversation.id,
      topicId: 'topic-2',
      authorId: 'agent-1',
      authorName: '拽姐',
      text,
      kind: 'message',
      createdAt: 10,
      replyGroupId: 'reply-group-1'
    }))

    expect(groupConversationMessages(replies)).toEqual(replies.map((message) => [message]))
  })

  it('groups delivery replies from the same recipient turn', () => {
    const replies = deliveries[0].replies!
    expect(groupDeliveryReplies(replies)).toEqual([replies])
  })
})
