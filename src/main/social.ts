import { addressesEveryone, mentionedMembers } from '../shared/bot/mentions'
import type { AgentConfig, ChatMessage, MessageAttachment, MessageImageInput } from '../shared/types'
import { randomUUID } from 'node:crypto'
import type { DesktopAuth } from './desktopAuth'
import type { DouchatStore } from './store'
import type { DouchatRuntime } from './runtime'
import type { SocialAction, SocialAgent, SocialResult, SocialSnapshot, SocialTask, SocialMessage } from '../shared/social'

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
  return { name: agent.name, avatar: agent.avatar ?? '', avatarEmoji: agent.avatarEmoji ?? '',
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
  private pendingSends = new Map<string, { content: string; signature: string; id: string }>()
  constructor(private url: string, private auth: DesktopAuth, private store: DouchatStore, private runtime: DouchatRuntime, private onInboxChanged: () => void = () => {}) {}
  private identity() {
    const state = this.auth.getState()
    const token = this.auth.getAccessToken()
    if (state.status !== 'signed-in' || !token) throw new Error('请先登录。')
    return { id: state.user.id, token }
  }
  private async request<T>(body?: object, identity = this.identity()): Promise<T> {
    const response = await fetch(new URL('/api/desktop-auth/social', this.url), {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${identity.token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000)
    })
    const current = this.identity()
    if (current.id !== identity.id || current.token !== identity.token) throw new Error('账号已切换，请重试。')
    if (response.status === 401) { await this.auth.invalidateSession(); throw new Error('登录已过期，请重新登录。') }
    const payload = await response.json().catch(() => null)
    if (!response.ok || payload?.data === undefined) throw new Error(payload?.message || '聊天服务连接失败，请稍后重试。')
    return payload.data as T
  }
  snapshot(): Promise<SocialSnapshot> { return this.request() }
  syncInbox(fresh = false): Promise<SocialSnapshot> {
    if (this.syncing) return fresh
      ? this.syncing.catch(() => undefined).then(() => this.syncInbox())
      : this.syncing
    const work = async () => {
      const identity = this.identity()
      const snapshot = await this.request<SocialSnapshot>(undefined, identity)
      if (snapshot.userId !== identity.id) throw new Error('Chat account mismatch')
      for (const room of snapshot.rooms) {
        for (const remote of room.agents.filter((agent) => agent.ownerId === identity.id)) {
          const agent = this.store.accountAgents.find((item) => item.id === remote.localId)
          if (!agent) continue
          const profile = sharedAgentProfile(agent)
          if (!Object.entries(profile).some(([key, value]) => ((remote as unknown as Record<string, unknown>)[key] ?? '') !== value)) continue
          // Only update an existing membership, never resurrect one removed on another device.
          try {
            const result = await this.request<{ agent?: typeof remote }>({ action: 'update-agent', roomId: room.id, localId: agent.id, ...profile }, identity)
            if (result.agent) Object.assign(remote, result.agent)
          } catch { /* Older/offline services keep the last profile; retry on the next sync. */ }
        }
        const local = this.store.accountConversations.find((conversation) => conversation.remoteRoomId === room.id)
        const known = new Set(local ? [...this.store.topicMessages(local.id, local.activeTopicId).map((message) => message.id), ...this.store.socialClearedMessageIds(local.id)] : [])
        const incoming: SocialMessage[] = []
        let before: string | undefined
        for (;;) {
          const page = await this.request<SocialResult>({ action: 'messages', roomId: room.id, before }, identity)
          const batch = page.messages || []
          incoming.push(...batch)
          if (!page.hasMore || !batch.length || batch.some((message) => known.has(`${local?.id}:${message.id}`))) break
          before = batch[0].id
        }
        const attachments = new Map<string, MessageAttachment[]>()
        for (const message of incoming) {
          if (!message.images?.length || known.has(`${local?.id}:${message.id}`)) continue
          const saved: MessageAttachment[] = []
          for (const image of message.images) {
            if (this.identity().id !== identity.id || this.store.currentAccountId !== identity.id) throw new Error('Chat account mismatch')
            saved.push(await this.store.saveImageAttachment({ ...image, data: Buffer.from(image.base64, 'base64') }, identity.id))
          }
          attachments.set(message.id, saved)
        }
        if (this.identity().id !== identity.id) throw new Error('Chat account mismatch')
        this.store.syncFriendConversation(identity.id, room, incoming, attachments)
      }
      this.onInboxChanged()
      return snapshot
    }
    this.syncing = work().finally(() => { this.syncing = undefined })
    return this.syncing
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
    if (mentioned.some((agent) => agent.ownerId !== identity.id)) throw new Error('你只能指挥自己的 agent。')
    if (conversation.socialRoom && images.length) throw new Error('群聊暂不支持图片。')
    const ownAgents = room?.agents.filter((agent) => agent.ownerId === identity.id) ?? []
    const addressedPeople = mentionedMembers(content, room?.members ?? [])
    const agentIds = mentioned.length ? mentioned.map((agent) => agent.id) : addressedPeople.length ? []
      : sharedGroupReplyTargets(content, ownAgents, this.store.topicMessages(conversation.id, conversation.activeTopicId))
    const agentId = agentIds[0]
    const signature = JSON.stringify([content, images, agentIds])
    const key = `${identity.id}:${conversationId}`
    let pending = this.pendingSends.get(key)
    if (pending?.signature !== signature) {
      pending = { content, signature, id: randomUUID() }
      this.pendingSends.set(key, pending)
    }
    await this.request({ action: 'send', roomId: conversation.remoteRoomId, content, images, agentId, ...(agentIds.length > 1 ? { agentIds } : {}), id: pending!.id }, identity)
    this.pendingSends.delete(key)
    await this.syncInbox().catch(() => { /* Confirmed delivery is recovered by the next inbox poll. */ })
  }
  async action(input: SocialAction): Promise<SocialResult> {
    const allowed = ['rename-room', 'remove-members', 'invite-members', 'add-members', 'lookup', 'request', 'respond', 'create-room', 'add-agent', 'remove-agent', 'messages', 'send']
    if (!input || !allowed.includes(input.action)) throw new Error('不支持的操作。')
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
  start(): void {
    this.stop()
    const generation = this.generation
    const sync = async () => {
      try { await this.syncInbox() } catch { /* Retry the inbox when the connection recovers. */ }
      finally { if (generation === this.generation) this.inboxTimer = setTimeout(() => void sync(), 2000) }
    }
    void sync()
    this.abort = new AbortController()
    const signal = this.abort.signal
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
          let failed = false
          try {
            if (signal.aborted || task.ownerId !== identity.id || task.authorId !== identity.id || task.agent.ownerId !== identity.id) throw new Error('任务权限校验失败。')
            reply = await this.runtime.executeSocialTask(identity.id, task.agent.localId, task.id, task.content, signal, task.context)
          } catch (error) { failed = true; reply = error instanceof Error ? error.message : '任务执行失败。' }
          const result = { id: task.id, ownerId: identity.id, claim: task.claim, reply: reply.slice(0, 32000), failed }
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
    clearTimeout(this.timer)
    clearTimeout(this.inboxTimer)
    this.abort?.abort()
    this.abort = undefined
    this.syncing = undefined
    this.pendingSends.clear()
  }
}
