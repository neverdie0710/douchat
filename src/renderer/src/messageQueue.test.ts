import { describe, expect, it, vi } from 'vitest'
import { messageSendError, MessageQueue, type QueuedMessage } from './messageQueue'
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
describe('MessageQueue', () => {
  it('queues serially, promotes the next message and removes pending messages', async () => {
    let entries: QueuedMessage[] = []
    const queue = new MessageQueue((next) => { entries = next })
    let finish!: () => void
    const calls: string[] = []
    queue.enqueue('a', 'first', async () => { calls.push('first'); await new Promise<void>((resolve) => { finish = resolve }) }, () => true)
    for (const text of ['second', 'third', 'remove']) queue.enqueue('a', text, async () => { calls.push(text) }, () => true)
    await flush()
    expect(calls).toEqual(['first'])
    queue.promote(entries.find((item) => item.text === 'third')!.id)
    queue.remove(entries.find((item) => item.text === 'remove')!.id)
    finish()
    await flush()
    expect(calls).toEqual(['first', 'third', 'second'])
    expect(entries).toEqual([])
  })
  it('waits for existing activity, keeps failures for retry and isolates conversations', async () => {
    let entries: QueuedMessage[] = []
    const queue = new MessageQueue((next) => { entries = next })
    let ready = false
    const run = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    queue.enqueue('a', 'pending', run, () => ready)
    const other = vi.fn().mockResolvedValue(undefined)
    queue.enqueue('b', 'other', other, () => true)
    await flush()
    expect(run).not.toHaveBeenCalled()
    expect(other).toHaveBeenCalledOnce()
    ready = true
    queue.kick()
    await flush()
    expect(entries[0].error).toBe('offline')
    queue.promote(entries[0].id)
    await flush()
    expect(run).toHaveBeenCalledTimes(2)
    expect(entries).toEqual([])
  })
})

it('shows the actionable send error without Electron IPC details', () => {
  expect(messageSendError(new Error("Error invoking remote method 'douchat:send-message': Error: 调用权限尚未同步"))).toBe('调用权限尚未同步')
  expect(messageSendError('连接已断开')).toBe('连接已断开')
  expect(messageSendError(undefined)).toBe('Message not sent. Try again.')
})
