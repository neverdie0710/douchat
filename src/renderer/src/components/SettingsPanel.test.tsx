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
  let openBillingPortal: ReturnType<typeof vi.fn>

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    getUsageSummary = vi.fn(async () => ({ planName: 'Free', status: 'free', credits: 1611 }))
    openSubscriptionPlans = vi.fn(async () => undefined)
    openBillingPortal = vi.fn(async () => undefined)
    Object.defineProperty(window, 'douchat', {
      configurable: true,
      value: { getUsageSummary, openSubscriptionPlans, openBillingPortal } as Partial<DouchatApi>
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  async function renderUsage(): Promise<void> {
    await act(async () => root.render(
      <SettingsPanel
        user={{ id: 'user-1', name: 'Ada', email: 'ada@example.com' }}
        agents={[]}
        scanning={false}
        error=""
        tab="usage"
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

  it('shows the plan, remaining credits, and a billing entry', async () => {
    await renderUsage()

    expect(container.querySelector('#usage-tab')?.getAttribute('aria-selected')).toBe('true')
    expect(container.textContent).toContain('Usage & Billing')
    expect(container.textContent).toContain('Credits remaining')
    expect(container.textContent).toContain('1,611')
    expect(container.textContent).toContain('Current plan')
    expect(container.textContent).toContain('Free')
    expect(container.textContent).toContain('Billing')
    expect(container.textContent).toContain('Invoices and payment methods')

    const upgrade = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Upgrade plan'))
    await act(async () => upgrade?.click())
    expect(openSubscriptionPlans).toHaveBeenCalledOnce()

    const billing = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Manage billing'))
    await act(async () => billing?.click())
    expect(openBillingPortal).toHaveBeenCalledOnce()
  })

  it('offers a retry when the usage summary cannot be loaded', async () => {
    getUsageSummary
      .mockRejectedValueOnce(new Error('Could not load usage and billing. Check your connection and try again.'))
      .mockResolvedValueOnce({ planName: 'Pro', status: 'active', credits: 300 })

    await renderUsage()
    expect(container.textContent).toContain('Could not load usage and billing')

    const retry = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Try again')
    await act(async () => retry?.click())

    expect(getUsageSummary).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('300')
    expect(container.textContent).toContain('Pro')
  })
})
