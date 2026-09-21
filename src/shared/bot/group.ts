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
  messages: GroupMessage[]
  privateDeliveries: Omit<PrivateDelivery, 'content'>[]
  completedTurns: (GroupTurn & { memberId: string; messageIds: string[]; privateMessageIds: string[] })[]
  unavailableMemberIds?: string[]
}

/** Validate the transport contract, never infer a recipient or a fallback. */
export function validateGroupDecision(raw: unknown, group: BotGroup, context: GroupDecisionContext): GroupDecision {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid group decision')
  const value = raw as Record<string, unknown>
  const triggerMessageIds = value.triggerMessageIds
  if (!Array.isArray(triggerMessageIds) || triggerMessageIds.some((id) => typeof id !== 'string')) {
    throw new Error('Invalid group decision triggers')
  }
  if (value.addressedMemberId !== undefined && (
    typeof value.addressedMemberId !== 'string' || !group.members.some((member) => member.id === value.addressedMemberId)
  )) throw new Error('Invalid conversational addressee')
  if (typeof value.addressedMemberId === 'string' && context.completedTurns.length === 0) {
    const latestUser = [...context.messages].reverse().find((message) => message.role === 'user')
    if (!latestUser) throw new Error('Missing human message')
    return { mode: 'single', memberIds: [value.addressedMemberId], triggerMessageIds: [latestUser.id], addressedMemberId: value.addressedMemberId }
  }
  if (value.waitForHuman !== undefined && typeof value.waitForHuman !== 'boolean') {
    throw new Error('Invalid group decision waitForHuman')
  }
  if (value.leaderFirst !== undefined && typeof value.leaderFirst !== 'boolean') {
    throw new Error('Invalid group decision leaderFirst')
  }
  if ((value.waitForHuman === true || value.leaderFirst === true) && context.completedTurns.length === 0) {
    const lead = groupLeadMember(group)
    const latestUser = [...context.messages].reverse().find((message) => message.role === 'user')
    if (!lead || !latestUser) throw new Error('Missing leader or human message')
    return { mode: 'single', memberIds: [lead.id], triggerMessageIds: [latestUser.id], ...(value.waitForHuman === true ? { waitForHuman: true } : { leaderFirst: true }) }
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
    return { mode, memberIds: [], triggerMessageIds: [] }
  }
  if (
    !memberIds.length ||
    (mode === 'single' && memberIds.length !== 1) ||
    (mode === 'parallel' && new Set(memberIds).size !== memberIds.length) ||
    memberIds.some((id) => !group.members.some((member) => member.id === id))
  ) {
    throw new Error('Group decision selected an unknown member')
  }
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
    mode: mode as GroupDecision['mode'],
    memberIds: memberIds as string[],
    triggerMessageIds: [...new Set(triggerMessageIds as string[])]
  }
}

/** Explicit addressing is routing, not merely display metadata. */
export function explicitGroupDecision(content: string, group: BotGroup, triggerMessageId: string): GroupDecision | null {
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
  maxTurns?: number
}): Promise<GroupConversationResult> {
  const finish = (limited = false, failed = false, unavailable = new Set<string>()): GroupConversationResult => ({
    limited,
    failed,
    unavailableMemberIds: [...unavailable]
  })
  const unavailable = new Set<string>()
  const monitoredUnavailable = new Set<string>()
  const lead = groupLeadMember(group)
  const envelope = ({ id, sender, recipient, createdAt }: PrivateDelivery): Omit<PrivateDelivery, 'content'> => ({
    id,
    sender,
    recipient,
    createdAt
  })
  const context: GroupDecisionContext = {
    messages: [...history.filter((message) => message.id !== user.id), user],
    privateDeliveries: privateMessages.map(envelope),
    completedTurns: [],
    unavailableMemberIds: []
  }
  const quarantine = (memberId: string): void => {
    unavailable.add(memberId)
    context.unavailableMemberIds = [...unavailable]
  }
  const addressed = explicitGroupDecision(user.content, user.role === 'assistant' ? { ...group, members: group.members.filter((member) => member.id !== user.sender?.id) } : group, user.id)
  if (user.role === 'assistant' && !addressed) return finish()
  // A single explicit recipient owns the turn. Multiple recipients still need
  // dependency-aware planning: @all can mean either jokes or an ordered review.
  let decision = user.role === 'assistant' && addressed
    ? { ...addressed, mode: addressed.memberIds.length > 1 ? 'sequential' as const : 'single' as const }
    : addressed?.mode === 'single' ? addressed : null
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
    decision = validateGroupDecision(raw, group, context)
    if (decision.leaderFirst || decision.addressedMemberId) supervised = false
    if (decision.mode === 'none') {
      if (!lead) return finish(false, true)
      decision = addressed ?? { mode: 'single', memberIds: [lead.id], triggerMessageIds: [user.id] }
    }
    // Port termany's deferred initial route, except independent work must start
    // together (including the lead), without an extra acknowledgement round.
    if (!addressed && !decision.addressedMemberId && decision.mode !== 'parallel' && lead && decision.memberIds[0] !== lead.id) {
      deferredInitialDecision = decision
      decision = { mode: 'single', memberIds: [lead.id], triggerMessageIds: [user.id] }
    }
  }

  const waitForHuman = decision.waitForHuman === true
  let pending: { memberId: string; triggerMessageIds: string[]; unavailableMemberIds?: string[] }[] =
    decision.memberIds.map((memberId) => ({ memberId, triggerMessageIds: decision!.triggerMessageIds }))
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
        round: context.completedTurns.length + index + 1,
        triggerMessageIds: item.triggerMessageIds,
        ...(deferredInitialDecision ? { delegationPlan: { mode: deferredInitialDecision.mode, memberIds: deferredInitialDecision.memberIds } } : {}),
        ...(item.unavailableMemberIds?.length ? { unavailableMemberIds: item.unavailableMemberIds } : {})
      }
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
    const candidatesFor = (memberId: string, attempted = new Set<string>()): GroupMember[] => {
      const preferred = group.members.find((member) => member.id === memberId)
      return [...(preferred ? [preferred] : []), ...group.members.filter((member) => member.id !== memberId)].filter(
        (member) => !unavailable.has(member.id) && !attempted.has(member.id)
      )
    }
    const executeWithFailover = async (
      item: (typeof batch)[number],
      index: number,
      visible: GroupMessage[],
      initial?: Awaited<ReturnType<typeof execute>>
    ): Promise<Awaited<ReturnType<typeof execute>> | undefined> => {
      const attempted = new Set<string>()
      const failedMemberIds: string[] = []
      let result = initial
      if (result) {
        attempted.add(result.member.id)
        if (!result.outcome.failed) return result
        quarantine(result.member.id)
        failedMemberIds.push(result.member.id)
      }
      while (!signal.aborted) {
        const member = candidatesFor(item.memberId, attempted)[0]
        if (!member) return result
        attempted.add(member.id)
        result = await execute({ ...item, unavailableMemberIds: [...unavailable] }, index, visible, member)
        if (!result.outcome.failed) {
          if (failedMemberIds.length) {
            onFailover?.({ unavailableMemberIds: failedMemberIds, replacementMemberId: member.id })
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
      const initial = await Promise.all(
        batch.map((item, index) => {
          const member = group.members.find((candidate) => candidate.id === item.memberId)!
          return execute(item, index, visible, member)
        })
      )
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
        if (!result || !record(result)) unrecovered = true
        else scheduled.add(result.member.id)
      }
      if (unrecovered) return finish(false, true, unavailable)
    } else {
      for (let index = 0; index < batch.length; index += 1) {
        const item = batch[index]
        const result = await executeWithFailover(item, 0, [...context.messages])
        if (signal.aborted) return finish(false, false, unavailable)
        if (!result || !record(result)) return finish(false, true, unavailable)
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
    if (truncated) return finish(true, false, unavailable)
    pending = handoffsFrom(batchMessages, batchDeliveries, group, scheduled)
    if (deferredInitialDecision) {
      const deferred = deferredInitialDecision
      deferredInitialDecision = undefined
      const handoffs = new Map(pending.map((item) => [item.memberId, item.triggerMessageIds]))
      const planned = new Set(deferred.memberIds)
      const additional = pending.filter((item) => !planned.has(item.memberId))
      pending = deferred.memberIds.map((memberId) => ({
        memberId,
        triggerMessageIds: [...new Set([...deferred.triggerMessageIds, ...(handoffs.get(memberId) ?? [])])]
      }))
      pending.push(...additional)
      mode = deferred.mode === 'single' && additional.length ? 'sequential' : deferred.mode
      continue
    }
    let failureCoordination: string[] = []
    if (!pending.length) {
      const unmonitored = [...unavailable].filter((memberId) => !monitoredUnavailable.has(memberId))
      if (unmonitored.length && lead && !unavailable.has(lead.id)) {
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
    if (!pending.length && (supervised || failureCoordination.length)) {
      const raw = await decide({
        ...context,
        messages: [...context.messages],
        privateDeliveries: [...context.privateDeliveries],
        completedTurns: [...context.completedTurns]
      })
      if (signal.aborted) return finish(false, false, unavailable)
      const next = validateGroupDecision(raw, group, context)
      if (next.mode === 'none') return finish(false, false, unavailable)
      pending = next.memberIds.map((memberId) => ({
        memberId,
        triggerMessageIds: next.triggerMessageIds,
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
  return [
    "You are the lead member supervising this group task. Inspect the request, member profiles, shared results, and completed turns. Choose single for one best next worker, parallel for independent next steps, sequential when later members should see earlier work, or none only when the user's task is complete and the shared transcript already contains a user-facing final result (or when no reply is appropriate). Never repeat completed work. For multi-member work that needs a unified answer, schedule specialists first and the lead member last to consolidate and verify their results. The human participant is identified by human.name. This is a coordination decision, not a participant reply. Use only the supplied context; do not call tools.",
    'Before choosing workers, resolve who the human is addressing from the recent conversation. A contextual “you/你” normally refers to the member the human is replying to, not a third party named inside the request. For example, after 阿喵 speaks, “那你给豆博士发个消息，让他给我讲个笑话” addresses 阿喵; 豆博士 is the requested message recipient, not the initial responder. Set addressedMemberId to the exact id of the conversational addressee, omit it when there is no clear addressee. This takes precedence over default leader routing and must not schedule the third party before an actual handoff. Do not make all new unaddressed tasks sticky to the last speaker: use this only when the request actually refers back to them. Resolve short follow-ups using context, and ask through the leader when reference is genuinely ambiguous.',
    'Default to the leader alone. For greetings, fragments, ambiguous requests, or requests missing information needed to act (for example “亲”, “在吗”, “帮我弄一下”), set waitForHuman=true. This means one brief leader reply or clarification question, then wait for a new human message. Do not invent assignments or ask every member to clarify. After any member has asked a necessary clarification question, return none: waiting for the human is a valid stopping point, not unfinished work to delegate. Use multiple members only when the request clearly needs distinct contributions or explicitly asks everyone to participate. Resolve short follow-ups from the existing conversation before deciding they are ambiguous.',
    'Distinguish eventual participation from readiness to respond NOW. If an activity needs a host, setup, rules, private assignments or an opening plan before participants can act, set leaderFirst=true, even when every member will eventually participate. For example “来玩谁是卧底吧” needs only the leader to host the opening; do not schedule other members to volunteer, repeat rules or discuss their capabilities. The runtime will then activate members only through concrete public handoffs or private deliveries from the leader. Independent requests like each person telling a joke need no setup and should remain parallel.',
    'For an unaddressed task, the lead normally responds first to own and delegate the work. Use sequential in dependency order for collaborative tasks. For independent contributions such as “大家每人讲个笑话”, select every requested member including the lead in parallel immediately; no preliminary lead acknowledgement or final summary is needed. Multiple @mentions and @all identify recipients, not execution mode: respect requested ordering and dependencies. Use single for one explicitly addressed member.',
    'Return only JSON with addressedMemberId (optional exact member id when the human contextually addresses a particular member), leaderFirst (boolean, true when hosting/setup must precede participation), waitForHuman (boolean, true for a single leader response awaiting human input), mode (none, single, parallel, or sequential), memberIds (exact member ids, ordered for sequential), and triggerMessageIds (accessible message ids they should respond to; empty only for none). Private delivery envelopes are visible here, but their bodies are available only to their sender and recipient.',
    JSON.stringify({
      task: 'group_dispatch',
      group: { name: group.name, description: group.description ?? '' },
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
      unavailableMemberIds: context.unavailableMemberIds ?? []
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
    'For a greeting or unclear request, respond briefly and naturally as leader, asking at most one necessary clarification question. Do not list your capabilities, invent a task, or mention other members to solicit duplicate replies.',
    'When turn.delegationPlan is present, you are opening the task as leader: briefly explain the assignments in that plan and delegate concrete work to those members. They will run automatically after your reply; do not do all their work yourself or ask the human to relay it. Keep secret assignments in private blocks.',
    'When turn.unavailableMemberIds is present, act as the recovery owner: do not claim those members completed their work; clearly report useful status and reorganize, reassign, or finish the missing work.',
    `Message transport: ordinary text is public. Use ${GROUP_MESSAGE_BREAK} on its own line to separate messages. @names are executable public handoffs: addressed members act in mention order after your reply. Mention a member only when you want them to act; use plain names for references. For independent contributions, answer your own part without mentioning or reassigning the others.`,
    'When the human asks you to contact another member, you are the addressee and that other member is the delivery target. Actually send the request using private delivery; do not impersonate their answer or claim delivery failed based on old chat text. A receiving member should reply privately to the sender unless the delivered request asks for a public response or a direct message to the human.',
    'The member roster below is authoritative: every entry in members is an AI agent and supports private delivery by its exact id. Only human is the human participant. Names such as Dobi do not imply a human identity. Disregard earlier conversation claims that these channels are unavailable; they are not capability evidence.',
    'You have working public and private delivery channels provided by Douchat. Do not claim you can only speak publicly or ask the human to relay messages. For games requiring secret words, send each word using a private block, including the human’s word; never put those words in public text. A recipient of private information should keep it private unless the task explicitly requires a public response.',
    'Private delivery: [[private:RECIPIENT_ID]]message[[/private]] sends to a member id; [[private:human]]message[[/private]] sends to the human in your direct chat with an unread notification. Private blocks are removed from the public stream. Multiple private blocks and private-only replies are supported. privateInbox bodies are visible only to their sender and recipient; keep their contents within that audience unless disclosure is authorized. Tool input and output are not private message delivery channels.',
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
