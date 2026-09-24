import type { BotGroup, GroupDecisionContext, GroupTurn } from './group'
import { sensitiveCapabilities, type SensitiveCapability } from '../agentPermissions'

export interface GroupTask {
  id: string
  memberId: string
  instruction: string
  dependsOn: string[]
  expectedOutput: string
  requiredCapabilities?: SensitiveCapability[]
  publicDeliverable?: boolean
}

/** The executor accepts a bounded graph, never executable instructions in edges. */
export function validateGroupTasks(raw: unknown, group: BotGroup, context: GroupDecisionContext): GroupTask[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 32) throw new Error('A task graph must contain 1–32 tasks')
  const ids = new Set<string>()
  const tasks = raw.map((value): GroupTask => {
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.id) || ids.has(value.id)) throw new Error('Task IDs must be unique and stable')
    if (context.completedTurns.some(turn => turn.taskId === value.id)) throw new Error('A revised graph must use new task IDs; completed work cannot be repeated.')
    ids.add(value.id)
    const member = group.members.find(member => member.id === value.memberId)
    if (!member || context.unavailableMemberIds?.includes(member.id)) throw new Error('Task graph selected an unavailable or unknown member')
    if (typeof value.instruction !== 'string' || !value.instruction.trim() || value.instruction.length > 2000
      || typeof value.expectedOutput !== 'string' || !value.expectedOutput.trim() || value.expectedOutput.length > 1000) throw new Error('Each task needs an instruction and expected output')
    if (!Array.isArray(value.dependsOn) || value.dependsOn.some((id: unknown) => typeof id !== 'string')) throw new Error('Invalid task dependencies')
    if (value.publicDeliverable != null && typeof value.publicDeliverable !== 'boolean') throw new Error('Invalid task output visibility')
    const capabilities: SensitiveCapability[] = value.requiredCapabilities ?? []
    if (!Array.isArray(capabilities) || capabilities.some(capability => !sensitiveCapabilities.includes(capability))) throw new Error('Invalid required task capabilities')
    if (capabilities.some(capability => member.routing?.permissions[capability] === 'deny')) throw new Error('Task requires a capability denied for this member')
    return { id: value.id, memberId: value.memberId, instruction: value.instruction.trim(), dependsOn: [...new Set<string>(value.dependsOn)],
      expectedOutput: value.expectedOutput.trim(), requiredCapabilities: capabilities,
      ...(value.publicDeliverable === true ? { publicDeliverable: true } : {}) }
  })
  const done = new Set<string>()
  while (done.size < tasks.length) {
    const ready = tasks.filter(task => !done.has(task.id) && task.dependsOn.every(id => done.has(id)))
    if (!ready.length) throw new Error('Task graph has a cycle, self-reference or missing dependency')
    ready.forEach(task => done.add(task.id))
  }
  return tasks
}

/** Only successful task results unlock dependent work; a member may own many nodes. */
export function readyGroupTasks(tasks: GroupTask[], completed: (GroupTurn & { memberId: string })[]): GroupTask[] {
  const done = new Set(completed.map(turn => turn.taskId).filter(Boolean))
  const owners = new Set<string>()
  return tasks.filter(task => {
    if (done.has(task.id) || owners.has(task.memberId) || !task.dependsOn.every(id => done.has(id))) return false
    owners.add(task.memberId)
    return true
  })
}

/** Deterministic task evidence survives a long transcript without another model call.
 * Only public output is included; private messages remain envelope-only. */
export function groupTaskEvidence(context: GroupDecisionContext) {
  const request = context.messages.find(message => message.id === context.requestMessageId)
    ?? [...context.messages].reverse().find(message => message.role === 'user')
  const messages = new Map(context.messages.map(message => [message.id, message]))
  return {
    request: request ? { id: request.id, content: request.content.slice(0, 12000) } : undefined,
    completedCount: context.completedTurns.length,
    completed: context.completedTurns.slice(-32).map(turn => ({
      taskId: turn.taskId, memberId: turn.memberId, assignment: turn.assignment, expectedOutput: turn.expectedOutput,
      publicMessageIds: turn.messageIds,
      publicResult: turn.messageIds.map(id => messages.get(id)?.content ?? '').join('\n').slice(0, 1000),
      publicArtifacts: turn.messageIds.flatMap(id => messages.get(id)?.artifacts ?? []),
      privateDeliveryIds: turn.privateMessageIds
    }))
  }
}

/** Stable topological order is used for journal rounds and review context, even
 * when independent nodes finish in a different order on replay. */
export function orderedGroupTasks(tasks: GroupTask[]): GroupTask[] {
  const ordered: GroupTask[] = []
  const done = new Set<string>()
  while (ordered.length < tasks.length) {
    const ready = tasks.filter(task => !done.has(task.id) && task.dependsOn.every(id => done.has(id)))
    if (!ready.length) throw new Error('The task graph is blocked by an incomplete dependency.')
    for (const task of ready) { done.add(task.id); ordered.push(task) }
  }
  return ordered
}

/** Event-driven DAG execution: a completed node immediately releases its children.
 * Started operations are always drained before returning on cancellation/failure. */
export async function executeGroupTaskGraph<T>(tasks: GroupTask[], options: {
  signal: AbortSignal
  budget: number
  run: (task: GroupTask, completed: ReadonlyMap<string, T>) => Promise<T>
}): Promise<{ results: Map<string, T>; limited: boolean }> {
  type Completion = { id: string; value: T } | { id: string; error: unknown }
  const ordered = orderedGroupTasks(tasks)
  const completed = new Map<string, T>()
  const active = new Map<string, Promise<Completion>>()
  const owners = new Set<string>()
  let started = 0
  let failure: Completion | undefined
  while (!options.signal.aborted && !failure) {
    for (const task of ordered) {
      if (active.size >= 4 || started >= options.budget) break
      if (completed.has(task.id) || active.has(task.id) || owners.has(task.memberId) || !task.dependsOn.every(id => completed.has(id))) continue
      owners.add(task.memberId)
      started++
      // A snapshot keeps node input independent of later unrelated completions.
      const inputs = new Map(completed)
      active.set(task.id, Promise.resolve().then(() => options.run(task, inputs)).then(
        value => ({ id: task.id, value }), error => {
          const result = { id: task.id, error }
          failure ??= result
          return result
        }
      ))
    }
    if (!active.size) break
    const result = await Promise.race(active.values())
    active.delete(result.id)
    owners.delete(ordered.find(task => task.id === result.id)!.memberId)
    if ('error' in result) failure = result
    else completed.set(result.id, result.value)
  }
  // No new nodes are admitted once stopped. Late successes remain journaled by
  // the caller but cannot unlock dependencies after a fatal error or cancellation.
  await Promise.all(active.values())
  if (failure && 'error' in failure) throw failure.error
  if (!options.signal.aborted && completed.size < tasks.length && started < options.budget) throw new Error('The task graph is blocked by an incomplete dependency.')
  return { results: new Map(ordered.filter(task => completed.has(task.id)).map(task => [task.id, completed.get(task.id)!])),
    limited: !options.signal.aborted && completed.size < tasks.length }
}
