// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { Conversation } from '../../../shared/types'
vi.mock('../preferences', () => ({ t: (value: string) => value, tr: (value: string, vars: Record<string, string>) => value.replace('{date}', vars.date) }))
vi.mock('./common', () => ({ ConversationAvatar: () => <span /> }))
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
const render = async () => { await act(async () => root.render(<GroupInviteDialog conversation={{ id: 'local', name: 'Team' } as Conversation} agents={[]} userName="Me" userAvatar="" onClose={() => {}} />)) }
const click = async (label: string) => { await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === label)!.click() }) }
it('loads an invitation, copies its link, and confirms rotation', async () => {
  await render()
  expect(socialAction).toHaveBeenCalledWith({ action: 'group-invite', conversationId: 'local', regenerate: false })
  expect(container.querySelector('input')?.value).toBe(invite.url)
  expect(container.querySelector('img')).toBeNull()
  await click('Copy link'); expect(copyText).toHaveBeenCalledWith(invite.url)
  expect(container.querySelector('.group-invite-actions')?.textContent).toContain('Copied')
  await click('Regenerate invitation'); expect(socialAction).toHaveBeenCalledTimes(1)
  await click('Cancel'); expect(socialAction).toHaveBeenCalledTimes(1)
  socialAction.mockResolvedValueOnce({ invite: { ...invite, url: invite.url + '-new' } })
  await click('Regenerate invitation'); await click('Confirm regeneration')
  expect(container.querySelector('input')?.value).toBe(invite.url + '-new')
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Invitation link updated')
  expect(socialAction).toHaveBeenLastCalledWith({ action: 'group-invite', conversationId: 'local', regenerate: true })
})
it('shows errors and retries without offering an unusable invitation', async () => {
  socialAction.mockRejectedValueOnce(new Error('Offline'))
  await render()
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Offline')
  expect(container.querySelector('img')).toBeNull()
  expect(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Copy link')?.disabled).toBe(true)
  await click('Retry'); expect(container.querySelector('input')?.value).toBe(invite.url)
})

it('keeps permanent invitations copyable without an expiry timer', async () => {
  vi.useFakeTimers()
  try {
    socialAction.mockResolvedValue({ invite: { ...invite, expiresAt: null } })
    await render()
    expect(container.textContent).toContain('Never expires')
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
    expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Copy link')?.disabled).toBe(true)
  } finally { vi.useRealTimers() }
})
