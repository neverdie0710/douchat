import { GameRuleError } from '../shared/gameText'
import { agentPermissions } from '../shared/agentPermissions'
import { DEFAULT_DECISION_SETTINGS, validateDecisionSettings, type DecisionSettings } from '../shared/groupDecision'
import type { GameState } from '../shared/groupGame'
import type { GroupWorkflow } from '../shared/groupWorkflow'
import type { SocialRoom, SocialMessage } from '../shared/social'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type {
  AgentConfig,
  BuiltInAgentDefinition,
  BuiltInAgentManifest,
  BuiltInAgentUserOverrides,
  ChatMessage,
  Conversation,
  CreateGroupInput,
  CreateRoutineInput,
  MessageAttachment,
  MessageDeliveryReply,
  EmailConnectorAccount,
  PrivateMessage,
  ResolvedCreateAgentInput,
  Routine,
  RunEvent,
  RunStatus,
  TaskRun,
  Topic,
  UpdateAgentInput,
  UpdateConversationInput
} from '../shared/types'
import { normalizeAgentEmoji } from '../shared/avatar'

const DEFAULT_TOPIC_ID = 'main'

/** Roughly 1.5 MB of base64 — far above a 256px avatar, far below bloat. */
const AVATAR_LIMIT = 1_500_000
const PRIVATE_MESSAGE_LIMIT = 400
const RUN_LIMIT = 120
const RUN_EVENT_LIMIT = 600
const ACCOUNT_DEFAULT_CONTACTS_META = 'accountDefaultContacts:v1'
const BUILT_IN_MANIFEST_META_PREFIX = 'builtInAgentManifest:v1:'
const CURRENT_ACCOUNT_META = 'currentAccountId'
const DEMO_ACCOUNT_ID = 'local-demo-account'
const LEGACY_CONNECTORS_META = 'connectors:v1'
const ACCOUNT_META_PREFIX = 'account:v1:'
const LEGACY_DEMO_REMOVED_META = 'legacyDemoRemoved:v1'
const ATTACHMENT_ID = /^[0-9a-f-]{36}$/i
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const IMAGE_EXTENSION: Record<MessageAttachment['mimeType'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

function validAvatar(dataUrl: string): boolean {
  return !dataUrl || (/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl) && dataUrl.length <= AVATAR_LIMIT)
}

interface AccountDefaultContact {
  accountId: string
  agentId: string
  conversationId: string
  systemKey?: string
  cloudAgentId?: string
}

export interface DefaultCloudContactResult {
  agent?: AgentConfig
  conversation?: Conversation
  created: boolean
}

export const EMBEDDED_BUILT_IN_AGENT_MANIFEST: BuiltInAgentManifest = {
  version: 1,
  agents: [{
    id: 'system-admin-fallback',
    systemKey: 'dr-dou',
    systemRole: 'admin',
    capabilities: ['manage_agents'],
    templateVersion: 1,
    name: 'Dr. Dou',
    role: '豆博士',
    instructions:
      '你是豆博士（Dr. Dou），Douchat 的云端智能助手。友好、可靠、简洁地帮助用户解决问题、完成任务，默认使用用户正在使用的语言回复。',
    labels: 'Douchat',
    color: '#14B8A6',
    modelRoute: 'default'
  }]
}

function defaultBuiltInAgent(manifest: BuiltInAgentManifest): BuiltInAgentDefinition {
  return manifest.agents.find((agent) => agent.systemKey === 'dr-dou')
    ?? manifest.agents.find((agent) => agent.systemRole === 'admin')
    ?? EMBEDDED_BUILT_IN_AGENT_MANIFEST.agents[0]
}

function inferredBuiltInOverrides(agent: AgentConfig): BuiltInAgentUserOverrides {
  if (agent.userOverrides) return { ...agent.userOverrides }
  const fallback = defaultBuiltInAgent(EMBEDDED_BUILT_IN_AGENT_MANIFEST)
  const overrides: BuiltInAgentUserOverrides = {}
  if (agent.name !== fallback.name) overrides.name = agent.name
  if (agent.instructions !== fallback.instructions) overrides.instructions = agent.instructions
  if ((agent.labels ?? '') !== (fallback.labels ?? '')) overrides.labels = agent.labels ?? ''
  if (agent.avatar) overrides.avatar = agent.avatar
  if (agent.avatarEmoji) overrides.avatarEmoji = agent.avatarEmoji
  return overrides
}

interface DouchatStoreOptions {
  /** Retained only for orchestration fixtures that need the original demo crew. */
  seedDemo?: boolean
}

/**
 * Each table keeps the columns it is queried or ordered by, and the whole
 * record as JSON alongside them. The shared TypeScript types stay the single
 * description of a record's shape — adding an optional field never needs a
 * column or a migration — while the columns that routing and cascades depend
 * on are real, indexed, and enforced by the database.
 *
 * Insertion order is `rowid`, not `createdAt`: two messages written in the
 * same millisecond still have to come back in the order they were written.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id        TEXT PRIMARY KEY,
  createdAt INTEGER NOT NULL,
  data      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id        TEXT PRIMARY KEY,
  type      TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  data      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id             TEXT PRIMARY KEY,
  conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  topicId        TEXT NOT NULL,
  createdAt      INTEGER NOT NULL,
  data           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_topic ON messages (conversationId, topicId);

CREATE TABLE IF NOT EXISTS groupGames (
  id TEXT PRIMARY KEY,
  conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  topicId TEXT NOT NULL,
  ownerId TEXT NOT NULL,
  revision INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS groupGames_owner ON groupGames(ownerId, conversationId, topicId);

CREATE TABLE IF NOT EXISTS groupWorkflows (
  id TEXT PRIMARY KEY,
  conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  topicId TEXT NOT NULL,
  ownerId TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS privateMessages (
  id             TEXT PRIMARY KEY,
  conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  topicId        TEXT NOT NULL,
  senderId       TEXT NOT NULL,
  recipientId    TEXT NOT NULL,
  createdAt      INTEGER NOT NULL,
  data           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS private_topic ON privateMessages (conversationId, topicId);

CREATE TABLE IF NOT EXISTS routines (
  id             TEXT PRIMARY KEY,
  agentId        TEXT NOT NULL,
  conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  nextRunAt      INTEGER NOT NULL,
  data           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id        TEXT PRIMARY KEY,
  agentId   TEXT NOT NULL,
  routineId TEXT,
  createdAt INTEGER NOT NULL,
  data      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runEvents (
  id        TEXT PRIMARY KEY,
  runId     TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  createdAt INTEGER NOT NULL,
  data      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS run_events_run ON runEvents (runId);

CREATE TABLE IF NOT EXISTS attachmentOwners (
  id      TEXT PRIMARY KEY,
  ownerId TEXT NOT NULL
);
`

function newTopic(title = '', at = Date.now()): Topic {
  return { id: randomUUID(), title, createdAt: at, updatedAt: at }
}

const defaultAgents = (): AgentConfig[] => {
  const now = Date.now()
  return [
    {
      id: 'dobi',
      name: 'Dobi',
      role: 'Product lead',
      instructions:
        'Turn ambiguous requests into a crisp plan. Be direct, practical, and concise. Delegate implementation detail to the right teammate instead of writing it yourself.',
      labels: 'planning, product, coordination',
      color: '#14B8A6',
      provider: 'openai',
      model: 'gpt-5.6-terra',
      createdAt: now
    },
    {
      id: 'lin',
      name: 'Lin',
      role: 'Maker',
      instructions:
        'You are a pragmatic builder. Convert plans into concrete deliverables, call out tradeoffs, and answer with the next useful action. Keep responses compact.',
      labels: 'building, engineering, delivery',
      color: '#FF5DA8',
      provider: 'openai',
      model: 'gpt-5.6-terra',
      createdAt: now + 1
    }
  ]
}

export class DouchatStore {
  private readonly db: DatabaseSync
  private readonly statements = new Map<string, StatementSync>()
  private readonly attachmentDirectory: string

  constructor(filePath: string, options: DouchatStoreOptions = {}) {
    mkdirSync(dirname(filePath), { recursive: true })
    this.attachmentDirectory = join(dirname(filePath), 'attachments')
    mkdirSync(this.attachmentDirectory, { recursive: true })
    this.db = new DatabaseSync(filePath)
    // WAL is what makes a half-written turn survive a crash: the old JSON file
    // was rewritten whole on every message, so losing power mid-write took the
    // entire transcript with it.
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec(SCHEMA)
    this.seed(Boolean(options.seedDemo))
    if (!options.seedDemo) this.removeUnusedLegacyDemo()
    this.backfillSystemAdminRoles()
    this.backfillAgentAvatarSeeds()
    this.backfillAccountOwnership()
    this.migrateAccountSensitiveMeta()
    this.backfillAttachmentOwnership()
    this.backfillMessageSourceContent()
    this.backfillDeliveryReplies()
    this.recoverInterruptedRuns()
  }

  static atUserData(userDataPath: string): DouchatStore {
    return new DouchatStore(join(userDataPath, 'douchat.db'))
  }

  close(): void {
    this.db.close()
  }

  decisionSettings(): DecisionSettings {
    const saved = this.accountMeta('groupDecision:v1')
    return saved ? validateDecisionSettings(JSON.parse(saved)) : { ...DEFAULT_DECISION_SETTINGS }
  }

  groupHealth(conversationId: string): import('./groupHealth').GroupHealth {
    try { return JSON.parse(this.accountMeta(`groupHealth:${conversationId}`) || '{}') } catch { return {} }
  }

  saveGroupHealth(conversationId: string, health: import('./groupHealth').GroupHealth): void {
    if (this.conversation(conversationId)?.ownerId !== this.currentAccountId) return
    this.setAccountMeta(`groupHealth:${conversationId}`, JSON.stringify(health))
  }

  saveDecisionSettings(settings: DecisionSettings): DecisionSettings {
    if (!this.currentAccountId) throw new Error("Sign in first.")
    const validated = validateDecisionSettings(settings)
    this.setAccountMeta('groupDecision:v1', JSON.stringify(validated))
    return validated
  }

  groupGames(): GameState[] {
    return this.all<GameState>('SELECT data FROM groupGames WHERE ownerId = ? ORDER BY rowid', this.currentAccountId)
      .filter(game => this.conversation(game.conversationId)?.topics.some(topic => topic.id === game.topicId))
  }

  groupWorkflows(): GroupWorkflow[] {
    return this.all<GroupWorkflow>('SELECT data FROM groupWorkflows WHERE ownerId = ? ORDER BY rowid', this.currentAccountId)
      .filter(workflow => this.conversation(workflow.conversationId)?.topics.some(topic => topic.id === workflow.topicId))
  }

  saveGroupWorkflow(workflow: GroupWorkflow): void {
    if (!this.currentAccountId || this.currentAccountId !== workflow.ownerId || this.conversation(workflow.conversationId)?.ownerId !== workflow.ownerId) throw new Error("This group task does not belong to the current account.")
    if (!this.topicMessages(workflow.conversationId, workflow.topicId).some(message => message.id === workflow.user.id)) throw new Error("The original group task message was deleted.")
    workflow.updatedAt = Date.now()
    this.write('INSERT INTO groupWorkflows (id, conversationId, topicId, ownerId, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
      workflow.id, workflow.conversationId, workflow.topicId, workflow.ownerId, JSON.stringify(workflow))
  }

  groupGame(id: string): GameState | undefined {
    return this.groupGames().find(game => game.id === id)
  }

  /** State and visible messages commit together. Stale slots cannot publish twice. */
  commitGame(game: GameState, expectedRevision?: number): void {
    if (!this.currentAccountId || game.ownerId !== this.currentAccountId
      || this.conversation(game.conversationId)?.ownerId !== game.ownerId) throw new GameRuleError("The game does not belong to the current account.", game.language ?? 'zh-CN')
    this.tx(() => {
      const previous = this.one<GameState>('SELECT data FROM groupGames WHERE id = ?', game.id)
      if (!['paused', 'cancelled'].includes(game.status) && game.players.some(player => !player.human && !this.conversation(game.conversationId)?.agentIds.includes(player.id))) throw new GameRuleError("A player left the group. End this game and select players again.", game.language ?? 'zh-CN')
      if (previous ? previous.revision !== expectedRevision || game.revision !== previous.revision + 1 : expectedRevision !== undefined) throw new GameRuleError("Game state has changed.", game.language ?? 'zh-CN')
      if (previous && (previous.ownerId !== game.ownerId || previous.conversationId !== game.conversationId || previous.topicId !== game.topicId)) throw new GameRuleError("Game identity cannot be changed.", game.language ?? 'zh-CN')
      this.write('INSERT INTO groupGames (id, conversationId, topicId, ownerId, revision, data) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, data = excluded.data', game.id, game.conversationId, game.topicId, game.ownerId, game.revision, JSON.stringify(game))
      const now = Date.now()
      for (const event of game.events.slice(previous?.events.length ?? 0).filter(event => event.audience === 'group')) {
        this.insertMessage({ id: event.id, conversationId: game.conversationId, topicId: game.topicId,
          authorId: event.authorId === 'human' ? 'user' : event.authorId, authorName: event.authorName,
          text: event.text, kind: event.authorId === 'system' ? 'system' : 'message', createdAt: now })
      }
      const conversation = this.conversation(game.conversationId)!
      conversation.updatedAt = now
      this.putConversation(conversation)
    })
  }

  /** A process exit cannot leave work permanently looking active. Scheduled
   * one-time work is made eligible for one delayed retry on the next launch. */
  private recoverInterruptedRuns(): void {
    const interrupted = this.runs.filter((run) => run.status === 'queued' || run.status === 'running')
    if (!interrupted.length) return
    const now = Date.now()
    for (const run of interrupted) {
      const title = 'Douchat restarted before this task finished'
      this.updateRun(run.id, {
        status: 'failed',
        latestActivity: 'Interrupted',
        error: title,
        finishedAt: now
      })
      this.addRunEvent({ runId: run.id, type: 'status', label: title, status: 'failed', createdAt: now })
      if (!run.routineId) continue
      const routine = this.routine(run.routineId)
      if (routine?.schedule.kind === 'once' && !routine.enabled) {
        this.setRoutineEnabled(routine.id, true, now + 60_000)
      }
    }
  }

  async saveImageAttachment(input: {
    name: string
    mimeType: MessageAttachment['mimeType']
    data: Uint8Array
  }, expectedOwnerId?: string): Promise<MessageAttachment> {
    const ownerId = expectedOwnerId ?? this.currentAccountId
    if (!ownerId || ownerId !== this.currentAccountId) throw new Error('Account changed while saving the attachment')
    if (!IMAGE_EXTENSION[input.mimeType]) throw new Error('Unsupported image format')
    if (!input.data.byteLength || input.data.byteLength > MAX_IMAGE_BYTES) throw new Error('Each image must be 8 MB or smaller.')
    const id = randomUUID()
    const extension = IMAGE_EXTENSION[input.mimeType]
    const path = join(this.attachmentDirectory, `${id}.${extension}`)
    await writeFile(path, input.data, { flag: 'wx' })
    try {
      if (ownerId !== this.currentAccountId) throw new Error('Account changed while saving the attachment')
      this.write('INSERT INTO attachmentOwners (id, ownerId) VALUES (?, ?)', id, ownerId)
    } catch (cause) {
      await unlink(path).catch(() => undefined)
      throw cause
    }
    return { id, kind: 'image', name: input.name, mimeType: input.mimeType, size: input.data.byteLength }
  }

  async attachmentDataUrl(id: string): Promise<string> {
    if (!ATTACHMENT_ID.test(id)) throw new Error('Invalid attachment id')
    const owner = this.stmt('SELECT ownerId FROM attachmentOwners WHERE id = ?').get(id) as { ownerId: string } | undefined
    const accountId = this.currentAccountId
    if (!accountId || owner?.ownerId !== accountId) throw new Error('Attachment not found')
    for (const [mimeType, extension] of Object.entries(IMAGE_EXTENSION) as [MessageAttachment['mimeType'], string][]) {
      try {
        const data = await readFile(join(this.attachmentDirectory, `${id}.${extension}`))
        if (this.currentAccountId !== accountId) throw new Error('Attachment not found')
        return `data:${mimeType};base64,${data.toString('base64')}`
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
      }
    }
    throw new Error('Attachment not found')
  }

  // ───────────────────────────── plumbing ─────────────────────────────

  private stmt(sql: string): StatementSync {
    const cached = this.statements.get(sql)
    if (cached) return cached
    const prepared = this.db.prepare(sql)
    this.statements.set(sql, prepared)
    return prepared
  }

  private all<T>(sql: string, ...parameters: (string | number | null)[]): T[] {
    return this.stmt(sql)
      .all(...parameters)
      .map((row) => JSON.parse((row as { data: string }).data) as T)
  }

  private one<T>(sql: string, ...parameters: (string | number | null)[]): T | undefined {
    const row = this.stmt(sql).get(...parameters) as { data: string } | undefined
    return row ? (JSON.parse(row.data) as T) : undefined
  }

  private write(sql: string, ...parameters: (string | number | null)[]): void {
    this.stmt(sql).run(...parameters)
  }

  /** Every multi-statement change lands whole or not at all. */
  private tx<T>(work: () => T): T {
    this.db.exec('BEGIN')
    try {
      const result = work()
      this.db.exec('COMMIT')
      return result
    } catch (cause) {
      this.db.exec('ROLLBACK')
      throw cause
    }
  }

  private meta(key: string): string {
    const row = this.stmt('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? ''
  }

  private setMeta(key: string, value: string): void {
    this.write('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value)
  }

  private accountDefaultContacts(): AccountDefaultContact[] {
    try {
      const records = JSON.parse(this.meta(ACCOUNT_DEFAULT_CONTACTS_META)) as unknown
      if (!Array.isArray(records)) return []
      return records.filter((record): record is AccountDefaultContact => {
        if (!record || typeof record !== 'object') return false
        const candidate = record as Partial<AccountDefaultContact>
        return typeof candidate.accountId === 'string'
          && typeof candidate.agentId === 'string'
          && typeof candidate.conversationId === 'string'
      })
    } catch {
      return []
    }
  }

  private builtInManifest(accountId: string): BuiltInAgentManifest {
    try {
      const manifest = JSON.parse(this.meta(`${BUILT_IN_MANIFEST_META_PREFIX}${accountId}`)) as BuiltInAgentManifest
      if (
        Number.isInteger(manifest?.version)
        && manifest.version > 0
        && Array.isArray(manifest.agents)
        && manifest.agents.some((agent) => agent?.systemRole === 'admin' && agent.systemKey === 'dr-dou')
      ) return manifest
    } catch {}
    return EMBEDDED_BUILT_IN_AGENT_MANIFEST
  }

  private putConversation(conversation: Conversation): void {
    this.write(
      `INSERT INTO conversations (id, type, updatedAt, data) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET type = excluded.type, updatedAt = excluded.updatedAt, data = excluded.data`,
      conversation.id,
      conversation.type,
      conversation.updatedAt,
      JSON.stringify(conversation)
    )
  }

  private putAgent(agent: AgentConfig): void {
    this.write(
      `INSERT INTO agents (id, createdAt, data) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET createdAt = excluded.createdAt, data = excluded.data`,
      agent.id,
      agent.createdAt,
      JSON.stringify(agent)
    )
  }

  private putRoutine(routine: Routine): void {
    this.write(
      `INSERT INTO routines (id, agentId, conversationId, nextRunAt, data) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET agentId = excluded.agentId, conversationId = excluded.conversationId,
         nextRunAt = excluded.nextRunAt, data = excluded.data`,
      routine.id,
      routine.agentId,
      routine.conversationId,
      routine.nextRunAt,
      JSON.stringify(routine)
    )
  }

  private putRun(run: TaskRun): void {
    this.write(
      `INSERT INTO runs (id, agentId, routineId, createdAt, data) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET agentId = excluded.agentId, routineId = excluded.routineId,
         createdAt = excluded.createdAt, data = excluded.data`,
      run.id,
      run.agentId,
      run.routineId ?? null,
      run.createdAt,
      JSON.stringify(run)
    )
  }

  /** Replies created before source content was stored still have a matching
   * outbound delivery. Recover the closest one so existing transcripts gain
   * the same expandable private-message detail as new replies. */
  private backfillMessageSourceContent(): void {
    this.db.exec(`
      UPDATE messages AS received
      SET data = json_set(received.data, '$.source.content', (
        SELECT json_extract(delivery.value, '$.content')
        FROM messages AS sent, json_each(sent.data, '$.deliveries') AS delivery
        WHERE sent.rowid < received.rowid
          AND json_extract(sent.data, '$.authorId') = json_extract(received.data, '$.source.id')
          AND json_extract(delivery.value, '$.recipientId') = json_extract(received.data, '$.authorId')
        ORDER BY sent.rowid DESC, CAST(delivery.key AS INTEGER) DESC
        LIMIT 1
      ))
      WHERE json_extract(received.data, '$.source.kind') = 'bot'
        AND json_extract(received.data, '$.source.content') IS NULL
        AND EXISTS (
          SELECT 1
          FROM messages AS sent, json_each(sent.data, '$.deliveries') AS delivery
          WHERE sent.rowid < received.rowid
            AND json_extract(sent.data, '$.authorId') = json_extract(received.data, '$.source.id')
            AND json_extract(delivery.value, '$.recipientId') = json_extract(received.data, '$.authorId')
        )
    `)
  }

  /** Older A2A replies lived only in the recipient's direct transcript.
   * Reconnect them to the outbound delivery so the sender can read the thread
   * as a parent message followed by its replies. */
  private backfillDeliveryReplies(): void {
    const messages = this.all<ChatMessage>('SELECT data FROM messages ORDER BY rowid')
    const messagesById = new Map(messages.map((message) => [message.id, message]))
    const latestDelivery = new Map<string, { message: ChatMessage; deliveryId: string }>()
    const changed = new Map<string, ChatMessage>()
    const key = (senderId: string, recipientId: string, content: string): string =>
      `${senderId}\u0000${recipientId}\u0000${content}`

    for (const message of messages) {
      for (const delivery of message.deliveries ?? []) {
        for (const reply of delivery.replies ?? []) {
          const replyMessage = messagesById.get(reply.id)
          if (!reply.replyGroupId && replyMessage?.replyGroupId) {
            reply.replyGroupId = replyMessage.replyGroupId
            changed.set(message.id, message)
          }
        }
        latestDelivery.set(key(message.authorId, delivery.recipientId, delivery.content), {
          message,
          deliveryId: delivery.id
        })
      }
      if (message.source?.kind !== 'bot' || !message.source.content) continue
      const parent = latestDelivery.get(key(message.source.id, message.authorId, message.source.content))
      const delivery = parent?.message.deliveries?.find((candidate) => candidate.id === parent.deliveryId)
      if (!parent || !delivery || delivery.replies?.some((reply) => reply.id === message.id)) continue
      delivery.replies = [
        ...(delivery.replies ?? []),
        {
          id: message.id,
          senderId: message.authorId,
          senderName: message.authorName,
          content: message.text,
          createdAt: message.createdAt,
          replyGroupId: message.replyGroupId,
          attachments: message.attachments,
          error: message.error
        }
      ]
      changed.set(parent.message.id, parent.message)
    }

    if (!changed.size) return
    this.tx(() => {
      for (const message of changed.values()) {
        this.write('UPDATE messages SET data = ? WHERE id = ?', JSON.stringify(message), message.id)
      }
    })
  }

  /** Initialize profile metadata once. Production profiles intentionally start
   * empty; the optional demo crew exists only for focused orchestration tests. */
  private seed(includeDemo: boolean): void {
    if (this.meta('seeded') === '1') return
    this.tx(() => {
      if (!includeDemo) {
        this.setMeta('seeded', '1')
        this.setMeta('userName', 'You')
        this.setMeta(LEGACY_DEMO_REMOVED_META, '1')
        return
      }
      const agents = defaultAgents().map((agent) => ({ ...agent, ownerId: DEMO_ACCOUNT_ID }))
      const now = Date.now()
      const groupTopic = newTopic('', now)
      const dobiTopic = newTopic('', now)
      const linTopic = newTopic('', now)
      for (const agent of agents) this.putAgent(agent)

      this.putConversation({
        ownerId: DEMO_ACCOUNT_ID,
        id: 'crew',
        type: 'group',
        name: 'Dobi, Lin',
        description: 'The default crew: shape a goal together and hand the work to the right bot.',
        agentIds: agents.map((agent) => agent.id),
        leadAgentId: agents[0].id,
        topics: [groupTopic],
        activeTopicId: groupTopic.id,
        unread: 0,
        readAt: now,
        createdAt: now,
        updatedAt: now
      })
      this.putConversation({
        ownerId: DEMO_ACCOUNT_ID,
        id: 'direct-dobi',
        type: 'direct',
        name: 'Dobi',
        agentIds: ['dobi'],
        topics: [dobiTopic],
        activeTopicId: dobiTopic.id,
        unread: 0,
        readAt: now,
        createdAt: now - 120_000,
        updatedAt: now - 120_000
      })
      this.putConversation({
        ownerId: DEMO_ACCOUNT_ID,
        id: 'direct-lin',
        type: 'direct',
        name: 'Lin',
        agentIds: ['lin'],
        topics: [linTopic],
        activeTopicId: linTopic.id,
        unread: 0,
        readAt: now,
        createdAt: now - 240_000,
        updatedAt: now - 240_000
      })

      this.insertMessage({
        id: randomUUID(),
        conversationId: 'crew',
        topicId: groupTopic.id,
        authorId: 'dobi',
        authorName: 'Dobi',
        text: 'Drop a goal here. I’ll shape the plan and pull in the right bot.',
        kind: 'message',
        createdAt: now - 75_000
      })
      this.insertMessage({
        id: randomUUID(),
        conversationId: 'crew',
        topicId: groupTopic.id,
        authorId: 'lin',
        authorName: 'Lin',
        text: 'I’m ready to turn it into something you can ship.',
        kind: 'message',
        createdAt: now - 55_000
      })

      this.setMeta('seeded', '1')
      this.setMeta('userName', 'You')
      this.setMeta(CURRENT_ACCOUNT_META, DEMO_ACCOUNT_ID)
    })
  }

  /** Remove the old Dobi/Lin starter workspace only when it is still pristine.
   * Any user message, renamed contact, new group membership or automation makes
   * the migration leave it alone, so existing work is never discarded. */
  private removeUnusedLegacyDemo(): void {
    if (this.meta(LEGACY_DEMO_REMOVED_META) === '1') return
    const legacyAgentIds = new Set(['dobi', 'lin'])
    const legacyConversationIds = new Set(['crew', 'direct-dobi', 'direct-lin'])
    const expectedAgents = new Map(defaultAgents().map((agent) => [agent.id, agent]))
    const legacyAgents = this.agents.filter((agent) => legacyAgentIds.has(agent.id))
    const agentsArePristine = legacyAgents.length === 2 && legacyAgents.every((agent) => {
      const expected = expectedAgents.get(agent.id)
      return Boolean(
        expected
        && agent.name === expected.name
        && agent.role === expected.role
        && agent.instructions === expected.instructions
        && agent.labels === expected.labels
        && agent.color === expected.color
        && agent.provider === expected.provider
        && agent.model === expected.model
        && !agent.avatar
        && !agent.avatarEmoji
        && !agent.localAgentId
      )
    })
    const involvedConversations = this.conversations.filter((conversation) =>
      conversation.agentIds.some((agentId) => legacyAgentIds.has(agentId))
    )
    const conversationsArePristine = involvedConversations.every((conversation) => {
      if (
        !legacyConversationIds.has(conversation.id)
        || conversation.pinned
        || conversation.muted
        || conversation.hidden
        || conversation.manuallyUnread
        || conversation.topics.length !== 1
        || Boolean(conversation.topics[0]?.title)
      ) return false
      if (conversation.id === 'crew') {
        return conversation.type === 'group'
          && conversation.name === 'Dobi, Lin'
          && conversation.description === 'The default crew: shape a goal together and hand the work to the right bot.'
          && conversation.leadAgentId === 'dobi'
          && conversation.agentIds.join(',') === 'dobi,lin'
      }
      const agentId = conversation.id === 'direct-dobi' ? 'dobi' : 'lin'
      const expectedName = agentId === 'dobi' ? 'Dobi' : 'Lin'
      return conversation.type === 'direct'
        && conversation.name === expectedName
        && conversation.agentIds.length === 1
        && conversation.agentIds[0] === agentId
    })
    const starterTexts = new Set([
      'Drop a goal here. I’ll shape the plan and pull in the right bot.',
      'I’m ready to turn it into something you can ship.'
    ])
    const messagesArePristine = this.messages
      .filter((message) => legacyConversationIds.has(message.conversationId))
      .every((message) =>
        message.conversationId === 'crew'
        && legacyAgentIds.has(message.authorId)
        && starterTexts.has(message.text)
    )
    const hasRelatedPrivateMessages = this.privateMessages.some((message) =>
      legacyAgentIds.has(message.sender.id)
      || legacyAgentIds.has(message.recipient.id)
      || legacyConversationIds.has(message.conversationId)
    )
    const hasRelatedAutomation = this.routines.some((routine) =>
      legacyAgentIds.has(routine.agentId) || legacyConversationIds.has(routine.conversationId)
    ) || this.runs.some((run) =>
      legacyAgentIds.has(run.agentId) || legacyConversationIds.has(run.conversationId)
    )

    if (!agentsArePristine || !conversationsArePristine || !messagesArePristine || hasRelatedPrivateMessages || hasRelatedAutomation) return
    this.tx(() => {
      for (const conversationId of legacyConversationIds) {
        this.write('DELETE FROM conversations WHERE id = ?', conversationId)
      }
      for (const agentId of legacyAgentIds) this.write('DELETE FROM agents WHERE id = ?', agentId)
      this.setMeta(LEGACY_DEMO_REMOVED_META, '1')
    })
  }

  /** Assign each cloud contact one random, durable illustrated identity. This
   * also migrates contacts created before generated avatars were introduced.
   * Local agents keep their product logos and Dr. Dou keeps the built-in art. */
  private backfillAgentAvatarSeeds(): void {
    const contacts = this.agents.filter((agent) =>
      !agent.avatarSeed
      && !agent.localAgentId
      && agent.provider !== 'local'
      && agent.systemRole !== 'admin'
      && !agent.id.startsWith('dr-dou-')
    )
    if (!contacts.length) return
    this.tx(() => {
      for (const agent of contacts) {
        agent.avatarSeed = randomUUID()
        this.putAgent(agent)
      }
    })
  }

  /** Account-default contacts predate explicit capability roles. Mark every
   * surviving recorded contact at database open so migration does not depend
   * on another login event firing in the current desktop session. */
  private backfillSystemAdminRoles(): void {
    const fallback = defaultBuiltInAgent(EMBEDDED_BUILT_IN_AGENT_MANIFEST)
    const contacts = this.accountDefaultContacts()
      .map((record) => this.agent(record.agentId))
      .filter((agent): agent is AgentConfig => Boolean(agent && (
        agent.systemRole !== 'admin'
        || agent.systemKey !== fallback.systemKey
        || !agent.capabilities?.includes('manage_agents')
      )))
    if (!contacts.length) return
    this.tx(() => {
      for (const agent of contacts) {
        agent.systemRole = 'admin'
        agent.systemKey = fallback.systemKey
        agent.capabilities = [...fallback.capabilities]
        agent.templateVersion ??= fallback.templateVersion
        agent.modelRoute ??= fallback.modelRoute
        this.putAgent(agent)
      }
    })
  }

  /** Older releases stored every account in one device-wide workspace without
   * ownership fields. Recover deterministic ownership from the account's
   * system contact first, then from group membership and creation order. Data
   * that still cannot be attributed stays unowned and is hidden from every
   * signed-in account instead of leaking to whichever account logs in next. */
  private backfillAccountOwnership(): void {
    const agents = this.agents
    const conversations = this.conversations
    const routines = this.routines
    const runs = this.runs
    const agentsById = new Map(agents.map((agent) => [agent.id, agent]))
    const changedAgents = new Set<AgentConfig>()
    const accountAnchors = this.accountDefaultContacts().flatMap((record) => {
      const agent = agentsById.get(record.agentId)
      if (!agent) return []
      if (agent.ownerId !== record.accountId) {
        agent.ownerId = record.accountId
        changedAgents.add(agent)
      }
      return [{ accountId: record.accountId, createdAt: agent.createdAt, agentId: agent.id }]
    }).sort((left, right) => left.createdAt - right.createdAt)

    for (const agent of agents) {
      if (agent.ownerId) continue
      const groupOwners = new Set(conversations
        .filter((conversation) => conversation.type === 'group' && conversation.agentIds.includes(agent.id))
        .flatMap((conversation) => conversation.agentIds)
        .map((agentId) => agentsById.get(agentId)?.ownerId)
        .filter((ownerId): ownerId is string => Boolean(ownerId)))
      const groupedOwner = groupOwners.size === 1 ? [...groupOwners][0] : undefined
      const temporalOwner = [...accountAnchors]
        .reverse()
        .find((anchor) => anchor.createdAt <= agent.createdAt)?.accountId
        ?? (accountAnchors.length === 1 ? accountAnchors[0].accountId : undefined)
      const ownerId = groupedOwner ?? temporalOwner
      if (!ownerId) continue
      agent.ownerId = ownerId
      changedAgents.add(agent)
    }

    const changedConversations: Conversation[] = []
    for (const conversation of conversations) {
      if (conversation.ownerId) continue
      const owners = new Set(conversation.agentIds
        .map((agentId) => agentsById.get(agentId)?.ownerId)
        .filter((ownerId): ownerId is string => Boolean(ownerId)))
      if (owners.size !== 1) continue
      conversation.ownerId = [...owners][0]
      changedConversations.push(conversation)
    }

    const conversationsById = new Map(conversations.map((conversation) => [conversation.id, conversation]))
    const changedRoutines: Routine[] = []
    for (const routine of routines) {
      if (routine.ownerId) continue
      const ownerId = agentsById.get(routine.agentId)?.ownerId
        ?? conversationsById.get(routine.conversationId)?.ownerId
      if (!ownerId) continue
      routine.ownerId = ownerId
      changedRoutines.push(routine)
    }

    const routinesById = new Map(routines.map((routine) => [routine.id, routine]))
    const changedRuns: TaskRun[] = []
    for (const run of runs) {
      if (run.ownerId) continue
      const ownerId = (run.routineId ? routinesById.get(run.routineId)?.ownerId : undefined)
        ?? agentsById.get(run.agentId)?.ownerId
        ?? conversationsById.get(run.conversationId)?.ownerId
      if (!ownerId) continue
      run.ownerId = ownerId
      changedRuns.push(run)
    }

    if (!changedAgents.size && !changedConversations.length && !changedRoutines.length && !changedRuns.length) return
    this.tx(() => {
      for (const agent of changedAgents) this.putAgent(agent)
      for (const conversation of changedConversations) this.putConversation(conversation)
      for (const routine of changedRoutines) this.putRoutine(routine)
      for (const run of changedRuns) this.putRun(run)
    })
  }

  private accountMetaKey(key: string, accountId = this.currentAccountId): string {
    return accountId ? `${ACCOUNT_META_PREFIX}${accountId}:${key}` : ''
  }

  private accountMeta(key: string, accountId = this.currentAccountId): string {
    const scopedKey = this.accountMetaKey(key, accountId)
    return scopedKey ? this.meta(scopedKey) : ''
  }

  private setAccountMeta(key: string, value: string, accountId = this.currentAccountId): void {
    const scopedKey = this.accountMetaKey(key, accountId)
    if (!scopedKey) throw new Error('Sign in before changing account data')
    this.setMeta(scopedKey, value)
  }

  /** Move settings written by pre-isolation releases into account namespaces.
   * Connector ownership can usually be recovered from its authorized agents.
   * Ambiguous profile/endpoint values migrate only when exactly one account is
   * known; with multiple accounts they remain quarantined and unreadable. */
  private migrateAccountSensitiveMeta(fallbackAccountId = this.meta(CURRENT_ACCOUNT_META)): void {
    const knownAccountIds = [...new Set(this.accountDefaultContacts().map((record) => record.accountId))]
    const unambiguousFallback = knownAccountIds.length <= 1 ? fallbackAccountId : ''
    const migrateValue = (legacyKey: string, accountKey: string): void => {
      const value = this.meta(legacyKey)
      if (!value || !unambiguousFallback) return
      if (!this.accountMeta(accountKey, unambiguousFallback)) this.setAccountMeta(accountKey, value, unambiguousFallback)
      this.setMeta(legacyKey, '')
    }
    migrateValue('userName', 'userName')
    migrateValue('userAvatar', 'userAvatar')
    migrateValue('endpoint', 'endpoint')

    let legacyConnectors: EmailConnectorAccount[] = []
    try {
      const value = JSON.parse(this.meta(LEGACY_CONNECTORS_META) || '[]') as unknown
      if (Array.isArray(value)) {
        legacyConnectors = value.filter((item): item is EmailConnectorAccount => Boolean(
          item && typeof item === 'object' && (item as EmailConnectorAccount).kind === 'email'
        ))
      }
    } catch { /* Malformed legacy connector metadata remains quarantined. */ }
    if (legacyConnectors.length) {
      const agentsById = new Map(this.agents.map((agent) => [agent.id, agent]))
      const grouped = new Map<string, EmailConnectorAccount[]>()
      for (const connector of legacyConnectors) {
        const owners = new Set(connector.agentIds
          .map((agentId) => agentsById.get(agentId)?.ownerId)
          .filter((ownerId): ownerId is string => Boolean(ownerId)))
        const ownerId = owners.size === 1 ? [...owners][0] : unambiguousFallback
        if (!ownerId) continue
        grouped.set(ownerId, [...(grouped.get(ownerId) ?? []), connector])
      }
      if (grouped.size) {
        for (const [ownerId, connectors] of grouped) {
          let existing: EmailConnectorAccount[] = []
          try {
            const value = JSON.parse(this.accountMeta('connectors', ownerId) || '[]') as unknown
            if (Array.isArray(value)) existing = value as EmailConnectorAccount[]
          } catch { /* Replace malformed account metadata with the recoverable legacy value. */ }
          const merged = new Map(existing.map((connector) => [connector.id, connector]))
          for (const connector of connectors) if (!merged.has(connector.id)) merged.set(connector.id, connector)
          this.setAccountMeta('connectors', JSON.stringify([...merged.values()]), ownerId)
        }
        this.setMeta(LEGACY_CONNECTORS_META, '')
      }
    }

    try {
      const outbox = JSON.parse(this.meta('socialTaskOutbox') || '[]') as Array<{
        id: string; ownerId: string; claim: string; reply: string; failed: boolean
      }>
      if (Array.isArray(outbox) && outbox.length) {
        const byOwner = new Map<string, typeof outbox>()
        for (const item of outbox) {
          if (!item?.ownerId) continue
          byOwner.set(item.ownerId, [...(byOwner.get(item.ownerId) ?? []), item])
        }
        for (const [ownerId, items] of byOwner) {
          if (!this.accountMeta('socialTaskOutbox', ownerId)) {
            this.setAccountMeta('socialTaskOutbox', JSON.stringify(items), ownerId)
          }
        }
        this.setMeta('socialTaskOutbox', '')
      }
    } catch { /* Malformed legacy outbox data is not exposed to any account. */ }

    for (const conversation of this.conversations) {
      if (!conversation.ownerId) continue
      const legacyKey = `socialClearedMessages:${conversation.id}`
      const value = this.meta(legacyKey)
      if (!value) continue
      const accountKey = `socialClearedMessages:${conversation.id}`
      if (!this.accountMeta(accountKey, conversation.ownerId)) {
        this.setAccountMeta(accountKey, value, conversation.ownerId)
      }
      this.setMeta(legacyKey, '')
    }
  }

  /** Older attachment files had no owner table. Their containing conversation
   * is authoritative, including attachments nested in delivery replies. */
  private backfillAttachmentOwnership(): void {
    const conversations = new Map(this.conversations.map((conversation) => [conversation.id, conversation]))
    for (const message of this.messages) {
      const ownerId = conversations.get(message.conversationId)?.ownerId
      if (!ownerId) continue
      const attachments = [
        ...(message.attachments ?? []),
        ...(message.deliveries ?? []).flatMap((delivery) =>
          (delivery.replies ?? []).flatMap((reply) => reply.attachments ?? [])
        )
      ]
      for (const attachment of attachments) {
        this.write('INSERT OR IGNORE INTO attachmentOwners (id, ownerId) VALUES (?, ?)', attachment.id, ownerId)
      }
    }
  }

  private insertMessage(message: ChatMessage): void {
    this.write(
      'INSERT INTO messages (id, conversationId, topicId, createdAt, data) VALUES (?, ?, ?, ?, ?)',
      message.id,
      message.conversationId,
      message.topicId,
      message.createdAt,
      JSON.stringify(message)
    )
  }

  // ───────────────────────────── collections ─────────────────────────────

  get agents(): AgentConfig[] {
    return this.all<AgentConfig>('SELECT data FROM agents ORDER BY rowid')
  }

  get conversations(): Conversation[] {
    return this.all<Conversation>('SELECT data FROM conversations ORDER BY rowid')
  }

  get messages(): ChatMessage[] {
    return this.all<ChatMessage>('SELECT data FROM messages ORDER BY rowid')
  }

  get privateMessages(): PrivateMessage[] {
    return this.all<PrivateMessage>('SELECT data FROM privateMessages ORDER BY rowid')
  }

  get routines(): Routine[] {
    return this.all<Routine>('SELECT data FROM routines ORDER BY rowid')
  }

  get runs(): TaskRun[] {
    return this.all<TaskRun>('SELECT data FROM runs ORDER BY rowid')
  }

  get runEvents(): RunEvent[] {
    return this.all<RunEvent>('SELECT data FROM runEvents ORDER BY rowid')
  }

  get currentAccountId(): string {
    return this.meta(CURRENT_ACCOUNT_META)
  }

  setCurrentAccountId(accountId: string): void {
    const normalized = accountId.trim()
    this.setMeta(CURRENT_ACCOUNT_META, normalized)
    if (normalized) this.migrateAccountSensitiveMeta(normalized)
  }

  /** Account-scoped views are the only collections exposed to the renderer or
   * scheduler. Raw getters remain available for migrations and cascading
   * database maintenance inside the main process. */
  get accountAgents(): AgentConfig[] {
    const accountId = this.currentAccountId
    return accountId ? this.agents.filter((agent) => agent.ownerId === accountId) : []
  }

  get accountConversations(): Conversation[] {
    const accountId = this.currentAccountId
    return accountId ? this.conversations.filter((conversation) => conversation.ownerId === accountId) : []
  }

  get accountRoutines(): Routine[] {
    const accountId = this.currentAccountId
    return accountId ? this.routines.filter((routine) => routine.ownerId === accountId) : []
  }

  get accountRuns(): TaskRun[] {
    const accountId = this.currentAccountId
    return accountId ? this.runs.filter((run) => run.ownerId === accountId) : []
  }

  get connectors(): EmailConnectorAccount[] {
    try {
      const value = JSON.parse(this.accountMeta('connectors') || '[]') as unknown
      return Array.isArray(value) ? value.filter((item): item is EmailConnectorAccount => Boolean(
        item && typeof item === 'object' && (item as EmailConnectorAccount).kind === 'email'
      )) : []
    } catch {
      return []
    }
  }

  setConnectors(connectors: EmailConnectorAccount[]): void {
    this.setAccountMeta('connectors', JSON.stringify(connectors))
  }

  // ───────────────────────────── profile & endpoint ─────────────────────────────

  get userName(): string {
    return this.accountMeta('userName') || 'You'
  }

  get userAvatar(): string {
    return this.accountMeta('userAvatar')
  }

  /** The account administrator survives independently from its deletable chat. */
  get systemAdminAgentId(): string | undefined {
    const accountId = this.meta(CURRENT_ACCOUNT_META)
    const record = this.accountDefaultContacts().find((item) => item.accountId === accountId)
    const agent = record ? this.agent(record.agentId) : undefined
    return agent?.systemRole === 'admin' ? agent.id : undefined
  }

  /** The welcome chat is account-specific, but may be deleted while its
   * system-administrator contact remains available in the contacts list. */
  get defaultConversationId(): string | undefined {
    const accountId = this.meta(CURRENT_ACCOUNT_META)
    const record = this.accountDefaultContacts().find((item) => item.accountId === accountId)
    return record && this.conversation(record.conversationId) ? record.conversationId : undefined
  }

  /** The OpenAI-compatible endpoint saved from the app's own settings. */
  get endpoint(): { baseUrl: string; apiKey: string } | undefined {
    const raw = this.accountMeta('endpoint')
    if (!raw) return undefined
    try {
      const value = JSON.parse(raw) as { baseUrl: string; apiKey: string }
      return value.baseUrl ? value : undefined
    } catch {
      return undefined
    }
  }

  setEndpoint(endpoint: { baseUrl: string; apiKey: string } | undefined): void {
    this.setAccountMeta('endpoint', endpoint?.baseUrl ? JSON.stringify(endpoint) : '')
  }

  setUserName(name: string): void {
    this.setAccountMeta('userName', name.trim() || 'You')
  }

  /**
   * The renderer downscales before sending; the checks here are the backstop.
   * A remote URL is refused outright — the state must never make the app fetch
   * an image at render time — and the cap keeps the row small.
   */
  setUserAvatar(dataUrl: string): void {
    const value = dataUrl.trim()
    if (!validAvatar(value)) return
    this.setAccountMeta('userAvatar', value)
  }

  // ───────────────────────────── agents ─────────────────────────────

  /** Create one system administrator for each Douchat account seen on this
   * local profile. Existing contacts are migrated; legacy deletions recover
   * the contact once without recreating a deliberately deleted chat later. */
  ensureDefaultCloudContact(
    accountId: string,
    binding: Pick<AgentConfig, 'provider' | 'model'>,
    remoteManifest?: BuiltInAgentManifest
  ): DefaultCloudContactResult {
    const normalizedAccountId = accountId.trim()
    if (!normalizedAccountId) return { created: false }
    if (remoteManifest) {
      this.setMeta(`${BUILT_IN_MANIFEST_META_PREFIX}${normalizedAccountId}`, JSON.stringify(remoteManifest))
    }
    const definition = defaultBuiltInAgent(remoteManifest ?? this.builtInManifest(normalizedAccountId))
    const records = this.accountDefaultContacts()
    const existingIndex = records.findIndex((record) => record.accountId === normalizedAccountId)
    const existing = records[existingIndex]
    if (existing) {
      const agent = this.agent(existing.agentId)
      if (agent) {
        const overrides = inferredBuiltInOverrides(agent)
        const model = definition.modelRoute === 'default' ? binding.model : definition.modelRoute
        const cloudAgentId = definition.id === 'system-admin-fallback' ? agent.cloudAgentId : definition.id
        Object.assign(agent, {
          ownerId: normalizedAccountId,
          name: overrides.name ?? definition.name,
          role: definition.role,
          instructions: overrides.instructions ?? definition.instructions,
          labels: overrides.labels ?? definition.labels ?? '',
          color: definition.color,
          provider: overrides.modelBinding?.provider ?? binding.provider,
          model: overrides.modelBinding?.model ?? model,
          systemRole: definition.systemRole,
          systemKey: definition.systemKey,
          cloudAgentId,
          templateVersion: definition.templateVersion,
          modelRoute: definition.modelRoute,
          capabilities: [...definition.capabilities],
          userOverrides: overrides,
          avatar: overrides.avatar ?? agent.avatar ?? '',
          avatarEmoji: overrides.avatarEmoji ?? agent.avatarEmoji ?? ''
        })
        this.putAgent(agent)
        const conversation = this.conversation(existing.conversationId)
        if (conversation && (conversation.name !== agent.name || conversation.ownerId !== normalizedAccountId)) {
          conversation.name = agent.name
          conversation.ownerId = normalizedAccountId
          this.putConversation(conversation)
        }
        records[existingIndex] = {
          ...existing,
          systemKey: definition.systemKey,
          cloudAgentId
        }
        this.setMeta(ACCOUNT_DEFAULT_CONTACTS_META, JSON.stringify(records))
        this.setCurrentAccountId(normalizedAccountId)
        return {
          agent,
          conversation,
          created: false
        }
      }
    }

    const preferredId = definition.id === 'system-admin-fallback'
      ? `system-admin-${randomUUID()}`
      : definition.id
    const id = this.agent(preferredId) ? `system-admin-${randomUUID()}` : preferredId
    const now = Date.now()
    const model = definition.modelRoute === 'default' ? binding.model : definition.modelRoute
    const agent: AgentConfig = {
      ownerId: normalizedAccountId,
      id,
      name: definition.name,
      systemRole: definition.systemRole,
      systemKey: definition.systemKey,
      cloudAgentId: definition.id === 'system-admin-fallback' ? undefined : definition.id,
      templateVersion: definition.templateVersion,
      modelRoute: definition.modelRoute,
      capabilities: [...definition.capabilities],
      userOverrides: {},
      avatar: '',
      role: definition.role,
      instructions: definition.instructions,
      labels: definition.labels ?? '',
      color: definition.color,
      createdAt: now,
      provider: binding.provider,
      model
    }
    const topic = newTopic('', now)
    const conversation: Conversation = {
      ownerId: normalizedAccountId,
      id: `direct-${id}`,
      type: 'direct',
      name: agent.name,
      agentIds: [agent.id],
      topics: [topic],
      activeTopicId: topic.id,
      unread: 0,
      readAt: now,
      createdAt: now,
      updatedAt: now
    }
    return this.tx(() => {
      this.putAgent(agent)
      this.putConversation(conversation)
      const record = {
        accountId: normalizedAccountId,
        agentId: agent.id,
        conversationId: conversation.id,
        systemKey: definition.systemKey,
        cloudAgentId: agent.cloudAgentId
      }
      if (existingIndex >= 0) records[existingIndex] = record
      else records.push(record)
      this.setMeta(ACCOUNT_DEFAULT_CONTACTS_META, JSON.stringify(records))
      this.setCurrentAccountId(normalizedAccountId)
      return { agent, conversation, created: true }
    })
  }

  agent(agentId: string): AgentConfig | undefined {
    return this.one<AgentConfig>('SELECT data FROM agents WHERE id = ?', agentId)
  }

  conversation(conversationId: string): Conversation | undefined {
    return this.one<Conversation>('SELECT data FROM conversations WHERE id = ?', conversationId)
  }

  socialClearedMessageIds(conversationId: string): string[] {
    try { return JSON.parse(this.accountMeta(`socialClearedMessages:${conversationId}`) || '[]') } catch { return [] }
  }

  linkSharedGroup(conversationId: string, roomId: string): void {
    const conversation = this.accountConversations.find((item) => item.id === conversationId)
    if (!conversation || conversation.type !== 'group') throw new Error('Chat not found')
    if (conversation.remoteRoomId && conversation.remoteRoomId !== roomId) throw new Error('Chat already shared')
    conversation.remoteRoomId = roomId
    this.putConversation(conversation)
  }

  syncFriendConversation(ownerId: string, room: SocialRoom, incoming: SocialMessage[], attachments = new Map<string, MessageAttachment[]>()): Conversation {
    if (ownerId !== this.currentAccountId || !room.members.some((member) => member.id === ownerId)) throw new Error('Chat account mismatch')
    const person = room.members.find((member) => member.id !== ownerId)
    if (room.kind === 'direct' && !person) throw new Error('Contact not found')
    const id = this.accountConversations.find((item) => item.remoteRoomId === room.id)?.id ?? `${room.kind === 'direct' ? 'friend' : 'shared'}:${ownerId}:${room.id}`
    return this.tx(() => {
      const previous = this.conversation(id)
      const createdAt = Date.parse(room.createdAt)
      const conversation: Conversation = previous ?? {
        id, ownerId, type: room.kind, name: room.kind === 'direct' ? person!.name : room.name, agentIds: [], remoteRoomId: room.id,
        topics: [{ id: DEFAULT_TOPIC_ID, title: '', createdAt, updatedAt: createdAt }], activeTopicId: DEFAULT_TOPIC_ID,
        unread: 0, readAt: 0, createdAt, updatedAt: createdAt
      }
      conversation.person = room.kind === 'direct' ? person : undefined
      conversation.name = room.kind === 'direct' ? person!.name : room.name
      if (room.kind === 'group') {
        conversation.socialRoom = room
        conversation.agentIds = room.agents.map((agent) => agent.id)
      }
      this.putConversation(conversation)
      let unread = 0
      const cleared = new Set(this.socialClearedMessageIds(id))
      for (const message of [...incoming].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || Number(Boolean(a.parentMessageId)) - Number(Boolean(b.parentMessageId)) || a.id.localeCompare(b.id))) {
        const messageId = `${id}:${message.id}`
        if (message.roomId !== room.id || cleared.has(messageId) || (message.parentMessageId && cleared.has(`${id}:${message.parentMessageId}`))) continue
        if (!message.parentMessageId) this.setMessageDeliveryState(messageId)
        if (!message.parentMessageId && !this.one<ChatMessage>('SELECT data FROM messages WHERE id = ?', messageId)) {
        this.insertMessage({ id: messageId, conversationId: id, topicId: conversation.activeTopicId,
          authorId: message.authorId === ownerId ? 'user' : message.authorId, authorName: message.authorName,
          text: message.content, attachments: attachments.get(message.id), kind: 'message', createdAt: Date.parse(message.createdAt) })
        conversation.updatedAt = Math.max(conversation.updatedAt, Date.parse(message.createdAt))
        if (message.authorId !== ownerId) unread++
        }
        if (message.agentId) {
          const parentId = `${id}:${message.parentMessageId || message.id}`
          const parent = this.one<ChatMessage>('SELECT data FROM messages WHERE id = ?', parentId)
          if (parent) {
            parent.socialTasks = [...(parent.socialTasks ?? []).filter((task) => task.id !== message.id), { id: message.id, agentId: message.agentId, agentName: message.agentName || '', status: message.status }]
            this.write('UPDATE messages SET data = ? WHERE id = ?', JSON.stringify(parent), parentId)
          }
        }
        if (message.reply || message.replyImages?.length) {
          const replyId = `${messageId}:reply`
          if (!cleared.has(replyId)) {
            const existingReply = this.one<ChatMessage>('SELECT data FROM messages WHERE id = ?', replyId)
            const reply: ChatMessage = { id: replyId, conversationId: id, topicId: conversation.activeTopicId,
              authorId: message.agentId || 'system', authorName: message.agentName || '', text: message.reply || '',
              attachments: attachments.get(`${message.id}:reply`) ?? existingReply?.attachments,
              kind: 'message', createdAt: Date.parse(message.createdAt), ...(message.status === 'failed' ? { error: message.reply } : {}) }
            if (existingReply) this.write('UPDATE messages SET data = ? WHERE id = ?', JSON.stringify(reply), replyId)
            else { this.insertMessage(reply); unread++ }
          }
        }
      }
      this.putConversation(conversation)
      if (unread) this.addUnread(id, unread)
      return this.conversation(id)!
    })
  }

  socialTaskOutbox(accountId = this.currentAccountId): { id: string; ownerId: string; claim: string; reply: string; images?: import('../shared/social').SocialImage[]; failed: boolean }[] {
    try { return JSON.parse(this.accountMeta('socialTaskOutbox', accountId) || '[]') } catch { return [] }
  }

  saveSocialTaskResult(result: { id: string; ownerId: string; claim: string; reply: string; images?: import('../shared/social').SocialImage[]; failed: boolean }): void {
    this.setAccountMeta('socialTaskOutbox', JSON.stringify([
      ...this.socialTaskOutbox(result.ownerId).filter((item) => item.id !== result.id),
      result
    ]), result.ownerId)
  }

  removeSocialTaskResult(id: string, accountId = this.currentAccountId): void {
    this.setAccountMeta('socialTaskOutbox', JSON.stringify(
      this.socialTaskOutbox(accountId).filter((item) => item.id !== id)
    ), accountId)
  }

  claimSocialAgent(agentId: string, ownerId: string): AgentConfig {
    const agent = this.agent(agentId)
    if (!agent || this.currentAccountId !== ownerId || (agent.ownerId && agent.ownerId !== ownerId)) {
      throw new Error("You may only add and run your own agents.")
    }
    if (!agent.ownerId) {
      agent.ownerId = ownerId
      this.putAgent(agent)
    }
    return agent
  }

  createAgent(input: ResolvedCreateAgentInput): AgentConfig {
    const ownerId = this.currentAccountId
    if (!ownerId) throw new Error('Sign in before creating a contact')
    const id = `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bot'}-${randomUUID().slice(0, 6)}`
    const now = Date.now()
    const {
      ownerId: _ignoredOwnerId,
      systemRole: _ignoredSystemRole,
      systemKey: _ignoredSystemKey,
      cloudAgentId: _ignoredCloudAgentId,
      templateVersion: _ignoredTemplateVersion,
      modelRoute: _ignoredModelRoute,
      capabilities: _ignoredCapabilities,
      userOverrides: _ignoredUserOverrides,
      ...safeInput
    } = input as ResolvedCreateAgentInput & Partial<AgentConfig>
    const avatar = validAvatar(input.avatar?.trim() ?? '') ? input.avatar?.trim() : ''
    const agent: AgentConfig = {
      ...safeInput,
      ownerId,
      avatar,
      avatarEmoji: avatar ? '' : normalizeAgentEmoji(input.avatarEmoji),
      avatarSeed: !input.localAgentId && input.provider !== 'local' ? randomUUID() : undefined,
      id,
      createdAt: now
    }
    const topic = newTopic('', now)
    return this.tx(() => {
      this.putAgent(agent)
      this.putConversation({
        ownerId: agent.ownerId,
        id: `direct-${id}`,
        type: 'direct',
        name: agent.name,
        agentIds: [agent.id],
        topics: [topic],
        activeTopicId: topic.id,
        unread: 0,
        readAt: now,
        createdAt: now,
        updatedAt: now
      })
      return agent
    })
  }

  updateAgent(agentId: string, input: UpdateAgentInput, modelSelection?: {
    binding: Pick<AgentConfig, 'provider' | 'model'>
    followDefault: boolean
  }): AgentConfig | undefined {
    const agent = this.agent(agentId)
    if (!agent) return undefined
    const {
      ownerId: _ignoredOwnerId,
      systemRole: _ignoredSystemRole,
      systemKey: _ignoredSystemKey,
      cloudAgentId: _ignoredCloudAgentId,
      templateVersion: _ignoredTemplateVersion,
      modelRoute: _ignoredModelRoute,
      capabilities: _ignoredCapabilities,
      userOverrides: _ignoredUserOverrides,
      ...next
    } = input as UpdateAgentInput & Partial<AgentConfig>
    if (agent.systemRole === 'admin') {
      // Raw renderer fields cannot override system identity or model routing.
      // Model changes use the separately validated selection below.
      delete next.role
      delete next.color
      delete next.provider
      delete next.model
      delete next.localAgentId
    }
    if (next.permissions !== undefined) next.permissions = agentPermissions(next.permissions)
    if (next.avatar !== undefined) {
      next.avatar = next.avatar.trim()
      if (!validAvatar(next.avatar)) delete next.avatar
    }
    if (next.avatarEmoji !== undefined) {
      const original = next.avatarEmoji.trim()
      next.avatarEmoji = normalizeAgentEmoji(next.avatarEmoji)
      if (original && !next.avatarEmoji) delete next.avatarEmoji
    }
    if (next.avatar) next.avatarEmoji = ''
    if (next.avatarEmoji) next.avatar = ''
    if (agent.systemRole === 'admin') {
      const overrides = { ...agent.userOverrides }
      if (modelSelection) {
        if (modelSelection.followDefault) delete overrides.modelBinding
        else overrides.modelBinding = { ...modelSelection.binding }
        next.provider = modelSelection.binding.provider
        next.model = modelSelection.followDefault && agent.modelRoute && agent.modelRoute !== 'default'
          ? agent.modelRoute : modelSelection.binding.model
      }
      for (const key of ['name', 'avatar', 'avatarEmoji', 'instructions', 'labels'] as const) {
        if (next[key] !== undefined) overrides[key] = next[key]
      }
      agent.userOverrides = overrides
    }
    Object.assign(agent, next)
    return this.tx(() => {
      this.putAgent(agent)
      for (const conversation of this.conversations) {
        if (conversation.type === 'direct' && conversation.agentIds[0] === agentId) {
          conversation.name = agent.name
          this.putConversation(conversation)
        } else if (conversation.type === 'group' && !conversation.description) {
          conversation.name = this.groupName(conversation)
          this.putConversation(conversation)
        }
      }
      return agent
    })
  }

  private groupName(conversation: Conversation): string {
    if (!conversation.autoNamed) return conversation.name
    const names = conversation.agentIds.map((agentId) => this.agent(agentId)?.name).filter(Boolean)
    return names.join(', ') || conversation.name
  }

  deleteAgent(agentId: string): void {
    if (this.agent(agentId)?.systemRole === 'admin') {
      throw new Error('The system administrator cannot be deleted')
    }
    this.tx(() => {
      this.write('DELETE FROM agents WHERE id = ?', agentId)
      // Its own direct chats go with it, and the cascade takes their messages,
      // private deliveries and routines.
      for (const conversation of this.conversations) {
        if (conversation.type === 'direct' && conversation.agentIds.includes(agentId)) {
          this.write('DELETE FROM conversations WHERE id = ?', conversation.id)
          continue
        }
        if (!conversation.agentIds.includes(agentId)) continue
        conversation.agentIds = conversation.agentIds.filter((id) => id !== agentId)
        if (conversation.leadAgentId === agentId) conversation.leadAgentId = conversation.agentIds[0]
        conversation.name = this.groupName(conversation)
        this.putConversation(conversation)
      }
      this.write('DELETE FROM privateMessages WHERE senderId = ? OR recipientId = ?', agentId, agentId)
      // Runs first: the routines they point at have to still exist here.
      this.write('DELETE FROM runs WHERE agentId = ? OR routineId IN (SELECT id FROM routines WHERE agentId = ?)', agentId, agentId)
      this.write('DELETE FROM routines WHERE agentId = ?', agentId)
    })
  }

  // ───────────────────────────── conversations ─────────────────────────────

  /** Restore an existing private thread, or recreate it after the user deleted
   * it while keeping the contact. The stable id prevents duplicate directs. */
  ensureDirectConversation(agentId: string): { conversation: Conversation; created: boolean } {
    const agent = this.agent(agentId)
    if (!agent) throw new Error('Contact not found')
    const existing = this.conversations.find(
      (conversation) => conversation.type === 'direct' && conversation.agentIds[0] === agentId
    )
    if (existing) {
      existing.hidden = undefined
      this.putConversation(existing)
      return { conversation: existing, created: false }
    }
    const now = Date.now()
    const topic = newTopic('', now)
    const conversation: Conversation = {
      ownerId: (agent.ownerId ?? this.currentAccountId) || undefined,
      id: `direct-${agentId}`,
      type: 'direct',
      name: agent.name,
      agentIds: [agentId],
      topics: [topic],
      activeTopicId: topic.id,
      unread: 0,
      readAt: now,
      createdAt: now,
      updatedAt: now
    }
    this.putConversation(conversation)
    return { conversation, created: true }
  }

  createGroup(input: CreateGroupInput): Conversation {
    const ownerId = this.currentAccountId
    if (!ownerId) throw new Error('Sign in before creating a group')
    const now = Date.now()
    const known = new Set(this.accountAgents.map((agent) => agent.id))
    const agentIds = [...new Set(input.agentIds)].filter((agentId) => known.has(agentId))
    const topic = newTopic('', now)
    const conversation: Conversation = {
      ownerId,
      id: `group-${randomUUID().slice(0, 8)}`,
      type: 'group',
      autoNamed: !input.name.trim(),
      name:
        input.name.trim() ||
        agentIds.map((agentId) => this.agent(agentId)?.name).filter(Boolean).join(', ') ||
        'New group',
      description: input.description?.trim() || undefined,
      agentIds,
      leadAgentId: agentIds.includes(input.leadAgentId ?? '') ? input.leadAgentId : agentIds[0],
      topics: [topic],
      activeTopicId: topic.id,
      unread: 0,
      readAt: now,
      createdAt: now,
      updatedAt: now
    }
    this.putConversation(conversation)
    return conversation
  }

  updateConversation(conversationId: string, input: UpdateConversationInput): Conversation | undefined {
    const conversation = this.conversation(conversationId)
    if (!conversation) return undefined
    if (conversation.type === 'group') {
      if (input.avatar !== undefined) {
        if (!validAvatar(input.avatar)) throw new Error('Invalid group avatar')
        conversation.avatar = input.avatar || undefined
        if (input.avatar) conversation.avatarEmoji = undefined
      }
      if (input.avatarEmoji !== undefined) {
        const emoji = normalizeAgentEmoji(input.avatarEmoji)
        if (input.avatarEmoji && !emoji) throw new Error('Invalid group emoji')
        conversation.avatarEmoji = emoji || undefined
        if (emoji) conversation.avatar = undefined
      }
    }
    if (input.savedToContacts !== undefined) conversation.savedToContacts = input.savedToContacts
    if (input.muted !== undefined) conversation.muted = input.muted
    if (input.hidden !== undefined) conversation.hidden = input.hidden
    if (input.manuallyUnread !== undefined) {
      conversation.manuallyUnread = input.manuallyUnread
      conversation.unread = input.manuallyUnread ? Math.max(1, conversation.unread) : 0
    }
    if (input.name?.trim()) {
      conversation.name = input.name.trim()
      if (conversation.type === 'group') conversation.autoNamed = false
    }
    if (input.description !== undefined) conversation.description = input.description.trim() || undefined
    if (input.agentIds && conversation.type === 'group') {
      const known = new Set(this.accountAgents.map((agent) => agent.id))
      conversation.agentIds = [...new Set(input.agentIds)].filter((agentId) => known.has(agentId))
      if (!conversation.agentIds.includes(conversation.leadAgentId ?? '')) {
        conversation.leadAgentId = conversation.agentIds[0]
      }
    }
    if (input.leadAgentId && conversation.agentIds.includes(input.leadAgentId)) {
      conversation.leadAgentId = input.leadAgentId
    }
    conversation.updatedAt = Date.now()
    this.putConversation(conversation)
    return conversation
  }

  deleteConversation(conversationId: string): void {
    const target = this.conversation(conversationId)
    if (target?.remoteRoomId || target?.savedToContacts) {
      this.clearConversation(conversationId)
      this.updateConversation(conversationId, { hidden: true })
      return
    }
    // Messages, private deliveries and routines cascade from the row.
    this.write('DELETE FROM conversations WHERE id = ?', conversationId)
  }

  setConversationPinned(conversationId: string, pinned: boolean): void {
    const conversation = this.conversation(conversationId)
    if (!conversation) return
    conversation.pinned = pinned || undefined
    this.putConversation(conversation)
  }

  markConversationRead(conversationId: string): void {
    const conversation = this.conversation(conversationId)
    if (!conversation) return
    conversation.manuallyUnread = false
    conversation.unread = 0
    conversation.readAt = Date.now()
    this.putConversation(conversation)
  }

  markAllConversationsRead(): void {
    const now = Date.now()
    this.tx(() => {
      for (const conversation of this.accountConversations) {
        conversation.manuallyUnread = false
        conversation.unread = 0
        conversation.readAt = now
        this.putConversation(conversation)
      }
    })
  }

  addUnread(conversationId: string, count: number): void {
    const conversation = this.conversation(conversationId)
    if (!conversation || count <= 0) return
    conversation.hidden = false
    conversation.unread += count
    this.putConversation(conversation)
  }

  // ───────────────────────────── topics ─────────────────────────────

  createTopic(conversationId: string): Topic | undefined {
    const conversation = this.conversation(conversationId)
    if (!conversation) return undefined
    const topic = newTopic('', Date.now())
    conversation.topics.push(topic)
    conversation.activeTopicId = topic.id
    conversation.updatedAt = topic.createdAt
    this.putConversation(conversation)
    return topic
  }

  renameTopic(conversationId: string, topicId: string, title: string): void {
    const conversation = this.conversation(conversationId)
    const topic = conversation?.topics.find((item) => item.id === topicId)
    if (!conversation || !topic) return
    topic.title = title.trim().slice(0, 80)
    topic.updatedAt = Date.now()
    this.putConversation(conversation)
  }

  deleteTopic(conversationId: string, topicId: string): void {
    const conversation = this.conversation(conversationId)
    if (!conversation || conversation.topics.length <= 1) return
    this.tx(() => {
      conversation.topics = conversation.topics.filter((topic) => topic.id !== topicId)
      if (conversation.activeTopicId === topicId) conversation.activeTopicId = conversation.topics[0].id
      conversation.updatedAt = Date.now()
      this.putConversation(conversation)
      this.write('DELETE FROM messages WHERE conversationId = ? AND topicId = ?', conversationId, topicId)
      this.write('DELETE FROM privateMessages WHERE conversationId = ? AND topicId = ?', conversationId, topicId)
      this.write('DELETE FROM groupGames WHERE conversationId = ? AND topicId = ?', conversationId, topicId)
      this.write('DELETE FROM groupWorkflows WHERE conversationId = ? AND topicId = ?', conversationId, topicId)
    })
  }

  setActiveTopic(conversationId: string, topicId: string): void {
    const conversation = this.conversation(conversationId)
    if (!conversation || !conversation.topics.some((topic) => topic.id === topicId)) return
    conversation.activeTopicId = topicId
    this.putConversation(conversation)
  }

  activeTopicId(conversationId: string): string {
    const conversation = this.conversation(conversationId)
    if (!conversation) return DEFAULT_TOPIC_ID
    return conversation.topics.some((topic) => topic.id === conversation.activeTopicId)
      ? conversation.activeTopicId
      : conversation.topics[0]?.id ?? DEFAULT_TOPIC_ID
  }

  // ───────────────────────────── messages ─────────────────────────────

  recentMessages(): ChatMessage[] {
    return this.all<ChatMessage>(`SELECT data FROM (
      SELECT data, rowid AS sequence, ROW_NUMBER() OVER (
        PARTITION BY conversationId, topicId ORDER BY rowid DESC
      ) AS position FROM messages
    ) WHERE position <= 51 ORDER BY sequence`)
  }

  searchMessages(conversationId: string, query: string): ChatMessage[] {
    if (!query.trim()) return []
    return this.all<ChatMessage>(`SELECT data FROM messages WHERE conversationId = ?
      AND instr(lower(json_extract(data, '$.text')), lower(?)) > 0 ORDER BY rowid DESC LIMIT 100`, conversationId, query.trim())
  }

  messagePage(conversationId: string, topicId: string, before?: string): { messages: ChatMessage[]; hasMore: boolean } {
    const rows = this.all<ChatMessage>(`SELECT data FROM messages
      WHERE conversationId = ? AND topicId = ?
      AND rowid < COALESCE((SELECT rowid FROM messages WHERE id = ? AND conversationId = ? AND topicId = ?), 9223372036854775807)
      ORDER BY rowid DESC LIMIT 51`, conversationId, topicId, before ?? '', conversationId, topicId)
    return { messages: rows.slice(0, 50).reverse(), hasMore: rows.length > 50 }
  }

  topicMessages(conversationId: string, topicId: string): ChatMessage[] {
    return this.all<ChatMessage>(
      'SELECT data FROM messages WHERE conversationId = ? AND topicId = ? ORDER BY rowid',
      conversationId,
      topicId
    )
  }

  topicPrivateMessages(conversationId: string, topicId: string): PrivateMessage[] {
    return this.all<PrivateMessage>(
      'SELECT data FROM privateMessages WHERE conversationId = ? AND topicId = ? ORDER BY rowid',
      conversationId,
      topicId
    )
  }

  setMessageDeliveryState(id: string, deliveryState?: ChatMessage['deliveryState']): void {
    const message = this.one<ChatMessage>('SELECT data FROM messages WHERE id = ?', id)
    if (!message || this.conversation(message.conversationId)?.ownerId !== this.currentAccountId) return
    message.deliveryState = deliveryState
    this.write('UPDATE messages SET data = ? WHERE id = ?', JSON.stringify(message), id)
  }

  addMessage(message: Omit<ChatMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): ChatMessage {
    const result: ChatMessage = {
      ...message,
      id: message.id ?? randomUUID(),
      createdAt: message.createdAt ?? Date.now()
    }
    return this.tx(() => {
      this.insertMessage(result)
      const conversation = this.conversation(message.conversationId)
      if (conversation) {
        conversation.updatedAt = result.createdAt
        const topic = conversation.topics.find((item) => item.id === result.topicId)
        if (topic) {
          topic.updatedAt = result.createdAt
          // The first human line names the topic, the way a chat thread is titled.
          if (!topic.title && result.authorId === 'user') {
            topic.title = (result.text || result.attachments?.map((attachment) => attachment.name).join(', ') || 'Image').slice(0, 80)
          }
        }
        this.putConversation(conversation)
      }
      return result
    })
  }

  addDeliveryReplies(deliveryId: string, replies: MessageDeliveryReply[]): void {
    if (!replies.length) return
    this.tx(() => {
      const message = this.one<ChatMessage>(
        `SELECT messages.data AS data
         FROM messages, json_each(messages.data, '$.deliveries') AS delivery
         WHERE json_extract(delivery.value, '$.id') = ?
         ORDER BY messages.rowid DESC LIMIT 1`,
        deliveryId
      )
      const delivery = message?.deliveries?.find((candidate) => candidate.id === deliveryId)
      if (!message || !delivery) return
      const known = new Set(delivery.replies?.map((reply) => reply.id) ?? [])
      delivery.replies = [...(delivery.replies ?? []), ...replies.filter((reply) => !known.has(reply.id))]
      this.write('UPDATE messages SET data = ? WHERE id = ?', JSON.stringify(message), message.id)
    })
  }

  addPrivateMessages(messages: PrivateMessage[]): void {
    if (!messages.length) return
    this.tx(() => {
      for (const message of messages) {
        this.write(
          `INSERT INTO privateMessages (id, conversationId, topicId, senderId, recipientId, createdAt, data)
           VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
          message.id,
          message.conversationId,
          message.topicId,
          message.sender.id,
          message.recipient.id,
          message.createdAt,
          JSON.stringify(message)
        )
      }
      this.write(
        'DELETE FROM privateMessages WHERE rowid NOT IN (SELECT rowid FROM privateMessages ORDER BY rowid DESC LIMIT ?)',
        PRIVATE_MESSAGE_LIMIT
      )
    })
  }

  deleteMessage(conversationId: string, messageId: string): void {
    this.tx(() => {
      const conversation = this.conversation(conversationId)
      if (conversation?.remoteRoomId) {
        const cleared = new Set(this.socialClearedMessageIds(conversationId))
        cleared.add(messageId)
        this.setAccountMeta(`socialClearedMessages:${conversationId}`, JSON.stringify([...cleared]), conversation.ownerId)
      }
      this.write('DELETE FROM messages WHERE conversationId = ? AND id = ?', conversationId, messageId)
    })
  }

  clearConversation(conversationId: string, topicId?: string): void {
    this.tx(() => {
      const remote = this.conversation(conversationId)
      if (remote?.remoteRoomId) {
        const cleared = new Set(this.socialClearedMessageIds(conversationId))
        for (const message of this.topicMessages(conversationId, DEFAULT_TOPIC_ID)) cleared.add(message.id)
        this.setAccountMeta(`socialClearedMessages:${conversationId}`, JSON.stringify([...cleared]), remote.ownerId)
        remote.unread = 0
        remote.manuallyUnread = false
        this.putConversation(remote)
      }
      if (topicId === undefined) {
        this.write('DELETE FROM groupGames WHERE conversationId = ?', conversationId)
        this.write('DELETE FROM groupWorkflows WHERE conversationId = ?', conversationId)
        this.write('DELETE FROM messages WHERE conversationId = ?', conversationId)
        this.write('DELETE FROM privateMessages WHERE conversationId = ?', conversationId)
        return
      }
      this.write('DELETE FROM messages WHERE conversationId = ? AND topicId = ?', conversationId, topicId)
      this.write('DELETE FROM privateMessages WHERE conversationId = ? AND topicId = ?', conversationId, topicId)
      this.write('DELETE FROM groupGames WHERE conversationId = ? AND topicId = ?', conversationId, topicId)
      this.write('DELETE FROM groupWorkflows WHERE conversationId = ? AND topicId = ?', conversationId, topicId)
      const conversation = this.conversation(conversationId)
      const topic = conversation?.topics.find((item) => item.id === topicId)
      if (conversation && topic) {
        topic.title = ''
        this.putConversation(conversation)
      }
    })
  }

  // ───────────────────────────── routines & runs ─────────────────────────────

  createRoutine(input: CreateRoutineInput, nextRunAt: number): Routine {
    const now = Date.now()
    const ownerId = this.currentAccountId
    if (!ownerId) throw new Error('Sign in before creating a scheduled task')
    const routine: Routine = {
      ...input,
      ownerId,
      id: randomUUID(),
      target: 'local',
      enabled: true,
      nextRunAt,
      createdAt: now,
      updatedAt: now
    }
    this.putRoutine(routine)
    return routine
  }

  deleteRoutine(routineId: string): void {
    this.write('DELETE FROM routines WHERE id = ?', routineId)
  }

  private routine(routineId: string): Routine | undefined {
    return this.one<Routine>('SELECT data FROM routines WHERE id = ?', routineId)
  }

  setRoutineEnabled(routineId: string, enabled: boolean, nextRunAt?: number): Routine | undefined {
    const routine = this.routine(routineId)
    if (!routine) return undefined
    routine.enabled = enabled
    if (nextRunAt !== undefined) routine.nextRunAt = nextRunAt
    routine.updatedAt = Date.now()
    this.putRoutine(routine)
    return routine
  }

  markRoutineTriggered(routineId: string, triggeredAt: number, nextRunAt: number): Routine | undefined {
    const routine = this.routine(routineId)
    if (!routine) return undefined
    routine.lastRunAt = triggeredAt
    routine.nextRunAt = nextRunAt
    routine.updatedAt = triggeredAt
    this.putRoutine(routine)
    return routine
  }

  createRun(
    input: Omit<TaskRun, 'id' | 'status' | 'createdAt' | 'target'> & { status?: RunStatus; createdAt?: number }
  ): TaskRun {
    const routineOwnerId = input.routineId ? this.routine(input.routineId)?.ownerId : undefined
    const agentOwnerId = this.agent(input.agentId)?.ownerId
    const run: TaskRun = {
      ...input,
      ownerId: (input.ownerId ?? routineOwnerId ?? agentOwnerId ?? this.currentAccountId) || undefined,
      id: randomUUID(),
      target: 'local',
      status: input.status ?? 'queued',
      createdAt: input.createdAt ?? Date.now()
    }
    return this.tx(() => {
      this.putRun(run)
      // Oldest runs fall off the back; their events cascade with them.
      this.write('DELETE FROM runs WHERE rowid NOT IN (SELECT rowid FROM runs ORDER BY rowid DESC LIMIT ?)', RUN_LIMIT)
      return run
    })
  }

  updateRun(
    runId: string,
    patch: Partial<Pick<TaskRun, 'status' | 'latestActivity' | 'error' | 'startedAt' | 'finishedAt'>>
  ): TaskRun | undefined {
    const run = this.one<TaskRun>('SELECT data FROM runs WHERE id = ?', runId)
    if (!run) return undefined
    Object.assign(run, patch)
    this.putRun(run)
    return run
  }

  addRunEvent(input: Omit<RunEvent, 'id' | 'createdAt'> & { createdAt?: number }): RunEvent {
    const event: RunEvent = {
      ...input,
      id: randomUUID(),
      createdAt: input.createdAt ?? Date.now()
    }
    return this.tx(() => {
      const parent = this.stmt('SELECT 1 FROM runs WHERE id = ?').get(event.runId)
      if (!parent) return event
      this.write(
        'INSERT INTO runEvents (id, runId, createdAt, data) VALUES (?, ?, ?, ?)',
        event.id,
        event.runId,
        event.createdAt,
        JSON.stringify(event)
      )
      this.write(
        'DELETE FROM runEvents WHERE rowid NOT IN (SELECT rowid FROM runEvents ORDER BY rowid DESC LIMIT ?)',
        RUN_EVENT_LIMIT
      )
      return event
    })
  }
}
