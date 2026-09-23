import { addressesEveryone, mentionedMembers, type BotMember } from './mentions'
import { BOT_MESSAGE_BREAK } from './messages'
import { privateContext, type PrivateDelivery } from './privateMessages'

export type GroupMember = BotMember

export interface GroupMessage {
  id: string
  role: 'user' | 'assistant'
  sender?: { id: string; name: string }
  recipients?: { id: string; name: string }[]
  content: string
}

export interface BotGroup {
  health?: Record<string, { status: string; latencyMs?: number }>
  id: string
  name: string
  description?: string
  humanName?: string
  leadMemberId?: string
  members: GroupMember[]
}

/** Legacy groups have no saved lead; their first valid member is the stable default. */
export function groupLeadMember(group: BotGroup): GroupMember | undefined {
  return group.members.find((member) => member.id === group.leadMemberId) ?? group.members[0]
}

export interface GroupTurn {
  progress?: { completedContributions: number; publicMessageIds: string[] }
  replacesMemberId?: string
  participationOnly?: boolean
  assignment?: string
  publicDeliverable?: boolean
  waitForHuman?: boolean
  finalize?: boolean
  round: number
  delegationPlan?: Pick<GroupDecision, 'mode' | 'memberIds'>
  triggerMessageIds: string[]
  unavailableMemberIds?: string[]
}

export interface GroupReply {
  messages: GroupMessage[]
  privateMessages?: PrivateDelivery[]
  failed?: boolean
}

export interface GroupConversationResult {
  waitingForHuman?: boolean
  limited: boolean
  failed: boolean
  unavailableMemberIds: string[]
}

export interface GroupFailover {
  unavailableMemberIds: string[]
  replacementMemberId: string
}

// Execution guard only; the model decides when the conversation is complete.
export const GROUP_MAX_TURNS = 16
export const GROUP_MESSAGE_BREAK = BOT_MESSAGE_BREAK

export interface GroupDecision {
  leaderMemberId?: string
  recoveryAction?: 'skip' | 'replace' | 'pause'
  /** One contribution per selected member; absent members are skipped, never impersonated. */
  participationOnly?: boolean
  participantScope?: 'all' | 'selected'
  supervise?: boolean
  requireSummary?: boolean
  assignments?: Record<string, string>
  /** Members whose next contribution must be public; omitted means no forced public repair. */
  publicDeliverables?: string[]
  /** Recipient resolved from conversational reference, not a mentioned third party. */
  addressedMemberId?: string
  /** The leader should reply once, then wait for new human input. */
  waitForHuman?: boolean
  /** Host/setup must happen before other members receive concrete assignments. */
  leaderFirst?: boolean
  mode: 'none' | 'single' | 'parallel' | 'sequential'
  memberIds: string[]
  triggerMessageIds: string[]
}

export interface GroupDecisionContext {
  requestMessageId?: string
  recovery?: { failedMemberId: string; assignment?: string; participationOnly: boolean; triggerMessageIds: string[] }
  messages: GroupMessage[]
  privateDeliveries: Omit<PrivateDelivery, 'content'>[]
  completedTurns: (GroupTurn & { memberId: string; messageIds: string[]; privateMessageIds: string[] })[]
  unavailableMemberIds?: string[]
}

/** Validate the transport contract, never infer a recipient or a fallback. */
export function validateGroupDecision(raw: unknown, group: BotGroup, context: GroupDecisionContext): GroupDecision {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid group decision')
  const value = { ...raw } as Record<string, unknown>
  // Models can represent unused optional JSON fields with null. Treat only
  // those placeholders as absent; unknown members and real bad values still fail.
  for (const key of ['assignments', 'participantScope', 'publicDeliverables']) {
    if (value[key] === null) delete value[key]
  }
  if (value.assignments && typeof value.assignments === 'object' && !Array.isArray(value.assignments)) {
    value.assignments = Object.fromEntries(Object.entries(value.assignments).filter(([id, instruction]) =>
      !group.members.some(member => member.id === id) || instruction !== null && !(typeof instruction === 'string' && !instruction.trim())))
  }
  // Old saved plans attached outputs to roster positions. Drop those stale
  // assignments during replay; the original request and committed replies remain.
  if (value.rollCall === true) { delete value.assignments; value.participantScope = 'all' }
  delete value.rollCall
  if (value.leaderMemberId != null && (typeof value.leaderMemberId !== 'string'
    || !group.members.some(member => member.id === value.leaderMemberId)
    || context.unavailableMemberIds?.includes(value.leaderMemberId))) throw new Error('Invalid or unavailable leader')
  if (value.recoveryAction != null && !['skip', 'replace', 'pause'].includes(value.recoveryAction as string)) throw new Error('Invalid recovery action')
  if (context.recovery) {
    if (!['skip', 'replace', 'pause'].includes(value.recoveryAction as string)) throw new Error('Recovery must explicitly choose skip, replace or pause')
    if (value.recoveryAction === 'replace' && (value.mode !== 'single' || !Array.isArray(value.memberIds) || value.memberIds.length !== 1
      || context.unavailableMemberIds?.includes(value.memberIds[0]))) throw new Error('Recovery must select one available replacement')
    if (value.recoveryAction === 'replace' && context.recovery.participationOnly) throw new Error('Personal participation cannot be impersonated')
    if (value.recoveryAction === 'skip' && !context.recovery.participationOnly) throw new Error('A required deliverable cannot be silently skipped')
    if (value.recoveryAction !== 'replace' && value.mode !== 'none') throw new Error('Skip/pause must not dispatch a member')
  }
  if (value.participationOnly === true && (value.leaderFirst === true || value.waitForHuman === true || value.requireSummary === true)) throw new Error('participationOnly requires leaderFirst=false, waitForHuman=false and requireSummary=false; keep the full participant roster.')
  if (['participationOnly', 'supervise', 'requireSummary', 'waitForHuman', 'leaderFirst'].some(key => value[key] !== undefined && typeof value[key] !== 'boolean')) throw new Error('Invalid group decision flags')
  if (value.assignments !== undefined && (!value.assignments || typeof value.assignments !== 'object' || Array.isArray(value.assignments)
    || Object.entries(value.assignments).some(([id, instruction]) => !group.members.some(member => member.id === id) || typeof instruction !== 'string' || !instruction.trim() || instruction.length > 2000))) throw new Error('Invalid member assignments')
  if (value.publicDeliverables !== undefined && (!Array.isArray(value.publicDeliverables) || value.publicDeliverables.some(id => typeof id !== 'string' || !group.members.some(member => member.id === id)))) throw new Error('Invalid public deliverable members')
  if (value.participantScope !== undefined && !['all', 'selected'].includes(value.participantScope as string)) throw new Error('Invalid participant scope')
  const extras = {
    ...(value.participantScope ? { participantScope: value.participantScope as GroupDecision['participantScope'] } : {}),
    ...(Array.isArray(value.publicDeliverables) ? { publicDeliverables: [...new Set(value.publicDeliverables as string[])] } : {}),
    ...(typeof value.leaderMemberId === 'string' ? { leaderMemberId: value.leaderMemberId } : {}),
    ...(value.recoveryAction != null ? { recoveryAction: value.recoveryAction as GroupDecision['recoveryAction'] } : {}),
    ...(value.participationOnly === true ? { participationOnly: true } : {}),
    ...(value.supervise === true ? { supervise: true } : {}),
    ...(value.requireSummary === true ? { requireSummary: true } : {}),
    ...(value.assignments ? { assignments: value.assignments as Record<string, string> } : {})
  }
  const triggerMessageIds = value.triggerMessageIds
  if (!Array.isArray(triggerMessageIds) || triggerMessageIds.some((id) => typeof id !== 'string')) {
    throw new Error('Invalid group decision triggers')
  }
  if (context.completedTurns.length === 0 && value.mode !== 'none' && value.addressedMemberId !== undefined && value.addressedMemberId !== null && (
    typeof value.addressedMemberId !== 'string' || !group.members.some((member) => member.id === value.addressedMemberId)
  )) throw new Error('Invalid conversational addressee')
  if (!context.recovery && typeof value.addressedMemberId === 'string' && context.completedTurns.length === 0
    && !(['sequential', 'parallel'].includes(value.mode as string) && (value.supervise === true || value.requireSummary === true))) {
    if (context.unavailableMemberIds?.includes(value.addressedMemberId)) throw new Error('The addressed member is unavailable. Choose an available responder or leader to explain the limitation.')
    const latestUser = [...context.messages].reverse().find((message) => message.role === 'user')
    if (!latestUser) throw new Error('Missing human message')
    return { mode: 'single', memberIds: [value.addressedMemberId], triggerMessageIds: [latestUser.id], addressedMemberId: value.addressedMemberId,
      ...(value.waitForHuman === true ? { waitForHuman: true } : {}), ...extras }
  }
  if (value.waitForHuman !== undefined && typeof value.waitForHuman !== 'boolean') {
    throw new Error('Invalid group decision waitForHuman')
  }
  if (value.leaderFirst !== undefined && typeof value.leaderFirst !== 'boolean') {
    throw new Error('Invalid group decision leaderFirst')
  }
  if (!context.recovery && (value.waitForHuman === true || value.leaderFirst === true) && context.completedTurns.length === 0) {
    const lead = groupLeadMember(typeof value.leaderMemberId === 'string' ? { ...group, leadMemberId: value.leaderMemberId } : group)
    const latestUser = [...context.messages].reverse().find((message) => message.role === 'user')
    if (!lead || !latestUser) throw new Error('Missing leader or human message')
    return { mode: 'single', memberIds: [lead.id], triggerMessageIds: [latestUser.id], ...(value.waitForHuman === true ? { waitForHuman: true } : { leaderFirst: true }), ...extras }
  }
  const mode = value.mode
  const memberIds = value.memberIds
  if (
    !(['none', 'single', 'parallel', 'sequential'] as unknown[]).includes(mode) ||
    !Array.isArray(memberIds) ||
    memberIds.some((id) => typeof id !== 'string')
  ) {
    throw new Error('Invalid group decision mode')
  }
  if (mode === 'none') {
    if (memberIds.length || triggerMessageIds.length) throw new Error('Invalid empty group decision')
    return { mode, memberIds: [], triggerMessageIds: [], ...(value.waitForHuman === true ? { waitForHuman: true } : {}), ...extras }
  }
  if (
    !memberIds.length ||
    (mode === 'single' && memberIds.length !== 1) ||
    ((mode === 'parallel' || value.participationOnly === true) && new Set(memberIds).size !== memberIds.length) ||
    memberIds.some((id) => !group.members.some((member) => member.id === id))
  ) {
    throw new Error('Group decision selected an unknown member')
  }
  if (value.participationOnly !== true && memberIds.some(id => context.unavailableMemberIds?.includes(id))) throw new Error('Do not assign work to unavailable members. Choose an available replacement or an available leader to explain the limitation.')
  if (value.participantScope === 'all' && group.members.some(member => !memberIds.includes(member.id))) throw new Error('A full-group task must include the full roster, including unavailable members for explicit skips.')
  const visibleIds = new Set([
    ...context.messages.map((message) => message.id),
    ...context.privateDeliveries
      .filter((message) => memberIds.every((id) => message.sender.id === id || message.recipient.id === id))
      .map((message) => message.id)
  ])
  if (!triggerMessageIds.length || triggerMessageIds.some((id) => !visibleIds.has(id))) {
    throw new Error('Group decision selected an inaccessible message')
  }
  return {
    ...extras,
    ...(value.waitForHuman === true ? { waitForHuman: true } : {}),
    mode: mode as GroupDecision['mode'],
    memberIds: memberIds as string[],
    triggerMessageIds: [...new Set(triggerMessageIds as string[])]
  }
}

/** Explicit addressing is routing, not merely display metadata. */
export function explicitGroupDecision(content: string, group: BotGroup, triggerMessageId: string): GroupDecision | null {
  // Structural mention hints only; intent is always decided by the policy.
  const members = addressesEveryone(content) ? group.members : mentionedMembers(content, group.members)
  if (!members.length) return null
  return {
    mode: members.length === 1 ? 'single' : 'parallel',
    memberIds: members.map((member) => member.id),
    triggerMessageIds: [triggerMessageId]
  }
}

function handoffsFrom(
  messages: GroupMessage[],
  deliveries: PrivateDelivery[],
  group: BotGroup,
  alreadyScheduled: Set<string>
): { memberId: string; triggerMessageIds: string[] }[] {
  const triggers = new Map<string, Set<string>>()
  const add = (memberId: string, messageId: string, senderId?: string): void => {
    if (memberId === senderId || alreadyScheduled.has(memberId)) return
    const ids = triggers.get(memberId) ?? new Set<string>()
    ids.add(messageId)
    triggers.set(memberId, ids)
  }
  for (const message of messages) {
    for (const member of mentionedMembers(message.content, group.members)) {
      add(member.id, message.id, message.sender?.id)
    }
  }
  for (const delivery of deliveries) {
    if (delivery.intent === 'inform') continue
    if (group.members.some((member) => member.id === delivery.recipient.id)) {
      add(delivery.recipient.id, delivery.id, delivery.sender.id)
    }
  }
  return [...triggers].map(([memberId, ids]) => ({ memberId, triggerMessageIds: [...ids] }))
}

/** Single-recipient mentions bypass the controller. Group tasks remain supervised:
 * after explicit public/private handoffs settle, the coordinator checks shared
 * progress and either schedules the next step or declares the task complete. */
export async function runGroupConversation({
  group,
  user,
  history = [],
  privateMessages = [],
  signal,
  decide,
  reply,
  onFailover,
  onUnavailable,
  rankCandidates,
  configuredRouting = false,
  initiallyUnavailable = [],
  maxTurns = GROUP_MAX_TURNS
}: {
  group: BotGroup
  user: GroupMessage
  history?: GroupMessage[]
  privateMessages?: PrivateDelivery[]
  signal: AbortSignal
  decide: (context: GroupDecisionContext) => Promise<unknown>
  reply: (member: GroupMember, turn: GroupTurn, messages: GroupMessage[]) => Promise<GroupMessage[] | GroupReply>
  onFailover?: (failover: GroupFailover) => void
  onUnavailable?: (memberId: string, cached: boolean) => void
  rankCandidates?: (members: GroupMember[], assignment?: string) => GroupMember[]
  configuredRouting?: boolean
  initiallyUnavailable?: string[]
  maxTurns?: number
}): Promise<GroupConversationResult> {
  let waitingForHuman = false
  const finish = (limited = false, failed = false, unavailable = new Set<string>()): GroupConversationResult => ({
    ...(waitingForHuman ? { waitingForHuman: true } : {}),
    limited,
    failed,
    unavailableMemberIds: [...unavailable]
  })
  const unavailable = new Set<string>(initiallyUnavailable)
  const notified = new Set<string>()
  const monitoredUnavailable = new Set<string>()
  let lead = groupLeadMember(group)
  const envelope = ({ id, sender, recipient, createdAt, intent }: PrivateDelivery): Omit<PrivateDelivery, 'content'> => ({
    id,
    sender,
    recipient,
    createdAt,
    ...(intent ? { intent } : {})
  })
  const context: GroupDecisionContext = {
    requestMessageId: user.id,
    messages: [...history.filter((message) => message.id !== user.id), user],
    privateDeliveries: privateMessages.map(envelope),
    completedTurns: [],
    unavailableMemberIds: [...unavailable]
  }
  const quarantine = (memberId: string): void => {
    unavailable.add(memberId)
    context.unavailableMemberIds = [...unavailable]
    if (!notified.has(memberId)) { notified.add(memberId); onUnavailable?.(memberId, initiallyUnavailable.includes(memberId)); lead = groupLeadMember(group) }
  }
  const addressed = configuredRouting ? null : explicitGroupDecision(user.content, user.role === 'assistant' ? { ...group, members: group.members.filter((member) => member.id !== user.sender?.id) } : group, user.id)
  let decision: GroupDecision | null = null
  let supervised = !addressed
  let deferredInitialDecision: GroupDecision | undefined
  if (!decision) {
    const raw = await decide({
      ...context,
      messages: [...context.messages],
      privateDeliveries: [...context.privateDeliveries],
      completedTurns: []
    })
    if (signal.aborted) return finish()
    lead = groupLeadMember(group)
    decision = validateGroupDecision(raw, group, context)
    if (decision.supervise === true || decision.requireSummary === true
      || decision.memberIds[0] === lead?.id && Object.keys(decision.assignments ?? {}).length > 1) supervised = true
    else if (decision.addressedMemberId || decision.mode === 'single' && decision.memberIds[0] !== lead?.id) supervised = false
    if (decision.mode === 'none') {
      waitingForHuman = decision.waitForHuman === true
      return finish()
    }
    // Port termany's deferred initial route, except independent work must start
    // together (including the lead), without an extra acknowledgement round.
    if (!configuredRouting && !decision.participationOnly && !addressed && !decision.addressedMemberId && decision.mode === 'sequential' && lead && decision.memberIds[0] !== lead.id) {
      deferredInitialDecision = decision
      decision = { mode: 'single', memberIds: [lead.id], triggerMessageIds: [user.id] }
    }
  }

  let waitForHuman = decision.waitForHuman === true
  waitingForHuman = waitForHuman
  const initialPlan = deferredInitialDecision ?? decision
  const participationOnly = initialPlan.participationOnly === true
  let requireSummary = !participationOnly && (initialPlan.requireSummary === true || initialPlan.leaderFirst === true
    || !configuredRouting && (initialPlan.mode === 'sequential' && new Set(initialPlan.memberIds).size > 1
    || initialPlan.mode !== 'parallel' && initialPlan.memberIds.includes(lead?.id ?? '') && Object.keys(initialPlan.assignments ?? {}).length > 1))
  const assignments = { ...deferredInitialDecision?.assignments, ...decision.assignments }
  let publicDeliverables = new Set(initialPlan.publicDeliverables ?? [])
  let pending: { memberId: string; triggerMessageIds: string[]; unavailableMemberIds?: string[]; assignment?: string; finalize?: boolean }[] =
    decision.memberIds.map((memberId, index) => ({ memberId, triggerMessageIds: decision!.triggerMessageIds,
      ...(requireSummary && decision!.mode !== 'parallel' && decision!.memberIds.length > 1 && index === decision!.memberIds.length - 1 && memberId === lead?.id ? { finalize: true } : {}),
      ...(decision!.assignments?.[memberId] ? { assignment: decision!.assignments[memberId] } : {}) }))
  let mode = decision.mode
  while (pending.length && !signal.aborted) {
    const remaining = maxTurns - context.completedTurns.length
    if (remaining <= 0) return finish(true, false, unavailable)
    const batch = pending.slice(0, remaining)
    const truncated = batch.length < pending.length
    const scheduled = new Set(batch.map((item) => item.memberId))
    const batchMessages: GroupMessage[] = []
    const batchDeliveries: PrivateDelivery[] = []
    const execute = async (
      item: (typeof batch)[number],
      index: number,
      visible: GroupMessage[],
      member: GroupMember
    ): Promise<{ member: GroupMember; turn: GroupTurn; outcome: GroupReply }> => {
      const turn: GroupTurn = {
        ...(member.id !== item.memberId ? { replacesMemberId: item.memberId } : {}),
        ...(participationOnly ? { participationOnly: true } : {}),
        round: context.completedTurns.length + index + 1,
        ...(waitForHuman ? { waitForHuman: true } : {}),
        triggerMessageIds: item.triggerMessageIds,
        ...(item.assignment || assignments[item.memberId] ? { assignment: item.assignment ?? assignments[item.memberId] } : {}),
        ...(participationOnly && mode === 'sequential' ? { progress: { completedContributions: context.completedTurns.length,
          publicMessageIds: context.completedTurns.flatMap(completed => completed.messageIds) } } : {}),
        ...(item.finalize ? { finalize: true } : {}),
        ...(deferredInitialDecision ? { delegationPlan: { mode: deferredInitialDecision.mode, memberIds: deferredInitialDecision.memberIds } } : {}),
        ...(item.unavailableMemberIds?.length ? { unavailableMemberIds: item.unavailableMemberIds } : {})
      }
      if (unavailable.has(member.id)) return { member, turn, outcome: { messages: [], failed: true } }
      if (publicDeliverables.has(item.memberId)) turn.publicDeliverable = true
      const rawOutcome = await reply(member, turn, visible)
      const outcome = Array.isArray(rawOutcome) ? { messages: rawOutcome } : rawOutcome
      return { member, turn, outcome }
    }
    const record = ({ member, turn, outcome }: Awaited<ReturnType<typeof execute>>): boolean => {
      if (outcome.failed) return false
      const replies = outcome.messages
      const deliveries = outcome.privateMessages ?? []
      context.messages.push(...replies)
      context.privateDeliveries.push(...deliveries.map(envelope))
      context.completedTurns.push({
        ...turn,
        memberId: member.id,
        messageIds: replies.map((message) => message.id),
        privateMessageIds: deliveries.map((message) => message.id)
      })
      if (member.id === lead?.id && turn.unavailableMemberIds?.length) {
        turn.unavailableMemberIds.forEach((memberId) => monitoredUnavailable.add(memberId))
      }
      batchMessages.push(...replies)
      batchDeliveries.push(...deliveries)
      return true
    }
    const candidatesFor = (memberId: string, attempted = new Set<string>(), assignment?: string): GroupMember[] => {
      const preferred = group.members.find((member) => member.id === memberId)
      const others = group.members.filter((member) => member.id !== memberId)
      return [...(preferred ? [preferred] : []), ...(participationOnly ? [] : rankCandidates?.(others, assignment) ?? others)].filter(
        (member) => !unavailable.has(member.id) && !attempted.has(member.id)
      )
    }
    const executeWithFailover = async (
      item: (typeof batch)[number],
      index: number,
      visible: GroupMessage[],
      initial?: Awaited<ReturnType<typeof execute>>
    ): Promise<Awaited<ReturnType<typeof execute>> | undefined> => {
      if (configuredRouting) {
        // Cached absences need neither another execution nor another policy call
        // for personal attendance. The initial policy already chose this roster.
        if (participationOnly && initiallyUnavailable.includes(item.memberId)) {
          quarantine(item.memberId)
          monitoredUnavailable.add(item.memberId)
          return undefined
        }
        let outcome = initial
        let target = group.members.find(member => member.id === item.memberId)
        if (!outcome && target && !unavailable.has(target.id)) outcome = await execute(item, index, visible, target)
        if (outcome && !outcome.outcome.failed) return outcome
        quarantine(outcome?.member.id ?? item.memberId)
        while (!signal.aborted) {
          const recoveryContext: GroupDecisionContext = { ...context,
            messages: [...context.messages], completedTurns: [...context.completedTurns],
            recovery: { failedMemberId: outcome?.member.id ?? item.memberId, assignment: item.assignment ?? assignments[item.memberId], participationOnly, triggerMessageIds: item.triggerMessageIds } }
          const recovery = validateGroupDecision(await decide(recoveryContext), group, recoveryContext)
          lead = groupLeadMember(group)
          monitoredUnavailable.add(recoveryContext.recovery!.failedMemberId)
          if (signal.aborted) return undefined
          if (recovery.recoveryAction === 'skip') return undefined
          if (recovery.recoveryAction === 'pause') throw new Error('The decision requires a pause: no member can safely take over.')
          target = group.members.find(member => member.id === recovery.memberIds[0])
          if (!target || unavailable.has(target.id)) throw new Error('The decision selected an unavailable replacement.')
          outcome = await execute({ ...item, unavailableMemberIds: [...unavailable] }, index, visible, target)
          if (!outcome.outcome.failed) return outcome
          quarantine(target.id)
        }
        return undefined
      }
      const attempted = new Set<string>()
      const failedMemberIds: string[] = []
      let result = initial
      if (unavailable.has(item.memberId)) quarantine(item.memberId)
      if (result) {
        attempted.add(result.member.id)
        if (!result.outcome.failed) return result
        quarantine(result.member.id)
        failedMemberIds.push(result.member.id)
      }
      while (!signal.aborted) {
        const member = candidatesFor(item.memberId, attempted, item.assignment ?? assignments[item.memberId])[0]
        if (!member) return result
        attempted.add(member.id)
        result = await execute({ ...item, unavailableMemberIds: [...unavailable] }, index, visible, member)
        if (!result.outcome.failed) {
          if (failedMemberIds.length) {
            onFailover?.({ unavailableMemberIds: failedMemberIds, replacementMemberId: member.id })
            lead = groupLeadMember(group)
          }
          return result
        }
        quarantine(member.id)
        failedMemberIds.push(member.id)
      }
      return result
    }

    if (mode === 'parallel') {
      const visible = [...context.messages]
      const initial: Awaited<ReturnType<typeof execute>>[] = new Array(batch.length)
      let cursor = 0
      await Promise.all(Array.from({ length: Math.min(4, batch.length) }, async () => {
        while (cursor < batch.length && !signal.aborted) {
          const index = cursor++
          const item = batch[index]
          const member = group.members.find((candidate) => candidate.id === item.memberId)!
          initial[index] = await execute(item, index, visible, member)
        }
      }))
      if (signal.aborted) return finish(false, false, unavailable)
      for (const result of initial) if (result.outcome.failed) quarantine(result.member.id)
      for (const result of initial) {
        if (result.outcome.failed) continue
        record(result)
        scheduled.add(result.member.id)
      }
      let unrecovered = false
      for (let index = 0; index < initial.length; index += 1) {
        const first = initial[index]
        if (!first.outcome.failed) continue
        const result = await executeWithFailover(batch[index], 0, [...context.messages], first)
        if (signal.aborted) return finish(false, false, unavailable)
        if (!result || !record(result)) unrecovered ||= !participationOnly
        else scheduled.add(result.member.id)
      }
      if (unrecovered) return finish(false, true, unavailable)
    } else {
      for (let index = 0; index < batch.length; index += 1) {
        const item = batch[index]
        const result = await executeWithFailover(item, 0, [...context.messages])
        if (signal.aborted) return finish(false, false, unavailable)
        if (!result || !record(result)) {
          if (participationOnly) continue
          return finish(false, true, unavailable)
        }
        scheduled.add(result.member.id)
        // A planned later member may receive a public/private handoff from an
        // earlier member. Preserve that delivery as an explicit trigger.
        const upcoming = new Map(batch.slice(index + 1).map((entry) => [entry.memberId, entry]))
        const completed = new Set(batch.slice(0, index + 1).map((entry) => entry.memberId))
        completed.add(result.member.id)
        const outcome = result.outcome
        for (const handoff of handoffsFrom(outcome.messages, outcome.privateMessages ?? [], group, completed)) {
          const planned = upcoming.get(handoff.memberId)
          if (planned)
            planned.triggerMessageIds = [...new Set([...planned.triggerMessageIds, ...handoff.triggerMessageIds])]
        }
      }
    }
    if (waitForHuman) return finish(false, false, unavailable)
    if (participationOnly) return finish(false, context.completedTurns.length === 0, unavailable)
    if (batch.some(item => item.finalize)) return finish(false, false, unavailable)
    if (truncated) return finish(true, false, unavailable)
    pending = handoffsFrom(batchMessages, batchDeliveries, group, scheduled)
    if (deferredInitialDecision) {
      const deferred = deferredInitialDecision
      deferredInitialDecision = undefined
      const handoffs = new Map(pending.map((item) => [item.memberId, item.triggerMessageIds]))
      const planned = new Set(deferred.memberIds)
      const additional = pending.filter((item) => !planned.has(item.memberId))
      pending = deferred.memberIds.map((memberId, index) => ({
        memberId,
        ...(requireSummary && index === deferred.memberIds.length - 1 && memberId === lead?.id ? { finalize: true } : {}),
        ...(deferred.assignments?.[memberId] ? { assignment: deferred.assignments[memberId] } : {}),
        triggerMessageIds: [...new Set([...deferred.triggerMessageIds, ...(handoffs.get(memberId) ?? [])])]
      }))
      pending.push(...additional)
      mode = deferred.mode === 'single' && additional.length ? 'sequential' : deferred.mode
      continue
    }
    // Public/private handoffs can return to the leader without another planner
    // call. Mark that final turn once the declared specialists have delivered.
    if (requireSummary && pending.at(-1)?.memberId === lead?.id
      && context.completedTurns.some(turn => turn.memberId !== lead?.id)
      && Object.keys(assignments).filter(id => id !== lead?.id).every(id => unavailable.has(id) || context.completedTurns.some(turn => turn.memberId === id))) {
      pending[pending.length - 1].finalize = true
    }
    const requiredContributors = [...new Set([
      ...Object.keys(assignments),
      ...(initialPlan.mode === 'sequential' ? initialPlan.memberIds : [])
    ])].filter(id => id !== lead?.id)
    if (!pending.length && supervised && requireSummary && lead && !unavailable.has(lead.id) && requiredContributors.length
      && requiredContributors.every(id => unavailable.has(id) || context.completedTurns.some(turn => turn.memberId === id))) {
      pending = [{ memberId: lead.id, triggerMessageIds: [user.id, ...batchMessages.map(message => message.id)], finalize: true,
        ...(unavailable.size ? { unavailableMemberIds: [...unavailable] } : {}) }]
      mode = 'single'
      continue
    }
    let failureCoordination: string[] = []
    if (!pending.length) {
      const unmonitored = [...unavailable].filter((memberId) => !monitoredUnavailable.has(memberId))
      if (!configuredRouting && unmonitored.length && lead && !unavailable.has(lead.id)) {
        unmonitored.forEach((memberId) => monitoredUnavailable.add(memberId))
        pending = [
          {
            memberId: lead.id,
            triggerMessageIds: [...new Set([user.id, ...batchMessages.map((message) => message.id)])],
            unavailableMemberIds: unmonitored
          }
        ]
        mode = 'single'
        continue
      }
      // A broken lead cannot supervise publicly. Give the isolated controller
      // one failover-enabled chance to select a healthy recovery owner.
      failureCoordination = unmonitored
      failureCoordination.forEach((memberId) => monitoredUnavailable.add(memberId))
    }
    if ((configuredRouting && pending.length) || (!pending.length && (supervised || failureCoordination.length))) {
      const raw = await decide({
        ...context,
        messages: [...context.messages],
        privateDeliveries: [...context.privateDeliveries],
        completedTurns: [...context.completedTurns]
      })
      if (signal.aborted) return finish(false, false, unavailable)
      const next = validateGroupDecision(raw, group, context)
      lead = groupLeadMember(group)
      Object.assign(assignments, next.assignments)
      publicDeliverables = new Set(next.publicDeliverables ?? [])
      waitForHuman = next.waitForHuman === true
      waitingForHuman = waitForHuman
      requireSummary ||= next.requireSummary === true
      if (next.mode === 'none') {
        if (waitForHuman) return finish(false, false, unavailable)
        if (requireSummary && lead && !unavailable.has(lead.id) && context.completedTurns.some(turn => turn.memberId !== lead?.id) && !context.completedTurns.some(turn => turn.finalize)) {
          pending = [{ memberId: lead.id, triggerMessageIds: [user.id, ...batchMessages.map(message => message.id)], finalize: true }]
          mode = 'single'
          continue
        }
        return finish(false, false, unavailable)
      }
      pending = next.memberIds.map((memberId, index) => ({
        memberId,
        ...(requireSummary && next.mode !== 'parallel' && !waitForHuman && context.completedTurns.some(turn => turn.memberId !== lead?.id)
          && index === next.memberIds.length - 1 && memberId === lead?.id ? { finalize: true } : {}),
        triggerMessageIds: next.triggerMessageIds,
        ...(next.assignments?.[memberId] ? { assignment: next.assignments[memberId] } : {}),
        ...(failureCoordination.length ? { unavailableMemberIds: failureCoordination } : {})
      }))
      mode = next.mode
      continue
    }
    mode = pending.length > 1 ? 'sequential' : 'single'
  }
  return finish(false, false, unavailable)
}

/** Coordination is isolated from the lead member's ordinary reply sessions. */
export function groupTopicSessionId(groupId: string, topicId: string): string {
  return `group:${encodeURIComponent(groupId)}:topic:${encodeURIComponent(topicId)}`
}

export function groupControllerSessionId(groupId: string, topicId: string): string {
  return `${groupTopicSessionId(groupId, topicId)}:controller`
}

/** A group member never reuses the bot's private session or another group's. */
export function groupMemberSessionId(groupId: string, botId: string, topicId: string): string {
  return `${groupTopicSessionId(groupId, topicId)}:bot:${encodeURIComponent(botId)}`
}

function sharedGroupMessages(
  messages: GroupMessage[],
  triggerMessageIds: string[] = []
): { role: string; speaker?: string; speakerId?: string; id: string; to: string; content?: string }[] {
  let remaining = 48_000
  const selected = new Map<string, string>()
  const latestUser = [...messages].reverse().find((message) => message.role === 'user')
  const include = (message: GroupMessage): void => {
    if (selected.has(message.id) || !message.content.trim() || remaining <= 0) return
    const content = message.content.slice(0, Math.min(12_000, remaining))
    remaining -= content.length
    selected.set(message.id, content)
  }
  if (latestUser) include(latestUser)
  const triggers = new Set(triggerMessageIds)
  for (const message of [...messages].reverse()) if (triggers.has(message.id)) include(message)
  for (const message of [...messages].reverse()) include(message)
  return messages
    .filter((message) => selected.has(message.id))
    .map((message) => ({
      role: message.role,
      // A transcript role is not a display name or an addressable group member.
      speaker: message.role === 'assistant' ? message.sender?.name : undefined,
      speakerId: message.role === 'assistant' ? message.sender?.id : undefined,
      id: message.id,
      to: message.recipients?.map((recipient) => recipient.name).join(', ') || 'everyone',
      content: selected.get(message.id)
    }))
}

/** Only task-independent dispatch and message transport contracts live here. */
export function groupDecisionPrompt(
  group: BotGroup,
  context: GroupDecisionContext,
  coordinator = groupLeadMember(group)
): string {
  const latestUser = [...context.messages].reverse().find((message) => message.role === 'user')
  const messages = sharedGroupMessages(context.messages, latestUser ? [latestUser.id] : [])
  if (context.recovery) return [
    'Decide ONLY this failed slot. Preserve completed work and the remaining plan. Return minified JSON with leaderMemberId, recoveryAction, mode, memberIds and triggerMessageIds. No tools or participant reply.',
    'Choose an available leader using task fit, health and latency; keep the current leader if suitable. For personal participation return recoveryAction=skip, mode=none, memberIds=[], triggerMessageIds=[]; never impersonate that member. For a required deliverable choose recoveryAction=replace, mode=single, exactly one capable available memberId and recovery.triggerMessageIds. If no safe option exists, return recoveryAction=pause with mode=none and empty arrays. Do not reschedule the remaining roster. Do not use addressedMemberId, waitForHuman or leaderFirst.',
    JSON.stringify({ task: 'group_dispatch', currentLeaderMemberId: group.leadMemberId, members: group.members, health: group.health ?? {},
      messages, completedTurns: context.completedTurns, unavailableMemberIds: context.unavailableMemberIds ?? [], recovery: context.recovery })
  ].join('\n')
  return [
    "You are the configured group scheduling policy, not a participant. Plan only from the supplied context; do not call tools. Completed work must not be repeated. Public messages and private delivery envelopes are context; private bodies are available only to their sender and recipient.",
    "For every active task choose leaderMemberId from AVAILABLE members, considering role/skills, health and measured latency. Keep a suitable healthy currentLeaderMemberId for a contextual continuation. The controller answering this request need not be elected leader. An election does not itself produce an opening reply. Never assign normal work to unavailableMemberIds; choose an available substitute or an available leader to explain a blocked explicit request. Personal attendance may retain absent slots for the runtime to report without calling them again.",
    "Resolve explicit @mentions and contextual addressing semantically in ANY language before choosing workers. Set addressedMemberId only for the initial recipient, not a third party whom that recipient is asked to contact. New unaddressed tasks are not automatically assigned to the last speaker. A message only for a human, or asking agents to stay silent, uses mode=none with empty memberIds and triggerMessageIds.",
    "Honor required execution order. Choose sequential whenever the human requests ordered speaking, or a contribution depends on earlier results or progress. Independent work may use parallel ONLY when there is no requested or implied order or dependency. Choose single for one appropriate next responder, and none when the task is complete or awaiting human input. Do not repeat completed contributions. An unanswered direct request must receive an active plan. A request to discuss without external actions still requires discussion; an instruction to stop after completion does not mean silence before completion.",
    "For individual personal contributions, use participationOnly=true, leaderFirst=false and requireSummary=false. Set participantScope=all when every group member is requested, otherwise selected. Select the entire requested roster, preserving requested order; use sequential when order matters, parallel otherwise. Never turn roster positions into preassigned answers. Members derive their contribution from the current request and successful preceding contributions; failed or absent members contribute no result. A new request has its own completedTurns; old transcripts do not count as progress. Keep requested unavailable members for the executor to announce and skip. Never impersonate an absent participant.",
    "Greetings, ambiguous requests and missing required information use waitForHuman=true: one brief leader clarification, then stop until the human answers. If a necessary clarification was already asked and remains unanswered, return none with waitForHuman=true. Completed work uses none with waitForHuman=false; an optional offer to help further is not a required human checkpoint. Never invent the human response. On their answer, continue the full earlier task and all requested participants.",
    "For collaborative deliverables with known requirements, return the COMPLETE plan, normally sequential specialists then leader, with concrete assignments, supervise=true and requireSummary=true. Include all explicitly requested contributors. An acknowledgement or handoff is not a deliverable. The final leader slot must consolidate actual results. No extra opening is automatically inserted. When the human explicitly requests clarification/approval first, ask before planning workers.",
    "If a task needs coordination, prerequisites or confidential setup, use leaderFirst=true and schedule only the elected leader now. Then assign work through concrete public or private handoffs. If members can independently complete the request without preparation, dispatch the requested contributors immediately. Do not add an opening or summary unless the task needs one.",
    "Set publicDeliverables to the IDs of members whose next assigned contribution MUST be public. Interpret confidentiality and recipient intent semantically in ANY language. Exclude private-only contact, secret setup and confidential tasks. An empty array is valid. Never require disclosure of private data merely because the request lacks English privacy keywords.",
    "Return minified JSON using exact roster and accessible message IDs. Fields: leaderMemberId; mode (none/single/parallel/sequential); ordered memberIds; triggerMessageIds (empty only for none); waitForHuman (always boolean); optional addressedMemberId, leaderFirst, participationOnly, participantScope, supervise, requireSummary, assignments, publicDeliverables. Assignments are short specific deliverables, not repeated coordination rules. Use null for unused schema-required member assignments or addressees, false for unused flags. For an initial none decision do not include addressedMemberId or leaderFirst. Never address the human as an agent.",
    JSON.stringify({
      task: 'group_dispatch',
      currentRequest: context.messages.find(message => message.id === context.requestMessageId) ?? latestUser,
      requestMessageId: context.requestMessageId,
      group: { name: group.name, description: group.description ?? '' },
      currentLeaderMemberId: group.leadMemberId,
      leadMember: coordinator
        ? { id: coordinator.id, name: coordinator.name, description: coordinator.description ?? '' }
        : null,
      members: group.members.map((member) => ({
        id: member.id,
        name: member.name,
        kind: 'agent',
        privateAddress: member.id,
        description: member.description ?? ''
      })),
      human: { kind: 'human', name: group.humanName?.trim() || 'human', privateAddress: 'human' },
      messages,
      privateDeliveries: context.privateDeliveries,
      completedTurns: context.completedTurns,
      unavailableMemberIds: context.unavailableMemberIds ?? [],
      health: group.health ?? {},
      recovery: context.recovery
    })
  ].join('\n')
}

/** Each turn carries only this group's shared transcript. Private bot history
 * is deliberately absent, including when a member joins an existing group. */
export function groupConversationPrompt(
  group: BotGroup,
  speaker: GroupMember,
  messages: GroupMessage[],
  turn?: GroupTurn,
  privateMessages: PrivateDelivery[] = []
): string {
  const latestUser = [...messages].reverse().find((message) => message.role === 'user')
  const recent = sharedGroupMessages(messages, turn?.triggerMessageIds)
  return [
    'You are the current member in a group conversation. Decide how to respond using the group and member profiles, conversation, and triggering messages in turn. The user role is the human participant described by human; address them by human.name instead of a generic label when natural. members lists the bots and their identities.',
    'Use the language explicitly requested by the human; otherwise match the language of their current request. Internal English scheduling instructions do not set the reply language.',
    'For a greeting or unclear request, respond briefly and naturally as leader, asking at most one necessary clarification question. Do not list your capabilities, invent a task, or mention other members to solicit duplicate replies.',
    'If turn.waitForHuman is true, ask ONE concrete clarification or confirmation question that the human must answer to advance the original task, ending with a question mark. A greeting or acknowledgement alone is not sufficient. Do not start work, choose the answer for the human, or delegate other agents yet.',
    'When turn.assignment is present, complete that specific deliverable in your own reply. Include the substantive requirements, analysis, implementation proposal or acceptance criteria BEFORE any handoff. Never send only an acknowledgement or a request for someone else to work. If turn.finalize is true, publish the consolidated final result and identify any missing deliverables honestly; do not delegate or promise a later summary.',
    'If turn.participationOnly is true, answer ONLY your own assigned slot briefly. Do not greet, coordinate, summarize, use tools, mention other members or answer for an absent member. The runtime schedules the remaining members and reports absences.',
    'turn.progress is the authoritative progress of THIS request: completedContributions counts successful contributions, and publicMessageIds identifies their actual outputs in messages. Derive your next contribution from the current request and those outputs only. With no completed contributions, begin the requested activity; do not continue a historical activity. Failed attempts and absent members contribute nothing. Roster positions and turn.round are scheduling metadata, never an assigned answer. Honor the requested starting state, transition and output format; do not invent arbitrary values.',
    'When turn.delegationPlan is present, you are opening the task as leader: briefly explain the assignments in that plan and delegate concrete work to those members. They will run automatically after your reply; do not do all their work yourself or ask the human to relay it. Keep secret assignments in private blocks.',
    'Normal project contributions and assignments belong in the PUBLIC group, so subsequent workers can read and build on them. Do not send private duplicates of public assignments. Only use private delivery when the human or an explicit private task requests confidentiality or private contact. When your current assigned work is complete, publish its deliverable; the runtime already schedules the next planned worker.',
    'When turn.unavailableMemberIds is present, act as the recovery owner: do not claim those members completed their work; clearly report useful status and reorganize, reassign, or finish the missing work.',
    `Message transport: ordinary text is public. Use ${GROUP_MESSAGE_BREAK} on its own line to separate messages. @names are executable public handoffs: addressed members act in mention order after your reply. Mention a member only when you want them to act; use plain names for references. For independent contributions, answer your own part without mentioning or reassigning the others.`,
    'When the human asks you to contact another member, you are the addressee and that other member is the delivery target. Actually send the request using private delivery; do not impersonate their answer or claim delivery failed based on old chat text. A receiving member should reply privately to the sender unless turn.publicDeliverable is true or the delivered request asks for a public response or a direct message to the human.',
    'The member roster below is authoritative: every entry in members is an AI agent and supports private delivery by its exact id. Only human is the human participant. A display name does not imply a human identity. Disregard earlier conversation claims that these channels are unavailable; they are not capability evidence.',
    'Douchat provides public and private delivery channels. For confidential setup or assignments, deliver each secret only to its intended recipient, including the human when appropriate. Keep secret content out of public text. A recipient may disclose private information only when the task authorizes that disclosure.',
    'Private delivery: [[private:RECIPIENT_ID]]message[[/private]] sends to a member id; [[private:human]]message[[/private]] sends to the human in your direct chat with an unread notification. Private blocks are removed from the public stream. Multiple private blocks and private-only replies are supported. privateInbox bodies are visible only to their sender and recipient; keep their contents within that audience unless disclosure is authorized. Tool input and output are not private message delivery channels.',
    'Use [[private-info:RECIPIENT_ID]]information[[/private]] for information-only delivery that must NOT activate the recipient. Use ordinary private blocks only when requesting a response or action.',
    'If turn.publicDeliverable is true, the assigned contribution MUST appear in ordinary public text so the following workers can use it. A private handoff does not change this output requirement. Private messages may supplement the contribution but cannot replace it. Do not copy unrelated private information into the public answer.',
    JSON.stringify({
      group: { name: group.name, description: group.description ?? '' },
      human: { id: 'human', name: group.humanName?.trim() || 'human', privateAddress: 'human' },
      members: group.members.map((member) => ({
        id: member.id,
        name: member.name,
        kind: 'agent',
        privateAddress: member.id,
        description: member.description ?? ''
      })),
      mentionTargets: group.members
        .filter((member) => member.id !== speaker.id && member.name.trim())
        .map((member) => ({ id: member.id, name: member.name })),
      leadMember: groupLeadMember(group),
      currentBot: { id: speaker.id, name: speaker.name, isLead: groupLeadMember(group)?.id === speaker.id },
      turn,
      originalRequest: latestUser ? latestUser.content.slice(0, 12_000) : undefined,
      messages: recent,
      privateInbox: privateContext(privateMessages, speaker.id, turn?.triggerMessageIds)
    })
  ].join('\n')
}
