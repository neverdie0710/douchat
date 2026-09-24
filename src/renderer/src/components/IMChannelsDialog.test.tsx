// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import type { AgentConfig } from '../../../shared/types'
vi.mock('./NativeDialog', () => ({ NativeDialog: ({ children }: any) => <div>{children}</div> }))
vi.mock('../preferences', () => ({ usePreferences: () => ({ language: 'zh-CN' }), resolveInterfaceLanguage: (value: string) => value }))
import { IMChannelsDialog } from './IMChannelsDialog'
const agent = { id: 'alpha', name: '豆博士' } as AgentConfig
let root: Root; let container: HTMLDivElement
let api: any
beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  api = { listIMChannels: vi.fn().mockResolvedValue([]), connectIMChannel: vi.fn().mockResolvedValue(undefined), disconnectIMChannel: vi.fn().mockResolvedValue(undefined),
    cancelIMLogin: vi.fn().mockResolvedValue(undefined), startIMLogin: vi.fn().mockResolvedValue({ sessionId: 'qr-session', qr: 'https://example.com/qr' }), pollIMLogin: vi.fn(() => new Promise(() => {})), copyText: vi.fn().mockResolvedValue(undefined) }
  Object.defineProperty(window, 'douchat', { configurable: true, value: api })
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
async function render() { await act(async () => root.render(<IMChannelsDialog agent={agent} onClose={vi.fn()} />)) }
async function click(button: Element) { await act(async () => (button as HTMLElement).click()) }
function button(text: string) { return [...container.querySelectorAll('button')].find(b => b.textContent === text)! }
async function input(element: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })) })
}
describe('IM channel configuration', () => {
  it('shows the three requested providers and connects Telegram to the selected contact', async () => {
    await render()
    expect([...container.querySelectorAll('article h3')].map(e => e.textContent)).toEqual(['WeChat', 'Feishu', 'Telegram'])
    await click(container.querySelectorAll('article button')[2])
    expect(container.textContent).toContain('@BotFather')
    await input(container.querySelector('input')!, '123:token')
    api.listIMChannels.mockResolvedValue([{ agentId: 'alpha', provider: 'telegram', label: '@my_bot', paired: false, pairingCode: 'abc123', status: 'connected' }])
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(api.connectIMChannel).toHaveBeenCalledWith('alpha', { provider: 'telegram', token: '123:token' })
    expect(container.textContent).toContain('/pair abc123')
    expect(container.querySelector('input')).toBeNull()
    await click(container.querySelector('.im-code')!)
    expect(api.copyText).toHaveBeenCalledWith('/pair abc123')
  })
  it('renders the WeChat QR and starts status polling', async () => {
    await render(); await click(container.querySelectorAll('article button')[0])
    expect(api.startIMLogin).toHaveBeenCalledWith('alpha')
    expect(container.querySelector('.im-qr-image svg')).not.toBeNull()
    expect(api.pollIMLogin).toHaveBeenCalledWith('alpha', 'qr-session')
    await click(button('全部渠道'))
    expect(container.querySelector('.im-qr-image')).toBeNull()
  })
  it('shows credential failure without losing the form values', async () => {
    api.connectIMChannel.mockRejectedValue(new Error('凭证无效'))
    await render(); await click(container.querySelectorAll('article button')[1])
    const inputs = container.querySelectorAll('input')
    await input(inputs[0], 'cli_0123456789abcdef'); await input(inputs[1], 'secret')
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('凭证无效')
    expect(inputs[0].value).toBe('cli_0123456789abcdef')
    expect(button('连接').disabled).toBe(false)
  })
  it('requires a disconnect confirmation and refreshes the card', async () => {
    api.listIMChannels.mockResolvedValue([{ agentId: 'alpha', provider: 'wechat', label: 'wx@im.bot', paired: true, status: 'connected' }])
    await render(); await click(button('断开连接'))
    expect(api.disconnectIMChannel).not.toHaveBeenCalled()
    expect(container.textContent).toContain('断开这个机器人？')
    api.listIMChannels.mockResolvedValue([])
    await click(button('断开连接'))
    expect(api.disconnectIMChannel).toHaveBeenCalledWith('alpha', 'wechat')
    expect(container.textContent).not.toContain('wx@im.bot')
  })
})
