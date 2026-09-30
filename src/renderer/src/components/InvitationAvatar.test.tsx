// @vitest-environment jsdom
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { AgentConfig, Conversation } from '../../../shared/types'
import { InvitationAvatar, invitationSvgSource } from './InvitationAvatar'
vi.mock('../preferences', () => ({ t: (s: string) => s }))
const conversation = { id: 'group', name: 'Group', agentIds: ['one'] } as Conversation
const agents = [{ id: 'one', name: 'One', avatarEmoji: '🐱' }] as AgentConfig[]
it('uses the group picture before its members, and supports group emoji', () => {
  const picture = 'data:image/png;base64,avatar'
  const html = renderToStaticMarkup(<InvitationAvatar conversation={{ ...conversation, avatar: picture }} agents={agents} userName="Me" userAvatar="" />)
  expect(html).toContain(picture); expect(html).not.toContain('🐱')
  expect(renderToStaticMarkup(<InvitationAvatar conversation={{ ...conversation, avatarEmoji: '🎮' }} agents={agents} userName="Me" userAvatar="" />)).toContain('🎮')
})
it('builds the member mosaic with the owner photo included', () => {
  const html = renderToStaticMarkup(<InvitationAvatar conversation={conversation} agents={agents} userName="Me" userAvatar="data:image/png;base64,owner" />)
  expect(html).toContain('🐱'); expect(html).toContain('data:image/png;base64,owner'); expect(html).toContain('data-invitation-avatar="mosaic"')
})
it('embeds local avatar assets into an export without changing the preview', async () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.innerHTML = '<image href="/avatars/test.png"/>'
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['image'], { type: 'image/png' }) }))
  try {
    const source = decodeURIComponent((await invitationSvgSource(svg)).split(',')[1])
    expect(source).toContain('data:image/png;base64,'); expect(source).not.toContain('/avatars/test.png')
    expect(svg.querySelector('image')?.getAttribute('href')).toBe('/avatars/test.png')
  } finally { vi.unstubAllGlobals() }
})
