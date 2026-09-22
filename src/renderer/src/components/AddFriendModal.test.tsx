// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DouchatApi } from '../../../shared/types'
import type { SocialResult } from '../../../shared/social'
vi.mock('../preferences', () => ({ usePreferences: () => ({ language: 'en' }), resolveInterfaceLanguage: () => 'en' }))
vi.mock('./common', () => ({ UserAvatar: ({ name, src }: { name: string; src: string }) => <span data-avatar={src}>{name}</span> }))
import { AddFriendModal } from './AddFriendModal'
let root: Root
let container: HTMLDivElement
const api = vi.fn<(input: unknown) => Promise<SocialResult>>()
const person = { id: 'bob', name: 'Bob', email: 'bob@example.com', image: 'https://example.com/bob.png' }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  HTMLDialogElement.prototype.showModal = vi.fn()
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  api.mockReset()
  window.douchat = { socialAction: api } as unknown as DouchatApi
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
async function typeEmail(value: string) {
  await act(async () => {
    const input = container.querySelector('input')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function search() { await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))) }
it('shows profile first and only sends a request after the explicit application click', async () => {
  api.mockResolvedValueOnce({ person, relationship: 'none' }).mockResolvedValueOnce({})
  await act(async () => root.render(<AddFriendModal onClose={vi.fn()} />))
  await typeEmail('bob@example.com'); await search()
  expect(api).toHaveBeenCalledTimes(1)
  expect(api).toHaveBeenCalledWith({ action: 'lookup', email: 'bob@example.com' })
  expect(container.textContent).toContain('Bob')
  expect(container.textContent).toContain('bob@example.com')
  expect(container.querySelector('[data-avatar]')?.getAttribute('data-avatar')).toBe(person.image)
  const send = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Send friend request')!
  await act(async () => send.click())
  expect(api).toHaveBeenLastCalledWith({ action: 'request', email: person.email })
  expect(container.textContent).toContain('Request sent')
  expect((container.querySelector('.friend-result-action button') as HTMLButtonElement).disabled).toBe(true)
})
it('clears stale search results when the email changes', async () => {
  let resolve!: (value: SocialResult) => void
  api.mockImplementation(() => new Promise((done) => { resolve = done }))
  await act(async () => root.render(<AddFriendModal onClose={vi.fn()} />))
  await typeEmail('bob@example.com'); await search()
  await typeEmail('other@example.com')
  await act(async () => resolve({ person, relationship: 'none' }))
  expect(container.querySelector('.friend-search-result')).toBeNull()
  expect(container.textContent).not.toContain('Send friend request')
})
it('shows no-result and already-friends states without allowing requests', async () => {
  api.mockResolvedValueOnce({ person: null }).mockResolvedValueOnce({ person, relationship: 'accepted' })
  await act(async () => root.render(<AddFriendModal onClose={vi.fn()} />))
  await typeEmail('missing@example.com'); await search()
  expect(container.textContent).toContain('No Douchat user found')
  await typeEmail('bob@example.com'); await search()
  expect(container.textContent).toContain('Already friends')
  expect((container.querySelector('.friend-result-action button') as HTMLButtonElement).disabled).toBe(true)
})

it('closes from the content button (system close and Escape belong to NativeDialog)', async () => {
  const onClose = vi.fn()
  await act(async () => root.render(<AddFriendModal onClose={onClose} />))
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click())
  expect(onClose).toHaveBeenCalledOnce()
})

// Component behavior tests use an inline host; NativeDialog has separate window lifecycle tests.
vi.mock('./NativeDialog', async () => {
  const { createElement } = await import('react')
  return { NativeDialog: ({ children, onClose, width, height, ...props }: any) => createElement('div', props, children) }
})
