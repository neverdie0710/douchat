import { runLocalAgent } from './localAgentRuntime'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import type {
  AgentConfig,
  AgentStatus,
  AppSnapshot,
  EndpointInput,
  EndpointSettings,
  EndpointTestResult,
  ModelOption,
  ChatMessage,
  MessageAttachment,
  Conversation,
  ConversationActivityState,
  ConversationPhase,
  PrivateMessage,
  Routine,
  RunTrigger,
  RuntimeStatus
} from '../shared/types'
import {
  a2aReplyMessages,
  directA2ASessionId,
  directA2ASourcePrompt,
  directA2ATargetPrompt,
  type A2AMessage
} from '../shared/bot/a2a'
import { summarizeRuntimeError } from '../shared/bot/errors'
import { botGreetingPrompt } from '../shared/bot/greeting'
import { botIdentityPrompt } from '../shared/bot/identity'
import { CLOUD_MODEL_OPTIONS } from '../shared/models'
import {
  groupControllerSessionId,
  groupConversationPrompt,
  groupDecisionPrompt,
  groupLeadMember,
  groupMemberSessionId,
  runGroupConversation,
  type BotGroup,
  type GroupDecisionContext,
  type GroupMember,
  type GroupMessage,
  type GroupReply,
  type GroupTurn
} from '../shared/bot/group'
import { addressesEveryone, mentionedMembers } from '../shared/bot/mentions'
import { botReplyPrompt, splitBotReply } from '../shared/bot/messages'
import { directReplyPrompt, privateReplyDeliveries, type PrivateDelivery } from '../shared/bot/privateMessages'
import type { ComputerProvider } from './computer'
import {
  fetchGatewayModels,
  gatewayEnvConfig,
  gatewayProvider,
  isGatewayConfig,
  normalizeBaseUrl,
  GATEWAY_PROVIDER_ID,
  GATEWAY_PROVIDER_NAME,
  type GatewayConfig
} from './gateway'
import { DouchatStore } from './store'

/**
 * Nothing is faked when no model is reachable: a bot that cannot call a model
 * says so instead of answering, so the transcript only ever holds real replies.
 */
const NO_MODEL =
  'No cloud model is available for this account — try again later, or give this bot a local agent.'

function noModelError(agent: AgentConfig): Error {
  return new Error(`${agent.name} has no model to answer with. ${NO_MODEL}`)
}

function compact(value: unknown): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  return raw.length > 180 ? `${raw.slice(0, 177)}…` : raw
}

/** The controller answers with JSON; tolerate fences and surrounding prose. */
function parseDecisionJson(text: string): unknown {
  const withoutFences = text.replace(/```(?:json)?/gi, '').trim()
  const start = withoutFences.indexOf('{')
  if (start < 0) throw new Error('The dispatch model did not return JSON')
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < withoutFences.length; index += 1) {
    const character = withoutFences[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '"') inString = !inString
    if (inString) continue
    if (character === '{') depth += 1
    if (character === '}') {
      depth -= 1
      if (depth === 0) return JSON.parse(withoutFences.slice(start, index + 1))
    }
  }
  throw new Error('The dispatch model returned an incomplete decision')
}

/** A bot's persona: the identity the user configured, not its model. */
export function botDescription(agent: AgentConfig): string {
  return [agent.role.trim(), agent.instructions.trim()].filter(Boolean).join(' — ')
}

function asMember(agent: AgentConfig): GroupMember {
  return { id: agent.id, name: agent.name, description: botDescription(agent) }
}

interface Session {
  agentId: string
  agent: Agent
}

export interface CloudGatewayOptions {
  baseUrl: string
  resolveAccessToken: () => string | undefined
  onUnauthorized?: () => void | Promise<void>
}

export class DouchatRuntime {
  private readonly models = builtinModels()
  private readonly localRuns = new Map<string, Set<AbortController>>()
  private readonly sessions = new Map<string, Session>()
  private readonly statuses = new Map<string, AgentStatus>()
  private readonly busyAgents = new Set<string>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly activeConversation = new Map<string, string>()
  private readonly activeTopic = new Map<string, string>()
  private readonly activeDepth = new Map<string, number>()
  private readonly activeResponded = new Map<string, Set<string>>()
  private readonly activeRun = new Map<string, string>()
  private readonly activity = new Map<string, ConversationActivityState>()
  private readonly aborts = new Map<string, AbortController>()
  private readonly liveAuth = new Map<string, boolean>()
  private modelOptions: ModelOption[] = []
  private connectionError = ''
  private gateway?: GatewayConfig
  private connectionGeneration = 0

  constructor(
    private readonly store: DouchatStore,
    private readonly computer: ComputerProvider,
    private readonly onChange: (snapshot: AppSnapshot) => void,
    private readonly cloudGateway?: CloudGatewayOptions
  ) {
    for (const agent of store.agents) this.statuses.set(agent.id, 'idle')
  }

  snapshot(): AppSnapshot {
    const runs = [...this.store.runs].sort((a, b) => b.createdAt - a.createdAt).slice(0, 60)
    const runIds = new Set(runs.map((run) => run.id))
    return {
      agents: this.store.agents,
      conversations: [...this.store.conversations],
      messages: this.store.recentMessages(),
      privateMessages: this.store.privateMessages,
      activity: [...this.activity.values()],
      computers: this.computer.snapshots(),
      routines: [...this.store.routines].sort((a, b) => a.nextRunAt - b.nextRunAt),
      runs,
      runEvents: this.store.runEvents.filter((event) => runIds.has(event.runId)),
      agentStatuses: Object.fromEntries(
        this.store.agents.map((agent) => [agent.id, this.statuses.get(agent.id) ?? 'idle'])
      ),
      runtime: this.runtimeStatus(),
      endpoint: this.endpointSettings(),
      models: this.availableCloudModels(),
      userName: this.store.userName,
      userAvatar: this.store.userAvatar
    }
  }

  private emit(): void {
    this.onChange(this.snapshot())
  }

  /** A signed-in account always uses first-party Cloud Chat. The old custom
   * endpoint remains available as an advanced fallback for scripted setups. */
  private gatewayConfig(): GatewayConfig {
    if (this.cloudGateway) {
      if (!this.cloudGateway.resolveAccessToken()) return { baseUrl: normalizeBaseUrl(this.cloudGateway.baseUrl) }
      return {
        baseUrl: normalizeBaseUrl(this.cloudGateway.baseUrl),
        resolveApiKey: this.cloudGateway.resolveAccessToken,
        authName: 'Douchat account',
        authSource: 'desktop session',
        providerName: 'Douchat Cloud',
        onUnauthorized: this.cloudGateway.onUnauthorized
      }
    }
    const saved = this.store.endpoint
    if (saved?.baseUrl && saved.apiKey) return { baseUrl: normalizeBaseUrl(saved.baseUrl), apiKey: saved.apiKey }
    return gatewayEnvConfig()
  }

  private endpointSettings(): EndpointSettings {
    if (this.cloudGateway) {
      return {
        baseUrl: normalizeBaseUrl(this.cloudGateway.baseUrl),
        hasApiKey: Boolean(this.cloudGateway.resolveAccessToken()),
        source: 'account'
      }
    }
    const saved = this.store.endpoint
    if (saved?.baseUrl && saved.apiKey) {
      return { baseUrl: normalizeBaseUrl(saved.baseUrl), hasApiKey: true, source: 'settings' }
    }
    const env = gatewayEnvConfig()
    if (isGatewayConfig(env)) return { baseUrl: env.baseUrl, hasApiKey: true, source: 'env' }
    return { baseUrl: saved?.baseUrl ?? env.baseUrl, hasApiKey: false, source: 'none' }
  }

  /** Save an endpoint from the app's settings and reconnect immediately. */
  async setEndpoint(input: EndpointInput): Promise<void> {
    const baseUrl = normalizeBaseUrl(input.baseUrl ?? '')
    const apiKey = input.apiKey?.trim() || (this.store.endpoint?.baseUrl ? this.store.endpoint.apiKey : '')
    this.store.setEndpoint(baseUrl && apiKey ? { baseUrl, apiKey } : undefined)
    await this.connect()
  }

  /** Check an endpoint before saving it, without touching the live catalog. */
  async testEndpoint(input: EndpointInput): Promise<EndpointTestResult> {
    const baseUrl = normalizeBaseUrl(input.baseUrl ?? '')
    const apiKey = input.apiKey?.trim() || (this.store.endpoint?.baseUrl ? this.store.endpoint.apiKey : '')
    if (!baseUrl || !apiKey) return { ok: false, models: 0, error: 'A base URL and an API key are both required' }
    try {
      const models = await fetchGatewayModels({ baseUrl, apiKey })
      return models.length
        ? { ok: true, models: models.length }
        : { ok: false, models: 0, error: 'The endpoint returned no chat models' }
    } catch (cause) {
      return { ok: false, models: 0, error: cause instanceof Error ? cause.message : 'The endpoint could not be reached' }
    }
  }

  private runtimeStatus(): RuntimeStatus {
    const config = this.gatewayConfig()
    const endpoint = config.baseUrl
    if (isGatewayConfig(config)) {
      const host = endpoint.replace(/^https?:\/\//, '')
      return {
        mode: this.modelOptions.length ? 'live' : 'offline',
        label: this.modelOptions.length
          ? `${config.providerName || GATEWAY_PROVIDER_NAME} · ${host}`
          : `${config.providerName || GATEWAY_PROVIDER_NAME} unavailable`,
        endpoint,
        ...(this.connectionError ? { error: this.connectionError } : {})
      }
    }
    const live = this.store.agents.some((agent) => this.hasLikelyAuth(agent.provider))
    return {
      mode: live ? 'live' : 'offline',
      label: live ? 'Connected' : 'No model connected'
    }
  }

  /**
   * Register the configured OpenAI-compatible endpoint and adopt its catalog.
   * Bots saved against a model this endpoint does not serve are moved to its
   * default model, so a fresh install answers without hand-editing every bot.
   */
  async connect(): Promise<void> {
    const generation = ++this.connectionGeneration
    const config = this.gatewayConfig()
    this.gateway = config
    if (!isGatewayConfig(config)) {
      this.models.deleteProvider(GATEWAY_PROVIDER_ID)
      this.modelOptions = []
      this.connectionError = ''
      this.emit()
      return
    }
    try {
      const models = await fetchGatewayModels(config)
      if (generation !== this.connectionGeneration) return
      if (!models.length) {
        throw new Error(
          config.providerName === 'Douchat Cloud'
            ? 'Douchat Cloud Chat is not enabled or its upstream model is not configured.'
            : 'The endpoint returned no chat models.'
        )
      }
      this.models.setProvider(gatewayProvider(models, config))
      this.modelOptions = models.map((model) => ({
        provider: GATEWAY_PROVIDER_ID,
        model: model.id,
        label: model.name === model.id ? model.id : `${model.name} · ${model.id}`
      }))
      this.connectionError = ''
      this.liveAuth.clear()
      // The gateway is the endpoint: a bot saved against another provider (or
      // against a model this endpoint dropped) moves onto the served catalog.
      const fallback = this.modelOptions[0]
      if (fallback) {
        for (const agent of this.store.agents) {
          if (agent.localAgentId) continue
          const served = Boolean(this.models.getModel(GATEWAY_PROVIDER_ID, agent.model))
          if (agent.provider === GATEWAY_PROVIDER_ID && served) continue
          this.store.updateAgent(agent.id, {
            provider: GATEWAY_PROVIDER_ID,
            model: served ? agent.model : fallback.model
          })
        }
      }
      console.log(`[douchat] connected to ${config.baseUrl} · ${models.length} chat models`)
    } catch (cause) {
      if (generation !== this.connectionGeneration) return
      this.models.deleteProvider(GATEWAY_PROVIDER_ID)
      this.modelOptions = []
      this.connectionError = cause instanceof Error ? cause.message : 'The gateway could not be reached'
      // A silent connection failure is what makes the app look broken.
      console.error(`[douchat] endpoint ${config.baseUrl} failed:`, cause)
    }
    this.emit()
  }

  private hasLikelyAuth(provider: string): boolean {
    if (provider === GATEWAY_PROVIDER_ID) return isGatewayConfig(this.gatewayConfig())
    if (provider === 'google-vertex') {
      const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
        join(homedir(), '.config', 'gcloud', 'application_default_credentials.json')
      return Boolean(
        existsSync(credentials) &&
        (process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT) &&
        process.env.GOOGLE_CLOUD_LOCATION
      )
    }
    const variables: Record<string, string[]> = {
      openai: ['OPENAI_API_KEY'],
      anthropic: ['ANTHROPIC_API_KEY'],
      google: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
      openrouter: ['OPENROUTER_API_KEY'],
      deepseek: ['DEEPSEEK_API_KEY']
    }
    return (variables[provider] ?? []).some((name) => Boolean(process.env[name]))
  }

  /** The renderer needs the models that can really answer now. Endpoint
   * catalogs win; otherwise only providers with credentials are advertised. */
  private availableCloudModels(): ModelOption[] {
    if (this.cloudGateway) return this.modelOptions
    if (this.modelOptions.length) return this.modelOptions
    return CLOUD_MODEL_OPTIONS.filter((option) => this.hasLikelyAuth(option.provider))
  }

  /** Cloud contacts do not own a model preference. Bind new contacts to the
   * service's first advertised model and let resolveModel keep following the
   * service default if that catalog changes. */
  defaultCloudAgentModel(): Pick<AgentConfig, 'provider' | 'model'> {
    const fallback = this.modelOptions[0] ?? this.availableCloudModels()[0]
    return fallback
      ? { provider: fallback.provider, model: fallback.model }
      : { provider: GATEWAY_PROVIDER_ID, model: 'default' }
  }

  /** A bot keeps answering when its saved model disappears from the catalog. */
  private resolveModel(config: AgentConfig): ReturnType<typeof this.models.getModel> {
    const fallback = this.modelOptions[0]
    if (fallback) {
      return (
        this.models.getModel(GATEWAY_PROVIDER_ID, config.model) ??
        this.models.getModel(GATEWAY_PROVIDER_ID, fallback.model)
      )
    }
    return this.models.getModel(config.provider, config.model)
  }

  private async canRunLive(agent: AgentConfig): Promise<boolean> {
    if (agent.localAgentId) return true
    // One configured endpoint answers for every bot, whatever a bot has saved.
    if (isGatewayConfig(this.gatewayConfig())) return this.modelOptions.length > 0
    const cached = this.liveAuth.get(agent.provider)
    if (cached !== undefined) return cached
    let live = false
    try {
      live = Boolean(await this.models.checkAuth(agent.provider))
    } catch {
      live = false
    }
    this.liveAuth.set(agent.provider, live)
    return live
  }

  // ───────────────────────────── activity ─────────────────────────────

  private setActivity(
    conversationId: string,
    topicId: string,
    phase: ConversationPhase,
    agentIds: string[],
    label: string,
    extra: Partial<ConversationActivityState> = {}
  ): void {
    const current = this.activity.get(conversationId)
    this.activity.set(conversationId, {
      conversationId,
      topicId,
      phase,
      agentIds,
      label,
      startedAt: current?.phase === phase && current.topicId === topicId ? current.startedAt : Date.now(),
      takeover: extra.takeover ?? current?.takeover,
      limited: extra.limited,
      failed: extra.failed
    })
    this.emit()
  }

  private clearActivity(conversationId: string): void {
    this.activity.delete(conversationId)
    this.emit()
  }

  // ───────────────────────────── sessions ─────────────────────────────

  private systemPrompt(config: AgentConfig, context: 'direct' | 'group' | 'controller'): string {
    const identity = botIdentityPrompt({ name: config.name, description: botDescription(config) })
    const workspace =
      context === 'controller'
        ? 'You are acting as the hidden dispatch controller for a group chat. Answer with JSON only and never call a tool.'
        : [
            `You are ${config.name}, the ${config.role} in a desktop workspace where several bots and one human talk together.`,
            context === 'group'
              ? 'You are replying inside a group chat. Other members see your public text; use the private transport described in the request when a message is meant for one recipient.'
              : 'You are replying in your private chat with the human.',
            'You have a private browser computer. Use computer_open to navigate, computer_snapshot before interacting, and only use refs from the latest snapshot. You may inspect and organize Downloads, Desktop, and Documents with computer_list_files, computer_make_directory, and computer_move_file. File moves never overwrite and deletion is unavailable. Never claim a computer action or handoff happened without calling its tool.'
          ].join('\n')
    return [config.instructions, identity, workspace].filter(Boolean).join('\n\n')
  }

  private session(config: AgentConfig, sessionKey: string, context: 'direct' | 'group' | 'controller'): Agent {
    const existing = this.sessions.get(sessionKey)
    if (existing) return existing.agent

    const model = this.resolveModel(config)
    if (!model) throw new Error(`Model ${config.provider}/${config.model} is not available`)

    const tools =
      context === 'controller'
        ? []
        : context === 'group'
          ? this.computer.createTools(config.id)
          : [this.messageAgentTool(config), ...this.computer.createTools(config.id)]

    const agent = new Agent({
      initialState: {
        systemPrompt: this.systemPrompt(config, context),
        model,
        thinkingLevel: 'low',
        tools
      },
      streamFn: (selectedModel, streamContext, options) =>
        this.models.streamSimple(selectedModel, streamContext, options)
    })

    agent.subscribe((event) => {
      const runId = this.activeRun.get(config.id)
      if (!runId) return
      if (event.type === 'tool_execution_start') {
        this.store.updateRun(runId, { latestActivity: event.toolName })
        this.store.addRunEvent({ runId, type: 'tool', label: `${config.name} · ${event.toolName}`, detail: compact(event.args) })
        this.emit()
      }
      if (event.type === 'tool_execution_end' && event.isError) {
        this.store.addRunEvent({
          runId,
          type: 'tool',
          label: `${config.name} · ${event.toolName} failed`,
          detail: compact(event.result)
        })
        this.emit()
      }
    })
    this.sessions.set(sessionKey, { agentId: config.id, agent })
    return agent
  }

  /** Direct chats keep the inline delegation tool; group members route through
   * the group's own public and private transports instead. */
  private messageAgentTool(config: AgentConfig): AgentTool<ReturnType<typeof Type.Object>> {
    const messageAgentParameters = Type.Object({
      agent: Type.String({ description: 'The exact name or id of the target agent' }),
      message: Type.String({ description: 'A self-contained question or task for the target agent' })
    })
    const tool: AgentTool<typeof messageAgentParameters> = {
      name: 'message_agent',
      label: 'Message agent',
      description:
        'Send a question or delegated task to another bot in the workspace and wait for its answer. Use this when another specialist can improve your own reply.',
      parameters: messageAgentParameters,
      execute: async (_toolCallId, params) => {
        const target = this.store.agents.find(
          (agent) => agent.id === params.agent || agent.name.toLowerCase() === params.agent.toLowerCase()
        )
        if (!target) {
          return {
            content: [{ type: 'text' as const, text: `No bot named “${params.agent}” exists.` }],
            details: { delivered: false }
          }
        }
        if (target.id === config.id || this.busyAgents.has(target.id)) {
          return {
            content: [{ type: 'text' as const, text: `${target.name} is already working and cannot take this handoff.` }],
            details: { delivered: false }
          }
        }

        const conversationId = this.activeConversation.get(config.id)
        const topicId = this.activeTopic.get(config.id)
        if (!conversationId || !topicId) {
          return {
            content: [{ type: 'text' as const, text: 'No active conversation for this handoff.' }],
            details: { delivered: false }
          }
        }
        const depth = this.activeDepth.get(config.id) ?? 0
        if (depth >= 2) {
          return {
            content: [{ type: 'text' as const, text: 'Handoff depth reached. Continue with the context already available.' }],
            details: { delivered: false }
          }
        }

        this.store.addMessage({
          conversationId,
          topicId,
          authorId: config.id,
          authorName: config.name,
          text: `${config.name} → ${target.name} · ${params.message}`,
          kind: 'handoff'
        })
        this.emit()
        const responded = this.activeResponded.get(config.id) ?? new Set<string>()
        responded.add(target.id)
        const runId = this.activeRun.get(config.id)
        const reply = await this.enqueueAgent(target.id, () =>
          this.runReply({
            config: target,
            sessionKey: `handoff:${conversationId}:${topicId}:${target.id}`,
            context: 'direct',
            prompt: botReplyPrompt(`[Message from ${config.name}] ${params.message}`),
            conversationId,
            topicId,
            runId,
            depth: depth + 1,
            responded
          })
        )
        if (reply.text.trim() || reply.attachments?.length) {
          this.saveBubbles(conversationId, topicId, target, reply.text, { attachments: reply.attachments })
          this.emit()
        }
        return {
          content: [{ type: 'text' as const, text: `${target.name} replied: ${reply.text || reply.error || 'no answer'}` }],
          details: { delivered: true, agentId: target.id }
        }
      }
    }
    return tool as unknown as AgentTool<ReturnType<typeof Type.Object>>
  }

  private enqueueAgent<T>(agentId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(agentId) ?? Promise.resolve()
    const execution = previous.catch(() => undefined).then(task)
    const settled = execution.then(
      () => undefined,
      () => undefined
    )
    this.queues.set(agentId, settled)
    void settled.finally(() => {
      if (this.queues.get(agentId) === settled) this.queues.delete(agentId)
    })
    return execution
  }

  /** One model turn for one bot. Never throws: failures come back as text. */
  private async runReply({
    config,
    sessionKey,
    context,
    prompt,
    conversationId,
    topicId,
    runId,
    depth = 0,
    responded = new Set<string>(),
    signal
  }: {
    config: AgentConfig
    sessionKey: string
    context: 'direct' | 'group' | 'controller'
    prompt: string
    conversationId: string
    topicId: string
    runId?: string
    depth?: number
    responded?: Set<string>
    signal?: AbortSignal
  }): Promise<{ text: string; error?: string; attachments?: MessageAttachment[] }> {
    this.statuses.set(config.id, 'thinking')
    this.busyAgents.add(config.id)
    this.activeConversation.set(config.id, conversationId)
    this.activeTopic.set(config.id, topicId)
    this.activeDepth.set(config.id, depth)
    this.activeResponded.set(config.id, responded)
    if (runId) this.activeRun.set(config.id, runId)
    this.emit()

    try {
      if (config.localAgentId) {
        // The topic transcript keeps local CLI turns isolated without sharing
        // a global CLI session across contacts, groups, or topics.
        const history = context === 'direct' && sessionKey.startsWith(`direct:${conversationId}:`)
          ? this.store.topicMessages(conversationId, topicId).slice(-20)
              .map((message) => `${message.authorName}: ${message.text}`).join('\n').slice(-24000)
          : ''
        const abort = new AbortController()
        const forwardAbort = (): void => abort.abort()
        signal?.addEventListener('abort', forwardAbort, { once: true })
        if (signal?.aborted) abort.abort()
        const runs = this.localRuns.get(config.id) ?? new Set<AbortController>()
        runs.add(abort)
        this.localRuns.set(config.id, runs)
        try {
          const reply = await runLocalAgent(config, [
            `You are ${config.name}. Role: ${config.role}.`, config.instructions,
            config.localAgentId === 'codex'
              ? 'When an image is requested, use your image-generation capability. Douchat will attach image files produced by that tool automatically. Never say an image was created or sent unless the tool actually produced the image file.'
              : '',
            history ? `Conversation so far:\n${history}` : '', prompt
          ].filter(Boolean).join('\n\n'), abort.signal)
          const attachments = await Promise.all(reply.images.map((image) => this.store.saveImageAttachment(image)))
          return { text: reply.text, ...(attachments.length ? { attachments } : {}) }
        } finally {
          signal?.removeEventListener('abort', forwardAbort)
          runs.delete(abort)
          if (!runs.size) this.localRuns.delete(config.id)
        }
      }
      const session = this.session(config, sessionKey, context)
      const abort = (): void => session.abort()
      signal?.addEventListener('abort', abort, { once: true })
      try {
        await session.prompt(prompt)
      } finally {
        signal?.removeEventListener('abort', abort)
      }
      const lastMessage = [...session.state.messages].reverse().find((message) => message.role === 'assistant')
      const text = lastMessage && 'content' in lastMessage ? this.readText(lastMessage.content) : ''
      const error = lastMessage && 'errorMessage' in lastMessage ? (lastMessage.errorMessage as string) : undefined
      if (!text.trim() && error) return { text: '', error }
      return { text, error: text.trim() ? undefined : `${config.name} finished without a text response.` }
    } catch (cause) {
      return { text: '', error: cause instanceof Error ? cause.message : 'Unknown runtime error' }
    } finally {
      this.statuses.set(config.id, 'idle')
      this.busyAgents.delete(config.id)
      this.activeConversation.delete(config.id)
      this.activeTopic.delete(config.id)
      this.activeDepth.delete(config.id)
      this.activeResponded.delete(config.id)
      this.activeRun.delete(config.id)
      this.emit()
    }
  }

  private readText(content: unknown): string {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content
      .filter((item): item is { type: 'text'; text: string } =>
        Boolean(item && typeof item === 'object' && 'type' in item && item.type === 'text' && 'text' in item)
      )
      .map((item) => item.text)
      .join('\n')
      .trim()
  }

  // ───────────────────────────── transcripts ─────────────────────────────

  private saveBubbles(
    conversationId: string,
    topicId: string,
    author: AgentConfig,
    text: string,
    extra: Partial<ChatMessage> = {},
    common: Partial<ChatMessage> = {}
  ): ChatMessage[] {
    const blocks = splitBotReply(text)
    if (!blocks.length && extra.attachments?.length) blocks.push('')
    if (!blocks.length) return []
    const replyGroupId = blocks.length > 1 ? randomUUID() : undefined
    const conversation = this.store.conversation(conversationId)
    const members = (conversation?.agentIds ?? [])
      .flatMap((agentId) => {
        const agent = this.store.agent(agentId)
        return agent ? [asMember(agent)] : []
      })
      .filter((member) => member.id !== author.id)
    return blocks.map((block, index) =>
      this.store.addMessage({
        conversationId,
        topicId,
        authorId: author.id,
        authorName: author.name,
        text: block,
        kind: 'message',
        ...common,
        ...(replyGroupId ? { replyGroupId } : {}),
        ...(members.length
          ? { recipients: mentionedMembers(block, members).map((member) => ({ id: member.id, name: member.name })) }
          : {}),
        // Envelopes and errors belong to the closing bubble of a turn.
        ...(index === blocks.length - 1 ? extra : {})
      })
    )
  }

  private groupMessages(conversationId: string, topicId: string): GroupMessage[] {
    return this.store
      .topicMessages(conversationId, topicId)
      .filter((message) => message.kind !== 'system')
      .map((message) => ({
        id: message.id,
        role: message.authorId === 'user' ? ('user' as const) : ('assistant' as const),
        sender: message.authorId === 'user' ? undefined : { id: message.authorId, name: message.authorName },
        recipients: message.recipients,
        content: message.text
      }))
  }

  private group(conversation: Conversation): BotGroup {
    const members = conversation.agentIds.flatMap((agentId) => {
      const agent = this.store.agent(agentId)
      return agent ? [asMember(agent)] : []
    })
    return {
      id: conversation.id,
      name: conversation.name,
      description: conversation.description,
      humanName: this.store.userName,
      leadMemberId: conversation.leadAgentId,
      members
    }
  }

  private storePrivateDeliveries(conversationId: string, topicId: string, deliveries: PrivateDelivery[]): void {
    if (!deliveries.length) return
    const messages: PrivateMessage[] = deliveries.map((delivery) => ({
      id: delivery.id,
      conversationId,
      topicId,
      sender: delivery.sender,
      recipient: delivery.recipient,
      content: delivery.content,
      createdAt: delivery.createdAt
    }))
    this.store.addPrivateMessages(messages)
  }

  /** A private line addressed to the human lands in that bot's direct chat
   * with an unread badge, exactly like a proactive message. */
  private deliverToHumanInbox(group: Conversation, deliveries: PrivateDelivery[]): void {
    for (const delivery of deliveries.filter((message) => message.recipient.id === 'human')) {
      const sender = this.store.agent(delivery.sender.id)
      const direct = this.store.conversations.find(
        (conversation) => conversation.type === 'direct' && conversation.agentIds[0] === delivery.sender.id
      )
      if (!sender || !direct) continue
      this.store.addMessage({
        id: delivery.id,
        conversationId: direct.id,
        topicId: this.store.activeTopicId(direct.id),
        authorId: sender.id,
        authorName: sender.name,
        text: delivery.content,
        kind: 'message',
        source: { kind: 'group', id: group.id, name: group.name },
        createdAt: delivery.createdAt
      })
      this.store.addUnread(direct.id, 1)
    }
  }

  // ───────────────────────────── sending ─────────────────────────────

  async sendMessage(conversationId: string, text: string): Promise<void> {
    if (!this.gateway) await this.connect()
    const conversation = this.store.conversation(conversationId)
    if (!conversation) throw new Error('Conversation not found')
    const content = text.trim()
    if (!content) return
    if (this.aborts.has(conversationId)) throw new Error('This conversation is still replying')

    const topicId = this.store.activeTopicId(conversationId)
    const members = conversation.agentIds.flatMap((agentId) => {
      const agent = this.store.agent(agentId)
      return agent ? [agent] : []
    })
    const recipients = addressesEveryone(content)
      ? members.map(asMember)
      : mentionedMembers(
          content,
          members.map(asMember)
        )
    const user = this.store.addMessage({
      conversationId,
      topicId,
      authorId: 'user',
      authorName: 'You',
      text: content,
      kind: 'message',
      ...(recipients.length ? { recipients: recipients.map((member) => ({ id: member.id, name: member.name })) } : {})
    })
    this.store.markConversationRead(conversationId)
    this.emit()
    if (!members.length) return

    const abort = new AbortController()
    this.aborts.set(conversationId, abort)
    const run = this.store.createRun({
      agentId: conversation.leadAgentId ?? members[0].id,
      conversationId,
      title: conversation.name,
      prompt: content,
      trigger: 'chat'
    })
    this.store.updateRun(run.id, { status: 'running', latestActivity: 'Thinking', startedAt: Date.now() })
    this.store.addRunEvent({ runId: run.id, type: 'status', label: 'Started', status: 'running' })
    try {
      if (conversation.type === 'group') {
        await this.runGroupTurn(conversation, topicId, user, members, run.id, abort.signal)
      } else {
        await this.runDirectTurn(conversation, topicId, members[0], user, run.id, abort.signal)
      }
      this.store.updateRun(run.id, { status: 'succeeded', latestActivity: 'Finished', finishedAt: Date.now() })
      this.store.addRunEvent({ runId: run.id, type: 'status', label: 'Finished', status: 'succeeded' })
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : 'Unknown error'
      const { title, detail } = summarizeRuntimeError(raw)
      this.store.updateRun(run.id, { status: 'failed', latestActivity: 'Failed', error: title, finishedAt: Date.now() })
      this.store.addRunEvent({ runId: run.id, type: 'status', label: title, status: 'failed' })
      this.store.addMessage({
        conversationId,
        topicId,
        authorId: 'system',
        authorName: 'Douchat',
        text: title,
        kind: 'system',
        detail
      })
    } finally {
      this.aborts.delete(conversationId)
      this.clearActivity(conversationId)
      this.emit()
    }
  }

  stopConversation(conversationId: string): void {
    this.aborts.get(conversationId)?.abort()
  }

  // ───────────────────────────── direct chat ─────────────────────────────

  private async runDirectTurn(
    conversation: Conversation,
    topicId: string,
    bot: AgentConfig,
    user: ChatMessage,
    runId: string,
    signal: AbortSignal
  ): Promise<void> {
    if (!(await this.canRunLive(bot))) throw noModelError(bot)
    this.setActivity(conversation.id, topicId, 'replying', [bot.id], bot.name)

    const history = this.store.topicMessages(conversation.id, topicId)
    const peers = this.store.agents.filter((agent) => agent.id !== bot.id).map(asMember)
    const contextual = directReplyPrompt(
      user.text,
      history.map((message) => ({ content: message.text, source: message.source }))
    )
    const prompt = botReplyPrompt(directA2ASourcePrompt(user.text, asMember(bot), peers, contextual === user.text ? '' : contextual))
    const reply = await this.runReply({
      config: bot,
      sessionKey: `direct:${conversation.id}:${topicId}`,
      context: 'direct',
      prompt,
      conversationId: conversation.id,
      topicId,
      runId,
      signal
    })
    if (signal.aborted) return

    const delivery = a2aReplyMessages(reply.text, asMember(bot), peers, user.id + ':' + randomUUID().slice(0, 6))
    // Envelopes never reach the transcript, valid or not: an undeliverable
    // handoff is reported as an error instead of leaking transport syntax.
    const publicText = delivery.publicText
    const failure = reply.error ?? (delivery.invalid ? `${bot.name} could not deliver a message to another bot.` : undefined)
    this.saveBubbles(conversation.id, topicId, bot, publicText, {
      ...(failure ? { error: summarizeRuntimeError(failure).title } : {}),
      ...(reply.attachments?.length ? { attachments: reply.attachments } : {}),
      ...(delivery.messages.length
        ? {
            deliveries: delivery.messages.map((message) => ({
              id: message.id,
              recipientId: message.recipient.id,
              recipientName: message.recipient.name,
              content: message.content
            }))
          }
        : {})
    })
    if (!publicText.trim() && failure && !delivery.messages.length) {
      const summary = summarizeRuntimeError(failure)
      this.store.addMessage({
        conversationId: conversation.id,
        topicId,
        authorId: 'system',
        authorName: 'Douchat',
        text: summary.title,
        kind: 'system',
        detail: summary.detail
      })
    }
    this.emit()

    for (const message of delivery.messages) {
      if (signal.aborted) return
      await this.deliverA2A(message, runId, signal)
    }
  }

  /** The recipient answers in its own inbox, never in the sender's chat. */
  private async deliverA2A(delivery: A2AMessage, runId: string, signal: AbortSignal): Promise<void> {
    const target = this.store.agent(delivery.recipient.id)
    const direct = this.store.conversations.find(
      (conversation) => conversation.type === 'direct' && conversation.agentIds[0] === delivery.recipient.id
    )
    if (!target || !direct) return
    const topicId = this.store.activeTopicId(direct.id)
    this.setActivity(direct.id, topicId, 'delivering', [target.id], `${delivery.sender.name} → ${target.name}`)
    this.store.addRunEvent({
      runId,
      type: 'status',
      label: `${delivery.sender.name} → ${target.name}`,
      detail: compact(delivery.content)
    })
    const reply = await this.enqueueAgent(target.id, () =>
      this.runReply({
        config: target,
        sessionKey: directA2ASessionId(delivery.sender.id, target.id, topicId),
        context: 'direct',
        prompt: botReplyPrompt(directA2ATargetPrompt(delivery, asMember(target))),
        conversationId: direct.id,
        topicId,
        runId,
        signal
      })
    )
    this.clearActivity(direct.id)
    const text = reply.text.trim() || reply.error || ''
    if (!text && !reply.attachments?.length) return
    const saved = this.saveBubbles(
      direct.id,
      topicId,
      target,
      text,
      reply.text.trim() ? { attachments: reply.attachments } : { error: reply.error, attachments: reply.attachments },
      { source: { kind: 'bot', id: delivery.sender.id, name: delivery.sender.name } }
    )
    this.store.addUnread(direct.id, saved.length)
    this.emit()
  }

  // ───────────────────────────── group chat ─────────────────────────────

  private async runGroupTurn(
    conversation: Conversation,
    topicId: string,
    user: ChatMessage,
    members: AgentConfig[],
    runId: string,
    signal: AbortSignal
  ): Promise<void> {
    const group = this.group(conversation)
    const liveness = await Promise.all(members.map((member) => this.canRunLive(member)))
    const anyLive = liveness.some(Boolean)
    const history = this.groupMessages(conversation.id, topicId).filter((message) => message.id !== user.id)
    const userMessage: GroupMessage = {
      id: user.id,
      role: 'user',
      content: user.text,
      recipients: user.recipients
    }
    const privateMessages: PrivateDelivery[] = this.store
      .topicPrivateMessages(conversation.id, topicId)
      .map((message) => ({
        id: message.id,
        sender: message.sender,
        recipient: message.recipient,
        content: message.content,
        createdAt: message.createdAt,
        topicId: message.topicId
      }))

    const unavailableCoordinators = new Set<string>()
    let coordinator = groupLeadMember(group)

    const decide = async (context: GroupDecisionContext): Promise<unknown> => {
      this.setActivity(conversation.id, topicId, 'planning', coordinator ? [coordinator.id] : [], 'Coordinating')
      if (!anyLive) throw new Error(NO_MODEL)
      const candidates = [coordinator, ...group.members.filter((member) => member.id !== coordinator?.id)].filter(
        (member): member is GroupMember => Boolean(member) && !unavailableCoordinators.has(member!.id)
      )
      let lastError = 'No member could coordinate this group'
      for (const candidate of candidates) {
        if (signal.aborted) break
        const config = this.store.agent(candidate.id)
        if (!config || !(await this.canRunLive(config))) {
          unavailableCoordinators.add(candidate.id)
          continue
        }
        this.setActivity(conversation.id, topicId, 'planning', [candidate.id], `${candidate.name} is coordinating`)
        const reply = await this.enqueueAgent(candidate.id, () =>
          this.runReply({
            config,
            sessionKey: groupControllerSessionId(conversation.id, topicId),
            context: 'controller',
            prompt: groupDecisionPrompt(group, context, candidate),
            conversationId: conversation.id,
            topicId,
            signal
          })
        )
        if (reply.text.trim()) {
          try {
            const decision = parseDecisionJson(reply.text)
            coordinator = candidate
            return decision
          } catch (cause) {
            lastError = cause instanceof Error ? cause.message : 'Invalid dispatch decision'
          }
        } else lastError = reply.error ?? lastError
        unavailableCoordinators.add(candidate.id)
        // A controller session that produced nothing usable must not be reused.
        this.disposeSession(groupControllerSessionId(conversation.id, topicId))
      }
      throw new Error(lastError)
    }

    const reply = async (member: GroupMember, turn: GroupTurn, visible: GroupMessage[]): Promise<GroupReply> => {
      const config = this.store.agent(member.id)
      if (!config) return { messages: [], failed: true }
      this.setActivity(conversation.id, topicId, 'replying', [member.id], member.name)
      if (!(await this.canRunLive(config))) return { messages: [], failed: true }

      const prompt = botReplyPrompt(
        groupConversationPrompt(group, member, visible, turn, this.currentPrivateMessages(conversation.id, topicId))
      )
      const outcome = await this.enqueueAgent(member.id, () =>
        this.runReply({
          config,
          sessionKey: groupMemberSessionId(conversation.id, member.id, topicId),
          context: 'group',
          prompt,
          conversationId: conversation.id,
          topicId,
          runId,
          signal
        })
      )
      if (signal.aborted) return { messages: [] }
      if (!outcome.text.trim() && !outcome.attachments?.length) {
        // Failover owns member failures: leave no broken bubble behind.
        this.disposeSession(groupMemberSessionId(conversation.id, member.id, topicId))
        return { messages: [], failed: true }
      }

      const delivery = privateReplyDeliveries(
        outcome.text,
        member,
        group.members,
        `${conversation.id}:${randomUUID().slice(0, 8)}`,
        topicId
      )
      if (delivery.invalid) return { messages: [], failed: true }
      this.storePrivateDeliveries(conversation.id, topicId, delivery.messages)
      this.deliverToHumanInbox(conversation, delivery.messages)
      const saved = this.saveBubbles(conversation.id, topicId, config, delivery.publicText, {
        ...(outcome.attachments?.length ? { attachments: outcome.attachments } : {}),
        ...(delivery.messages.length
          ? {
              deliveries: delivery.messages.map((message) => ({
                id: message.id,
                recipientId: message.recipient.id,
                recipientName: message.recipient.name || 'You',
                content: message.content
              }))
            }
          : {})
      })
      this.emit()
      return { messages: saved.map((message) => this.asGroupMessage(message)), privateMessages: delivery.messages }
    }

    const result = await runGroupConversation({
      group,
      user: userMessage,
      history,
      privateMessages,
      signal,
      decide,
      reply,
      onFailover: ({ unavailableMemberIds, replacementMemberId }) => {
        const lead = groupLeadMember(group)
        if (!lead || !unavailableMemberIds.includes(lead.id)) return
        const replacement = group.members.find((member) => member.id === replacementMemberId)
        if (!replacement || replacement.id === lead.id) return
        this.setActivity(conversation.id, topicId, 'replying', [replacement.id], replacement.name, {
          takeover: { unavailableName: lead.name, replacementName: replacement.name }
        })
      }
    })

    if (result.limited) {
      this.store.addMessage({
        conversationId: conversation.id,
        topicId,
        authorId: 'system',
        authorName: 'Douchat',
        text: 'The group reached its turn limit for this request. Send another message to continue.',
        kind: 'system'
      })
    }
    if (result.failed) {
      this.store.addMessage({
        conversationId: conversation.id,
        topicId,
        authorId: 'system',
        authorName: 'Douchat',
        text: 'No member of this group could complete the request.',
        kind: 'system'
      })
    }
    this.emit()
  }

  private currentPrivateMessages(conversationId: string, topicId: string): PrivateDelivery[] {
    return this.store.topicPrivateMessages(conversationId, topicId).map((message) => ({
      id: message.id,
      sender: message.sender,
      recipient: message.recipient,
      content: message.content,
      createdAt: message.createdAt,
      topicId: message.topicId
    }))
  }

  private asGroupMessage(message: ChatMessage): GroupMessage {
    return {
      id: message.id,
      role: 'assistant',
      sender: { id: message.authorId, name: message.authorName },
      recipients: message.recipients,
      content: message.text
    }
  }

  // ───────────────────────────── greetings ─────────────────────────────

  /** A brand-new topic opens with one proactive line from the bot or lead. */
  async greet(conversationId: string): Promise<void> {
    const conversation = this.store.conversation(conversationId)
    if (!conversation) return
    const topicId = this.store.activeTopicId(conversationId)
    if (this.store.topicMessages(conversationId, topicId).length) return
    const group = conversation.type === 'group' ? this.group(conversation) : undefined
    const speakerId = group ? groupLeadMember(group)?.id : conversation.agentIds[0]
    const speaker = speakerId ? this.store.agent(speakerId) : undefined
    if (!speaker) return

    this.setActivity(conversationId, topicId, 'greeting', [speaker.id], speaker.name)
    try {
      // An unconnected bot opens with nothing: the composer already carries
      // the banner explaining how to connect one.
      if (!(await this.canRunLive(speaker))) return
      const prompt = botGreetingPrompt({
        bot: { id: speaker.id, name: speaker.name, description: botDescription(speaker), labels: speaker.labels },
        group: group
          ? {
              name: group.name,
              description: group.description,
              humanName: this.store.userName,
              members: group.members.map((member) => ({
                id: member.id,
                name: member.name,
                description: member.description
              }))
            }
          : undefined
      })
      const sessionKey = group
        ? groupMemberSessionId(conversationId, speaker.id, topicId)
        : `direct:${conversationId}:${topicId}`
      const reply = await this.enqueueAgent(speaker.id, () =>
        this.runReply({
          config: speaker,
          sessionKey,
          context: group ? 'group' : 'direct',
          prompt,
          conversationId,
          topicId
        })
      )
      const text = reply.text.trim()
      if (text || reply.attachments?.length) {
        this.store.addMessage({
          conversationId,
          topicId,
          authorId: speaker.id,
          authorName: speaker.name,
          text: text.split('\n').filter(Boolean)[0] ?? text,
          kind: 'message',
          attachments: reply.attachments
        })
      }
      this.emit()
    } finally {
      this.clearActivity(conversationId)
    }
  }

  // ───────────────────────────── routines ─────────────────────────────

  async runRoutine(routine: Routine, trigger: Extract<RunTrigger, 'manual' | 'schedule'>): Promise<void> {
    const agent = this.store.agent(routine.agentId)
    if (!agent) throw new Error('The routine agent no longer exists')
    const conversation = this.store.conversation(routine.conversationId)
    if (!conversation) throw new Error('The routine conversation no longer exists')
    const topicId = this.store.activeTopicId(conversation.id)

    this.store.addMessage({
      conversationId: conversation.id,
      topicId,
      authorId: 'system',
      authorName: 'Douchat',
      text: `${trigger === 'schedule' ? 'Scheduled' : 'Manual'} routine started · ${routine.name}`,
      kind: 'system'
    })
    this.emit()

    const run = this.store.createRun({
      agentId: agent.id,
      conversationId: conversation.id,
      routineId: routine.id,
      title: routine.name,
      prompt: routine.prompt,
      trigger
    })
    this.store.updateRun(run.id, { status: 'running', latestActivity: 'Thinking', startedAt: Date.now() })
    this.store.addRunEvent({ runId: run.id, type: 'status', label: 'Started', status: 'running' })
    this.setActivity(conversation.id, topicId, 'replying', [agent.id], agent.name)
    try {
      if (!(await this.canRunLive(agent))) throw noModelError(agent)
      const reply = (
        await this.enqueueAgent(agent.id, () =>
          this.runReply({
            config: agent,
            sessionKey: `routine:${routine.id}`,
            context: 'direct',
            prompt: botReplyPrompt(routine.prompt),
            conversationId: conversation.id,
            topicId,
            runId: run.id
          })
        )
      )
      this.saveBubbles(
        conversation.id,
        topicId,
        agent,
        reply.text || (reply.attachments?.length ? '' : `${agent.name} finished without a text response.`),
        { attachments: reply.attachments }
      )
      this.store.addUnread(conversation.id, 1)
      this.store.updateRun(run.id, { status: 'succeeded', latestActivity: 'Finished', finishedAt: Date.now() })
      this.store.addRunEvent({ runId: run.id, type: 'status', label: 'Finished', status: 'succeeded' })
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : 'Unknown runtime error'
      const { title } = summarizeRuntimeError(raw)
      this.store.updateRun(run.id, { status: 'failed', latestActivity: 'Failed', error: title, finishedAt: Date.now() })
      this.store.addRunEvent({ runId: run.id, type: 'status', label: title, status: 'failed' })
    } finally {
      this.clearActivity(conversation.id)
      this.emit()
    }
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  private disposeSession(sessionKey: string): void {
    const session = this.sessions.get(sessionKey)
    if (!session) return
    session.agent.abort()
    session.agent.reset()
    this.sessions.delete(sessionKey)
  }

  resetConversation(conversationId: string, topicId?: string): void {
    const prefixes = [
      `direct:${conversationId}:`,
      `group:${encodeURIComponent(conversationId)}:`,
      `handoff:${conversationId}:`
    ]
    for (const key of [...this.sessions.keys()]) {
      if (!prefixes.some((prefix) => key.startsWith(prefix))) continue
      if (topicId && !key.includes(encodeURIComponent(topicId)) && !key.includes(topicId)) continue
      this.disposeSession(key)
    }
  }

  disposeAgent(agentId: string): void {
    for (const abort of this.localRuns.get(agentId) ?? []) abort.abort()
    this.localRuns.delete(agentId)
    for (const [key, session] of [...this.sessions]) {
      if (session.agentId !== agentId && !key.includes(encodeURIComponent(agentId))) continue
      this.disposeSession(key)
    }
    void this.computer.stop(agentId)
    this.statuses.delete(agentId)
  }
}
