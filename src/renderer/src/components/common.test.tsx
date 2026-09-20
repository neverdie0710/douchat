// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../preferences', () => ({
  t: (text: string) => text
}))

import { AgentAvatar, UserAvatar, agentSourceLabel } from './common'

describe('user avatar', () => {
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

  it('shows the fallback until the remote picture has loaded', async () => {
    await act(async () => root.render(<UserAvatar src="https://example.com/avatar.png" name="Ada" />))

    const avatar = container.querySelector('.user-avatar')!
    const image = container.querySelector<HTMLImageElement>('img')!
    expect(avatar.classList.contains('has-photo')).toBe(false)
    expect(image.classList.contains('is-loaded')).toBe(false)
    expect(container.querySelector('svg')).not.toBeNull()

    await act(async () => image.dispatchEvent(new Event('load')))

    expect(avatar.classList.contains('has-photo')).toBe(true)
    expect(image.classList.contains('is-loaded')).toBe(true)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('keeps the fallback and removes a picture that fails to load', async () => {
    await act(async () => root.render(<UserAvatar src="https://example.com/missing.png" name="New user" />))

    const image = container.querySelector<HTMLImageElement>('img')!
    await act(async () => image.dispatchEvent(new Event('error')))

    const avatar = container.querySelector('.user-avatar')!
    expect(avatar.classList.contains('has-photo')).toBe(false)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders an emoji avatar instead of the generated fallback', async () => {
    await act(async () => root.render(
      <AgentAvatar agent={{
        id: 'emoji-agent',
        name: 'Emoji agent',
        avatarEmoji: '🧠',
        avatarSeed: 'generated-seed',
        role: 'Assistant',
        instructions: '',
        color: '#7C6CF2',
        provider: 'gateway',
        model: 'default',
        createdAt: 1
      }} />
    ))

    expect(container.querySelector('.emoji-agent-avatar')?.textContent).toBe('🧠')
    expect(container.querySelector('.generated-agent-avatar-art')).toBeNull()
  })

  it('uses the same compact source label across contact surfaces', () => {
    const base = {
      name: 'Agent', role: 'Assistant', instructions: '', color: '#7C6CF2', provider: 'gateway', model: 'default', createdAt: 1
    }
    expect(agentSourceLabel({ ...base, id: 'cloud' })).toBe('Cloud')
    expect(agentSourceLabel({ ...base, id: 'local', localAgentId: 'opencode', provider: 'local' })).toBe('Local · OpenCode')
  })
})
