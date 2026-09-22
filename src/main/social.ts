import { agentPermissions } from '../shared/agentPermissions'
import { addressesEveryone, mentionedMembers } from '../shared/bot/mentions'
import type { AgentConfig, ChatMessage, MessageAttachment, MessageImageInput } from '../shared/types'
import { randomUUID } from 'node:crypto'
import type { DesktopAuth } from './desktopAuth'
import type { DouchatStore } from './store'
import type { DouchatRuntime } from './runtime'
import type { SocialAction, SocialAgent, SocialResult, SocialSnapshot, SocialTask, SocialMessage, SocialImage } from '../shared/social'

interface InboxDelivery {
  snapshot: SocialSnapshot
  pages: Record<string, SocialResult & { after: { time: string; id: string }; pending: string[] }>
}
const overlapCursor = (cursor: { time: string; id: string }) => ({ time: new Date(Math.max(0, Date.parse(cursor.time) - 5000)).toISOString(), id: '' })

/**
 * Keep private contact data out of renderer state unless the signed-in user is
 * allowed to see it. The service remains the primary privacy boundary; this is
 * a second boundary for older service responses and cached room membership.
 */
export function privacySafeSocialSnapshot(snapshot: SocialSnapshot): SocialSnapshot {
  const emailVisibleTo = new Set([
    snapshot.userId,
    ...snapshot.friendships.filter((friendship) => friendship.status === 'accepted').map((friendship) => friendship.person.id)
  ])
  const protectPerson = (person: SocialSnapshot['rooms'][number]['members'][number]) =>
    emailVisibleTo.has(person.id) || !person.email ? person : { ...person, email: '' }

  return {
    ...snapshot,
    friendships: snapshot.friendships.map((friendship) => ({ ...friendship, person: protectPerson(friendship.person) })),
    rooms: snapshot.rooms.map((room) => ({ ...room, members: room.members.map(protectPerson) }))
  }
}

export function sharedGroupReplyTargets(content: string, ownAgents: SocialAgent[], history: ChatMessage[]): string[] {
  if (addressesEveryone(content)) return ownAgents.map((agent) => agent.id)
  // Only continue a reply to this account's message, never another person's exchange.
  let speaker: string | undefined
  for (const message of [...history].reverse()) {
    if (message.kind !== 'message' || message.error) continue
    if (message.authorId === 'user') {
      const addressed = mentionedMembers(message.text, ownAgents)
      if (addressed.length === 1) return [addressed[0].id]
      return speaker ? [speaker] : ownAgents.slice(0, 1).map((agent) => agent.id)
    }
    if (!ownAgents.some((agent) => agent.id === message.authorId)) break
    speaker ??= message.authorId
  }
  return ownAgents.slice(0, 1).map((agent) => agent.id)
}

function sharedAgentProfile(agent: AgentConfig) {
  const permissions = agentPermissions(agent.permissions)
  return { interactionHumans: permissions.groupHumans, interactionAgents: permissions.groupAgents, name: agent.name, avatar: agent.avatar ?? '', avatarEmoji: agent.avatarEmoji ?? '',
    avatarSeed: agent.avatarSeed ?? '', color: agent.color, localAgentId: agent.localAgentId ?? '',
    systemRole: agent.systemRole ?? '' }
}

/** Tokens and execution claims never cross the preload boundary. */
export class SocialClient {
  private timer?: ReturnType<typeof setTimeout>
  private abort?: AbortController
  private generation = 0
  private inboxTimer?: ReturnType<typeof setTimeout>
  private syncing?: Promise<SocialSnapshot>
  private roomSync = new Map<string, { revision?: string; cursor: { time: string; id: string }; pending: Set<string>; checkedAt: number; auditedAt: number }>()
  private pendingSends = new Map<string, { content: string; signature: string; id: string }>()
  constructor(private url: string, private auth: DesktopAuth, private store: DouchatStore, private runtime: DouchatRuntime, private onInboxChanged: () => void = () => {}) {}
  private identity() {
    const state = this.auth.getState()
    const token = this.auth.getAccessToken()
    if (state.status !== 'signed-in' || !token) throw new Error('请先登录。')
    return { id: state.user.id, token }
  }
  private async request<T>(body?: object, identity = this.identity(), signal?: AbortSignal): Promise<T> {
    const response = await fetch(new URL('/api/desktop-auth/social', this.url), {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${identity.token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000)
    })
    const current = this.identity()
    if (current.id !== identity.id || current.token !== identity.token) throw new Error('账号已切换，请重试。')
    if (response.status === 401) { await this.auth.invalidateSession(); throw new Error('登录已过期，请重新登录。') }
    const payload = await response.json().catch(() => null)
    if (!response.ok || payload?.data === undefined) throw new Error(payload?.message || '聊天服务连接失败，请稍后重试。')
    return payload.data as T
  }
  async snapshot(): Promise<SocialSnapshot> { return privacySafeSocialSnapshot(await this.request()) }
  syncInbox(fresh = false, delivery?: InboxDelivery): Promise<SocialSnapshot> {
    if (this.syncing) return fresh || delivery
      ? this.syncing.catch(() => undefined).then(() => this.syncInbox())
      : this.syncing
    const generation = this.generation
    const signal = this.abort?.signal
    const work = async () => {
      const identity = this.identity()
      const snapshot = privacySafeSocialSnapshot(delivery?.snapshot ?? await this.request<SocialSnapshot>(undefined, identity, signal))
      if (snapshot.userId !== identity.id) throw new Error('Chat account mismatch')
      const queue = [...snapshot.rooms]
      const syncRoom = async (room: SocialSnapshot['rooms'][number]) => {
        const stateKey = `${identity.id}:${room.id}`
        const previous = snapshot.syncVersion === 1 ? this.roomSync.get(stateKey) : undefined
        if (previous && room.revision && previous.revision === room.revision && Date.now() - previous.checkedAt < 30000) return
        const cursor = previous ? { ...previous.cursor } : { time: '1970-01-01T00:00:00.000Z', id: '' }
        const pending = new Set(previous?.pending ?? [])
        for (const remote of room.agents.filter((agent) => agent.ownerId === identity.id)) {
          const agent = this.store.accountAgents.find((item) => item.id === remote.localId)
          if (!agent) continue
          const profile = sharedAgentProfile(agent)
          if (!Object.entries(profile).some(([key, value]) => (!key.startsWith('interaction') || snapshot.permissionsVersion === 1) && ((remote as unknown as Record<string, unknown>)[key] ?? '') !== value)) continue
          // Only update an existing membership, never resurrect one removed on another device.
          try {
            const result = await this.request<{ agent?: typeof remote }>({ action: 'update-agent', roomId: room.id, localId: agent.id, ...profile }, identity, signal)
            if (result.agent) Object.assign(remote, result.agent)
          } catch { /* Older/offline services keep the last profile; retry on the next sync. */ }
        }
        const local = this.store.accountConversations.find((conversation) => conversation.remoteRoomId === room.id)
        const known = new Set(local ? [...this.store.topicMessages(local.id, local.activeTopicId).map((message) => message.id), ...this.store.socialClearedMessageIds(local.id)] : [])
        const incoming: SocialMessage[] = []
        const incremental = previous && Date.now() - previous.auditedAt < 300000
        if (incremental) {
          // Replay a small overlap so equal timestamps and transaction commit
          // ordering cannot drop messages at the cursor boundary.
          const fetchCursor = overlapCursor(cursor)
          let prefetched = delivery?.pages?.[room.id]
          let hasMore = true
          const pendingIds = [...pending]
          do {
            const chunk = pendingIds.splice(0, 200)
            const page = prefetched && prefetched.after.time === fetchCursor.time && prefetched.after.id === fetchCursor.id && JSON.stringify(prefetched.pending) === JSON.stringify(chunk)
              ? prefetched
              : await this.request<SocialResult>({ action: 'messages', roomId: room.id, after: fetchCursor, pending: chunk }, identity, signal)
            prefetched = undefined
            const batch = page.messages ?? []
            incoming.push(...batch, ...(page.updates ?? []))
            const last = batch.at(-1)
            if (last) { fetchCursor.time = last.createdAt; fetchCursor.id = last.id }
            hasMore = Boolean(page.hasMore && last)
          } while (hasMore || pendingIds.length)
        } else {
          let before: string | undefined
          for (;;) {
            const page = await this.request<SocialResult>({ action: 'messages', roomId: room.id, before }, identity, signal)
            const batch = page.messages || []
            incoming.push(...batch)
            if (!page.hasMore || !batch.length || (snapshot.syncVersion !== 1 && batch.some((message) => known.has(`${local?.id}:${message.id}`)))) break
            before = batch[0].id
          }
        }
        for (const message of incoming) {
          if (message.createdAt > cursor.time || (message.createdAt === cursor.time && message.id > cursor.id)) { cursor.time = message.createdAt; cursor.id = message.id }
          if (message.status === 'pending' || message.status === 'running') pending.add(message.id)
          else pending.delete(message.id)
        }
        const attachments = new Map<string, MessageAttachment[]>()
        for (const message of new Map(incoming.map((message) => [message.id, message])).values()) {
          for (const [id, images] of [[message.id, message.images], [`${message.id}:reply`, message.replyImages]] as const) {
            if (!images?.length || known.has(`${local?.id}:${id}`)) continue
            const saved: MessageAttachment[] = []
            for (const image of images) {
              if (this.identity().id !== identity.id || this.store.currentAccountId !== identity.id) throw new Error('Chat account mismatch')
              saved.push(await this.store.saveImageAttachment({ ...image, data: Buffer.from(image.base64, 'base64') }, identity.id))
            }
            attachments.set(id, saved)
          }
        }
        if (generation !== this.generation || this.identity().id !== identity.id) throw new Error('Chat account mismatch')
        this.store.syncFriendConversation(identity.id, room, incoming, attachments)
        if (snapshot.syncVersion === 1) this.roomSync.set(stateKey, { revision: room.revision, cursor, pending, checkedAt: Date.now(), auditedAt: incremental ? previous.auditedAt : Date.now() })
        this.onInboxChanged()
      }
      // One slow room must not hold up all the others; keep concurrency bounded.
      const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
        let failure: unknown
        for (;;) {
          const room = queue.shift()
          if (!room) break
          try { await syncRoom(room) } catch (error) { failure = error }
        }
        if (failure) throw failure
      })
      const results = await Promise.allSettled(workers)
      const failed = results.find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
      return snapshot
    }
    const current = work().finally(() => { if (this.syncing === current) this.syncing = undefined })
    this.syncing = current
    return current
  }

  async sendMessage(conversationId: string, content: string, inputImages?: MessageImageInput[]): Promise<void> {
    const identity = this.identity()
    const conversation = this.store.accountConversations.find((item) => item.id === conversationId)
    if (!conversation?.remoteRoomId || conversation.ownerId !== identity.id) throw new Error('Chat not found')
    if (!Array.isArray(inputImages ?? []) || (inputImages?.length ?? 0) > 4) throw new Error('Invalid image attachments')
    let total = 0
    const images = (inputImages ?? []).map((image) => {
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(image.mimeType) || !ArrayBuffer.isView(image.data) || !image.data.byteLength || image.data.byteLength > 8 * 1024 * 1024) throw new Error('Invalid image attachment')
      total += image.data.byteLength
      if (total > 20 * 1024 * 1024) throw new Error('Images must total 20 MB or less.')
      return { name: image.name, mimeType: image.mimeType, base64: Buffer.from(image.data).toString('base64') }
    })
    const room = conversation.socialRoom
    const mentioned = mentionedMembers(content, room?.agents ?? [])
    const blocked = mentioned.find((agent) => agent.ownerId !== identity.id && (!agent.interactionHumans || agent.interactionHumans === 'deny'))
    if (blocked) throw new Error(blocked.interactionHumans === 'deny'
      ? `「${blocked.name}」的主人未开放群成员调用，请联系主人调整 Agent 权限。`
      : `「${blocked.name}」的调用权限尚未同步，请主人更新并重新连接 Douchat 后再试。`)
    if (conversation.socialRoom && images.length) throw new Error('群聊暂不支持图片。')
    const ownAgents = room?.agents.filter((agent) => agent.ownerId === identity.id) ?? []
    const addressedPeople = mentionedMembers(content, room?.members ?? [])
    const everyone = room?.agents.filter((agent) => agent.ownerId === identity.id || agent.interactionHumans === 'allow' || agent.interactionHumans === 'ask') ?? []
    const agentIds = addressesEveryone(content) ? everyone.map((agent) => agent.id) : mentioned.length ? mentioned.map((agent) => agent.id) : addressedPeople.length ? []
      : sharedGroupReplyTargets(content, ownAgents, this.store.topicMessages(conversation.id, conversation.activeTopicId))
    const agentId = agentIds[0]
    const signature = JSON.stringify([content, images, agentIds])
    const key = `${identity.id}:${conversationId}`
    let pending = this.pendingSends.get(key)
    if (pending?.signature !== signature) {
      pending = { content, signature, id: randomUUID() }
      this.pendingSends.set(key, pending)
    }
    const localId = `${conversationId}:${pending!.id}`
    const existing = this.store.topicMessages(conversationId, conversation.activeTopicId).find((message) => message.id === localId)
    if (!existing) {
      const attachments = await Promise.all((inputImages ?? []).map((image) => this.store.saveImageAttachment(image, identity.id)))
      if (this.identity().id !== identity.id) throw new Error('Chat account mismatch')
      this.store.addMessage({ id: localId, conversationId, topicId: conversation.activeTopicId,
        authorId: 'user', authorName: 'You', text: content, kind: 'message',
        deliveryState: 'sending', ...(attachments.length ? { attachments } : {}) })
    } else this.store.setMessageDeliveryState(localId, 'sending')
    this.onInboxChanged()
    try {
      await this.request({ action: 'send', roomId: conversation.remoteRoomId, content, images, agentId, agentIds, id: pending!.id }, identity)
      this.pendingSends.delete(key)
      this.store.setMessageDeliveryState(localId)
    } catch (error) {
      this.store.setMessageDeliveryState(localId, 'failed')
      throw error
    } finally {
      this.onInboxChanged()
    }
    // The local bubble is already visible; inbox refresh must not block sending.
    void this.syncInbox().catch(() => { /* The next inbox poll recovers confirmed delivery. */ })
  }
  async action(input: SocialAction): Promise<SocialResult> {
    const allowed = ['group-invite', 'rename-room', 'remove-members', 'invite-members', 'add-members', 'lookup', 'request', 'respond', 'create-room', 'add-agent', 'remove-agent', 'messages', 'send']
    if (!input || !allowed.includes(input.action)) throw new Error('不支持的操作。')
    if (input.action === 'group-invite') {
      const conversation = this.store.accountConversations.find((item) => item.id === input.conversationId)
      if (!conversation || conversation.type !== 'group') throw new Error('Chat not found')
      if (!conversation.remoteRoomId) await this.action({ action: 'invite-members', conversationId: conversation.id, friendIds: [], agentIds: [] })
      const roomId = this.store.accountConversations.find((item) => item.id === conversation.id)?.remoteRoomId
      if (!roomId) throw new Error('Chat could not be shared')
      const result = await this.request<SocialResult>({ action: 'group-invite', roomId, regenerate: Boolean(input.regenerate) })
      if (!result.invite) throw new Error('Invitation could not be created')
      const url = new URL('/join-group', this.url)
      url.searchParams.set('room', roomId)
      url.searchParams.set('token', result.invite.token)
      return { ...result, invite: { ...result.invite, url: url.toString() } }
    }
    if (input.action === 'remove-members' || input.action === 'rename-room') {
      const result = await this.request<SocialResult>(input)
      await this.syncInbox(true)
      return result
    }
    if (input.action === 'invite-members') {
      const identity = this.identity()
      const conversation = this.store.accountConversations.find((item) => item.id === input.conversationId)
      if (!conversation || conversation.type !== 'group') throw new Error('Chat not found')
      const localIds = conversation.socialRoom ? input.agentIds : [...new Set([...conversation.agentIds, ...input.agentIds])]
      const agents = localIds.map((id) => this.store.claimSocialAgent(id, identity.id))
      let roomId = conversation.remoteRoomId
      if (!roomId) {
        if (this.runtime.snapshot().activity.some((activity) => activity.conversationId === conversation.id)) throw new Error('请等当前回复完成后再邀请好友。')
        const result = await this.request<SocialResult>({ action: 'create-room', kind: 'group', name: conversation.name, friendIds: input.friendIds, clientId: conversation.id }, identity)
        if (!result.roomId) throw new Error('Chat could not be created')
        roomId = result.roomId
        this.store.linkSharedGroup(conversation.id, roomId)
      }
      if (input.friendIds.length) await this.request({ action: 'add-members', roomId, friendIds: input.friendIds }, identity)
      for (const agent of agents) await this.request({ action: 'add-agent', roomId, localId: agent.id, ...sharedAgentProfile(agent) }, identity)
      await this.syncInbox(true)
      return { roomId, conversationId: conversation.id }
    }
    if (input.action === 'add-agent') {
      const agent = this.store.claimSocialAgent(input.localId, this.identity().id)
      return this.request({ ...input, ...sharedAgentProfile(agent) })
    }
    if (input.action === 'create-room') {
      const result = await this.request<SocialResult>(input)
      if (!result.roomId) throw new Error('Chat could not be created')
      // An in-flight poll may have fetched its room list before this room existed.
      await this.syncInbox(true)
      const conversation = this.store.accountConversations.find((item) => item.remoteRoomId === result.roomId)
      if (!conversation) throw new Error('Chat could not be synchronized')
      return { ...result, conversationId: conversation.id }
    }
    return this.request(input)
  }
  private heartbeatTimer?: ReturnType<typeof setTimeout>
  private activeTask?: { localId: string; taskId: string }
  start(): void {
    this.stop()
    const generation = this.generation
    this.abort = new AbortController()
    const signal = this.abort.signal
    const heartbeat = async () => {
      try {
        const identity = this.identity()
        const active = this.activeTask
        const approvals = active && this.runtime.snapshot().permissionRequests?.some((request) => request.agentId === active.localId) ? [active] : []
        await this.request({ action: 'heartbeat', localIds: this.store.agents.filter((agent) => agent.ownerId === identity.id).map((agent) => agent.id), approvals }, identity, signal)
      } catch { /* Older services and offline devices do not advertise presence. */ }
      finally { if (!signal.aborted && generation === this.generation) this.heartbeatTimer = setTimeout(() => void heartbeat(), 10000) }
    }
    void heartbeat()
    let delivery: InboxDelivery | undefined
    const sync = async () => {
      let delay = 2000
      try {
        const incoming = delivery
        delivery = undefined
        const snapshot = await this.syncInbox(false, incoming)
        if (signal.aborted || generation !== this.generation) return
        if (snapshot.syncVersion === 1) {
          const versions = Object.fromEntries(snapshot.rooms.map((room) => [room.id, room.revision ?? '']))
          const identity = this.identity()
          const cursors = Object.fromEntries(snapshot.rooms.flatMap((room) => {
            const state = this.roomSync.get(`${identity.id}:${room.id}`)
            return state && state.pending.size <= 200 ? [[room.id, { after: overlapCursor(state.cursor), pending: [...state.pending] }]] : []
          }))
          const result = await this.request<Partial<InboxDelivery>>({ action: 'watch', versions, includeMessages: true, cursors }, identity, signal)
          if (result.snapshot && result.pages) delivery = { snapshot: result.snapshot, pages: result.pages }
          delay = 0
        }
      } catch { /* Polling is the fallback when notification requests fail. */ }
      finally { if (generation === this.generation) this.inboxTimer = setTimeout(() => void sync(), delay) }
    }
    void sync()
    const poll = async (): Promise<void> => {
      try {
        const identity = this.identity()
        for (const result of this.store.socialTaskOutbox().filter((item) => item.ownerId === identity.id)) {
          await this.request({ action: 'complete', ...result }, identity)
          this.store.removeSocialTaskResult(result.id, identity.id)
        }
        const { tasks } = await this.request<{ tasks: (SocialTask & { localId?: string })[] }>({ action: 'tasks', localIds: this.store.agents.filter((agent) => agent.ownerId === identity.id).map((agent) => agent.id) }, identity)
        for (const pending of tasks) {
          if (signal.aborted) break
          // Tasks for an agent on another computer remain queued there.
          if (pending.localId && this.store.agent(pending.localId)?.ownerId !== identity.id) continue
          const { task } = await this.request<{ task: SocialTask | null }>({ action: 'claim', id: pending.id }, identity)
          if (!task) continue
          this.store.saveSocialTaskResult({ id: task.id, ownerId: identity.id, claim: task.claim, failed: true, reply: '设备在执行期间中断，任务未自动重试。请确认执行结果后再派发新任务。' })
          let reply: string
          let images: SocialImage[] | undefined
          let failed = false
          try {
            if (signal.aborted || task.ownerId !== identity.id || task.agent.ownerId !== identity.id) throw new Error('任务权限校验失败。')
            this.activeTask = { localId: task.agent.localId, taskId: task.id }
            const output = await this.runtime.executeSocialTask(identity.id, task.agent.localId, task.id, task.content, signal, task.context, {
              requesterId: task.authorId, requester: task.authorName, requesterAgentId: task.requesterAgentId, roomName: task.roomName ?? '',
              delegate: async (agentId, content) => { await this.request({ action: 'delegate', taskId: task.id, claim: task.claim, agentId, content }, identity, signal) }
            })
            reply = output.text
            images = output.images
          } catch (error) { failed = true; reply = error instanceof Error ? error.message : '任务执行失败。' }
          finally { this.activeTask = undefined }
          const result = { id: task.id, ownerId: identity.id, claim: task.claim, reply: reply.slice(0, 32000), ...(images?.length ? { images } : {}), failed }
          this.store.saveSocialTaskResult(result)
          if (!signal.aborted) {
            try {
              await this.request({ action: 'complete', ...result }, identity)
              this.store.removeSocialTaskResult(task.id, identity.id)
            } catch { /* The durable outbox retries publication without rerunning work. */ }
          }
        }
      } catch { /* Offline/sign-out does not interrupt local chats. The UI shows request errors. */ }
      finally { if (generation === this.generation) this.timer = setTimeout(() => { void poll() }, 2500) }
    }
    void poll()
  }
  stop(): void {
    this.generation++
    clearTimeout(this.heartbeatTimer)
    this.activeTask = undefined
    clearTimeout(this.timer)
    clearTimeout(this.inboxTimer)
    this.abort?.abort()
    this.abort = undefined
    this.syncing = undefined
    this.pendingSends.clear()
    this.roomSync.clear()
  }
}
