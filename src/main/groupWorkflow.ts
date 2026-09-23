import type { GroupWorkflow } from '../shared/groupWorkflow'

/** An interrupted tool-bearing reply is never automatically re-executed. */
export class GroupWorkflowJournal {
  constructor(readonly state: GroupWorkflow, private save: (value: GroupWorkflow) => void) {}
  async call<T>(key: string, kind: 'decision' | 'reply', execute: () => Promise<T>): Promise<T> {
    const existing = this.state.calls[key]
    if (existing?.status === 'done') return structuredClone(existing.value) as T
    if (existing?.status === 'running' && kind === 'reply') throw new Error('The previous attempt was interrupted at this step and may have performed external actions. Check the results and send a new explicit instruction. This step will not be repeated automatically.')
    this.state.calls[key] = { status: 'running', kind }
    this.save(this.state)
    const value = await execute()
    this.state.calls[key] = { status: 'done', kind, value }
    this.save(this.state)
    return value
  }
  finish(status: GroupWorkflow['status'], error?: string): void {
    this.state.status = status; this.state.error = error; this.save(this.state)
  }
}
