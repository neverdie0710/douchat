/** One lease per owned CLI process, retained until that process has closed. */
export class LocalProcessBudget {
  private used = 0
  private readonly waiting: Array<{ grant: () => void; cancel: () => void }> = []
  constructor(private readonly limit: number) {}
  get hasWaiters(): boolean { return this.waiting.length > 0 }
  acquire(signal?: AbortSignal, pressure?: () => void): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const remove = () => {
        const index = this.waiting.indexOf(waiter)
        if (index >= 0) this.waiting.splice(index, 1)
        signal?.removeEventListener('abort', waiter.cancel)
      }
      const waiter = {
        grant: () => {
          remove()
          this.used++
          let released = false
          resolve(() => {
            if (released) return
            released = true
            this.used--
            this.waiting[0]?.grant()
          })
        },
        cancel: () => { remove(); reject(signal?.reason ?? new Error('Stopped')) }
      }
      if (signal?.aborted) { waiter.cancel(); return }
      if (this.used < this.limit) { waiter.grant(); return }
      this.waiting.push(waiter)
      signal?.addEventListener('abort', waiter.cancel, { once: true })
      pressure?.()
    })
  }
}
