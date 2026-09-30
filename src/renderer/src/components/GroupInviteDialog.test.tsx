// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { Conversation } from '../../../shared/types'
vi.mock('../preferences', () => ({ t: (value: string) => value, tr: (value: string, vars: Record<string, string>) => Object.entries(vars).reduce((text, [key, replacement]) => text.replace(`{${key}}`, replacement), value) }))
vi.mock('./NativeDialog', () => ({ NativeDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
import { GroupInviteDialog } from './GroupInviteDialog'
let root: Root
let container: HTMLDivElement
const invite = { roomId: 'room', name: 'Team', token: 'a'.repeat(43), url: `https://douchat.ai/join-group?room=room&token=${'a'.repeat(43)}`, expiresAt: new Date(Date.now() + 86400000).toISOString() }
const socialAction = vi.fn()
const copyText = vi.fn()
beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  socialAction.mockReset().mockResolvedValue({ invite }); copyText.mockReset().mockResolvedValue(undefined)
  window.douchat = { socialAction, copyText } as unknown as typeof window.douchat
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
const render = async () => { await act(async () => root.render(<GroupInviteDialog conversation={{ id: 'local', name: 'Team', type: 'group', agentIds: [], topics: [], activeTopicId: '', unread: 0, readAt: 0, createdAt: 0, updatedAt: 0 } as Conversation} agents={[]} userName="Me" userAvatar="" onClose={() => {}} />)) }
const click = async (label: string) => { await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === label || button.getAttribute('aria-label') === label)!.click() }) }
it('loads an invitation, copies its link, and confirms rotation', async () => {
  await render()
  expect(socialAction).toHaveBeenCalledWith({ action: 'group-invite', conversationId: 'local', regenerate: false })
  expect(container.querySelector('input')?.value).toBe(invite.url)
  expect(container.querySelector('.group-invite-poster svg title')?.textContent).toBe('Invitation QR code')
  expect(container.querySelector('img')).toBeNull()
  await click('Copy link'); expect(copyText).toHaveBeenCalledWith(invite.url)
  expect(container.querySelector('.group-invite-feedback')?.textContent).toContain('Copied')
  await click('Regenerate invitation'); expect(socialAction).toHaveBeenCalledTimes(1)
  await click('Cancel'); expect(socialAction).toHaveBeenCalledTimes(1)
  const oldQr = container.querySelector('.group-invite-poster svg')?.innerHTML
  socialAction.mockResolvedValueOnce({ invite: { ...invite, url: invite.url + '-new' } })
  await click('Regenerate invitation'); await click('Confirm regeneration')
  expect(container.querySelector('input')?.value).toBe(invite.url + '-new')
  expect(container.querySelector('.group-invite-poster svg')?.innerHTML).not.toBe(oldQr)
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Invitation link updated')
  expect(socialAction).toHaveBeenLastCalledWith({ action: 'group-invite', conversationId: 'local', regenerate: true })
})
it('shows errors and retries without offering an unusable invitation', async () => {
  socialAction.mockRejectedValueOnce(new Error('Offline'))
  await render()
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Offline')
  expect(container.querySelector('img')).toBeNull()
  expect(Array.from(container.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === 'Copy link')?.disabled).toBe(true)
  await click('Retry'); expect(container.querySelector('input')?.value).toBe(invite.url)
})

it('keeps permanent invitations copyable without an expiry timer', async () => {
  vi.useFakeTimers()
  try {
    socialAction.mockResolvedValue({ invite: { ...invite, expiresAt: null } })
    await render()
    expect(container.querySelector('.group-invite-poster')?.textContent).not.toContain('Never expires')
    expect(container.textContent).not.toContain('Invalid Date')
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 86400000) })
    expect(container.textContent).not.toContain('Invitation expired')
    await click('Copy link')
    expect(copyText).toHaveBeenCalledWith(invite.url)
  } finally { vi.useRealTimers() }
})
it('expires timed invitations only at their deadline, including long durations', async () => {
  vi.useFakeTimers()
  try {
    socialAction.mockResolvedValue({ invite: { ...invite, expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() } })
    await render()
    await act(async () => { await vi.advanceTimersByTimeAsync(29 * 86400000) })
    expect(container.textContent).not.toContain('Invitation expired')
    await act(async () => { await vi.advanceTimersByTimeAsync(86400000) })
    expect(container.textContent).toContain('Invitation expired')
    expect(container.querySelector('.group-invite-poster')).toBeNull()
    expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Save poster')?.disabled).toBe(true)
    expect(Array.from(container.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === 'Copy link')?.disabled).toBe(true)
  } finally { vi.useRealTimers() }
})

it.each(['save', 'cancel', 'copy'])('exports the poster to the requested destination (%s)', async mode => {
  const saved = mode === 'save'
  const copyInvitationImage = vi.fn().mockResolvedValue(undefined)
  window.douchat.copyInvitationImage = copyInvitationImage
  const saveInvitationImage = vi.fn().mockResolvedValue(saved)
  window.douchat.saveInvitationImage = saveInvitationImage
  const context = { fillRect: vi.fn(), fillText: vi.fn(), drawImage: vi.fn(), measureText: () => ({ width: 80 }) }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as any)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,card')
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: vi.fn().mockResolvedValue(undefined) })
  try {
    await render(); await click(mode === 'copy' ? 'Copy invite card' : 'Save poster')
    expect(mode === 'copy' ? copyInvitationImage : saveInvitationImage).toHaveBeenCalledWith('data:image/png;base64,card')
    expect(container.querySelector('.group-invite-poster')?.textContent).toContain('Team')
    expect(container.querySelector('.group-invite-poster')?.textContent).toContain('Join from your computer · douchat.ai')
    expect(container.querySelector('.group-invite-poster')?.textContent).not.toContain('Desktop app required')
    expect(context.drawImage).toHaveBeenCalledOnce()
    expect(container.textContent?.includes('Image saved')).toBe(saved)
    const image = context.drawImage.mock.calls[0][0] as HTMLImageElement
    expect(image.src).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    expect(decodeURIComponent(image.src.split(',')[1])).toContain('Team')
  } finally { vi.restoreAllMocks() }
})

it('copies an invitation with the group name, real invite link and desktop instructions', async () => {
  await render(); await click('Copy invitation text')
  const text = copyText.mock.calls[0][0]
  expect(text).toContain('Team')
  expect(text).toContain(invite.url)
  expect(text).toContain('https://douchat.ai')
  expect(text).toContain('Open this invitation on your computer:')
  expect(text).toContain('Desktop app required')
})

it('uses one brand style and the default group avatar', async () => {
  await render()
  expect(container.querySelector('.group-invite-poster rect')?.getAttribute('fill')).toBe('#f8faff')
  expect(container.querySelector('[aria-label="Poster color"]')).toBeNull()
  expect(container.querySelector('[data-invitation-avatar="default"]')).not.toBeNull()
  expect(socialAction).toHaveBeenCalledOnce()
})
