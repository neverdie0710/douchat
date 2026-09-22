/** Strip Electron transport wrappers while retaining the actionable error. */
export function messageSendError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : ''
  return message.replace(/^Error invoking remote method ['"][^'"\n]+['"]:\s*/i, '').replace(/^(?:Error:\s*)+/i, '').trim() || '消息未发送，请重试。'
}

export interface QueuedMessage {
  id: number
  conversationId: string
  text: string
  error?: string
}
interface Entry extends QueuedMessage {
  run: () => Promise<void>
  ready: () => boolean
}

/** Pending messages stay editable by queue controls until their own turn starts. */
export class MessageQueue {
  private nextId = 0
  private entries: Entry[] = []
  private running = new Set<string>()
  constructor(private changed: (entries: QueuedMessage[]) => void) {}
  private publish(): void { this.changed(this.entries.map(({ id, conversationId, text, error }) => ({ id, conversationId, text, error }))) }
  enqueue(conversationId: string, text: string, run: () => Promise<void>, ready: () => boolean): void {
    this.entries.push({ id: ++this.nextId, conversationId, text, run, ready })
    this.publish()
    this.kick()
  }
  remove(id: number): void {
    this.entries = this.entries.filter((entry) => entry.id !== id)
    this.publish()
    this.kick()
  }
  promote(id: number): void {
    const entry = this.entries.find((item) => item.id === id)
    if (!entry) return
    entry.error = undefined
    this.entries = [entry, ...this.entries.filter((item) => item.id !== id)]
    this.publish()
    this.kick()
  }
  kick(): void {
    for (const conversationId of new Set(this.entries.map((entry) => entry.conversationId))) {
      if (this.running.has(conversationId)) continue
      const entry = this.entries.find((item) => item.conversationId === conversationId)!
      if (entry.error || !entry.ready()) continue
      this.entries = this.entries.filter((item) => item !== entry)
      this.running.add(conversationId)
      this.publish()
      void Promise.resolve().then(entry.run).catch((cause: unknown) => {
        entry.error = messageSendError(cause)
        this.entries.unshift(entry)
      }).finally(() => {
        this.running.delete(conversationId)
        this.publish()
        this.kick()
      })
    }
  }
}
