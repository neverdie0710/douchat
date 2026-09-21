// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DouchatApi } from '../../../shared/types'

vi.mock('../preferences', () => ({
  setPreferences: vi.fn(),
  usePreferences: () => ({ language: 'en', appearance: 'system', fontSize: 1 }),
  t: (text: string) => text
}))

vi.mock('./common', () => ({
  UserAvatar: ({ name }: { name: string }) => <span data-user-avatar={name} />
}))

import { SettingsPanel } from './SettingsPanel'

describe('usage and billing settings', () => {
  let container: HTMLDivElement
  let root: Root
  let getUsageSummary: ReturnType<typeof vi.fn>
  let openSubscriptionPlans: ReturnType<typeof vi.fn>

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    getUsageSummary = vi.fn(async () => ({ planName: 'Free', status: 'free', credits: 1611 }))
    openSubscriptionPlans = vi.fn(async () => undefined)
    Object.defineProperty(window, 'douchat', {
      configurable: true,
      value: { getUsageSummary, openSubscriptionPlans } as Partial<DouchatApi>
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  async function renderUsage(creditsRefreshToken = 0): Promise<void> {
    await act(async () => root.render(
      <SettingsPanel
        user={{ id: 'user-1', name: 'Ada', email: 'ada@example.com' }}
        agents={[]}
        scanning={false}
        error=""
        tab="usage"
        creditsRefreshToken={creditsRefreshToken}
        onTab={vi.fn()}
        onClose={vi.fn()}
        onSignOut={vi.fn(async () => undefined)}
        onUpdateProfile={vi.fn(async () => undefined)}
        onDetect={vi.fn()}
      />
    ))
  }

  async function renderGeneral(): Promise<void> {
    await act(async () => root.render(
      <SettingsPanel
        user={{ id: 'user-1', name: 'Ada', email: 'ada@example.com' }}
        agents={[]}
        scanning={false}
        error=""
        tab="general"
        creditsRefreshToken={0}
        onTab={vi.fn()}
        onClose={vi.fn()}
        onSignOut={vi.fn(async () => undefined)}
        onUpdateProfile={vi.fn(async () => undefined)}
        onDetect={vi.fn()}
      />
    ))
  }

  it('offers follow-system alongside the explicit interface languages', async () => {
    await renderGeneral()

    const language = container.querySelector<HTMLSelectElement>('.general-settings select')
    expect([...language?.options ?? []].map((option) => [option.value, option.textContent])).toEqual([
      ['system', 'Follow system'],
      ['en', 'English'],
      ['zh-CN', '简体中文']
    ])
  })

  it('shows only the credit balance and a top-up action', async () => {
    await renderUsage()

    expect(container.querySelector('#usage-tab')?.getAttribute('aria-selected')).toBe('true')
    expect(container.textContent).toContain('Credits')
    expect(container.textContent).toContain('Credit balance')
    expect(container.textContent).toContain('1,611')
    expect(container.textContent).not.toContain('Current plan')
    expect(container.textContent).not.toContain('Billing')
    expect(container.textContent).not.toContain('Invoices and payment methods')

    const topUp = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Top up'))
    await act(async () => topUp?.click())
    expect(openSubscriptionPlans).toHaveBeenCalledOnce()
  })

  it('offers a retry when the usage summary cannot be loaded', async () => {
    getUsageSummary
      .mockRejectedValueOnce(new Error('Could not load credits. Check your connection and try again.'))
      .mockResolvedValueOnce({ planName: 'Pro', status: 'active', credits: 300 })

    await renderUsage()
    expect(container.textContent).toContain('Could not load credits')

    const retry = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Try again')
    await act(async () => retry?.click())

    expect(getUsageSummary).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('300')
    expect(container.textContent).not.toContain('Pro')
  })

  it('reloads the balance after a completed browser top-up returns to the app', async () => {
    await renderUsage(0)
    expect(getUsageSummary).toHaveBeenCalledTimes(1)

    getUsageSummary.mockResolvedValueOnce({ planName: 'Free', status: 'free', credits: 2029 })
    await renderUsage(1)

    expect(getUsageSummary).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('2,029')
  })
})
