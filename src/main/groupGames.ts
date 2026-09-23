import { gameText, GameRuleError } from '../shared/gameText'
import type { InterfaceLanguage } from '../shared/language'
import { randomInt, randomUUID } from 'node:crypto'
import { applyGameAction, createGame, gamePlayerView, nextGameTurn, skipGameTurn, type GameAction, type GameState } from '../shared/groupGame'
import { decisionJson } from '../shared/groupDecision'
import type { AgentConfig } from '../shared/types'
import type { DouchatStore } from './store'

export class GroupGames {
  private running = new Map<string, { abort: AbortController; promise: Promise<void> }>()
  constructor(private store: DouchatStore, private callbacks: {
    language?: () => InterfaceLanguage
    reply: (agent: AgentConfig, prompt: string, key: string, signal: AbortSignal) => Promise<string>
    changed: () => void
    activity: (game: GameState, actorId?: string) => void
  }) {}

  active(conversationId: string, topicId: string): GameState | undefined {
    return this.store.groupGames().find(game => game.conversationId === conversationId && game.topicId === topicId && !['finished', 'cancelled'].includes(game.status))
  }

  async start(conversationId: string, input: { kind: 'undercover' | 'werewolf'; includeHuman: boolean; agentIds: string[]; language?: InterfaceLanguage }): Promise<void> {
    const language = input?.language ?? this.callbacks.language?.() ?? 'en'
    const conversation = this.store.conversation(conversationId)
    if (!conversation || conversation.ownerId !== this.store.currentAccountId || conversation.type !== 'group' || conversation.remoteRoomId) throw new GameRuleError("Select a local group owned by your account.", language)
    if (!input || !['undercover', 'werewolf'].includes(input.kind) || typeof input.includeHuman !== 'boolean'
      || !Array.isArray(input.agentIds) || input.agentIds.some(id => !conversation.agentIds.includes(id))) throw new GameRuleError("Invalid game player configuration.", language)
    const topicId = this.store.activeTopicId(conversation.id)
    if (this.active(conversation.id, topicId)) throw new GameRuleError("This topic already has a game. End it first.", language)
    const agents = input.agentIds.map(id => this.store.agent(id)).filter((agent): agent is AgentConfig => Boolean(agent))
    if (agents.some(agent => agent.localAgentId)) throw new GameRuleError("Fair-game tests require isolated cloud agents without tools. Use a cloud-only test group.", language)
    if (agents.some(agent => agent.ownerId !== this.store.currentAccountId)) throw new GameRuleError("Only agents owned by your account may play.", language)
    const game = createGame({ id: randomUUID(), conversationId: conversation.id, topicId, ownerId: this.store.currentAccountId,
      language, kind: input.kind, players: [...agents.map(agent => ({ id: agent.id, name: agent.name })),
        ...(input.includeHuman ? [{ id: 'human', name: this.store.userName || gameText(language, 'You'), human: true }] : [])],
      seed: randomInt(1, 0x7fffffff), now: Date.now() })
    this.store.commitGame(game)
    this.callbacks.changed()
    await this.pump(game.id)
  }

  async act(id: string, action: GameAction): Promise<void> {
    const language = this.store.groupGame(id)?.language ?? this.callbacks.language?.() ?? 'en'
    if (!action || typeof action.slotId !== 'string' || action.actorId !== 'human') throw new GameRuleError("You may only submit your own actions.", language)
    const game = this.store.groupGame(id)
    if (!game) throw new GameRuleError("Game not found.", language)
    this.store.commitGame(applyGameAction(game, action), game.revision)
    this.callbacks.changed()
    await this.pump(id)
  }

  async control(id: string, action: 'pause' | 'resume' | 'cancel'): Promise<void> {
    const language = this.store.groupGame(id)?.language ?? this.callbacks.language?.() ?? 'en'
    if (!['pause', 'resume', 'cancel'].includes(action)) throw new GameRuleError("Invalid game control.", language)
    const game = this.store.groupGame(id)
    if (!game || ['finished', 'cancelled'].includes(game.status)) throw new GameRuleError("The game has ended or no longer exists.", language)
    const job = this.running.get(id)
    job?.abort.abort()
    if (job) await job.promise
    // Account and revision can change while cancellation settles.
    const current = this.store.groupGame(id)
    if (!current || ['finished', 'cancelled'].includes(current.status)) return
    const next = { ...current, revision: current.revision + 1, error: undefined,
      status: (action === 'cancel' ? 'cancelled' : action === 'pause' ? 'paused'
        : current.players.find(player => player.id === current.pending[0])?.human ? 'waiting' : 'running') as GameState['status'] }
    this.store.commitGame(next, current.revision)
    this.callbacks.changed()
    if (action === 'resume') await this.pump(id)
  }

  recover(): void {
    for (const game of this.store.groupGames()) if (game.status === 'running') void this.pump(game.id)
  }
  stopAll(): void { for (const job of this.running.values()) job.abort.abort() }

  async pump(id: string): Promise<void> {
    const existing = this.running.get(id)
    if (existing) {
      await existing.promise
      // A human may submit immediately after the preceding public result appears.
      if (this.store.groupGame(id)?.status === 'running') return this.pump(id)
      return
    }
    const abort = new AbortController()
    const job = { abort, promise: Promise.resolve() }
    this.running.set(id, job)
    job.promise = this.execute(id, abort.signal).finally(() => {
      this.running.delete(id)
      const game = this.store.groupGame(id)
      if (game) this.callbacks.activity(game)
      this.callbacks.changed()
    })
    await job.promise
  }

  private async execute(id: string, signal: AbortSignal): Promise<void> {
    const ownerId = this.store.currentAccountId
    try {
      for (let budget = 0; budget < 300; budget++) {
        if (signal.aborted || this.store.currentAccountId !== ownerId) return
        const game = this.store.groupGame(id)
        if (!game || game.status !== 'running') return
        const language = game.language ?? 'zh-CN'
        const turn = nextGameTurn(game)
        if (!turn || turn.actorId === 'human') return
        const agent = this.store.agent(turn.actorId)
        if (!agent || agent.ownerId !== ownerId || agent.localAgentId) throw new GameRuleError("The player was removed or no longer supports isolated game sessions.", language)
        this.callbacks.activity(game, agent.id)
        let lastError = ''
        let committed = false
        let invalidOutputs = 0
        for (let attempt = 0; attempt < 3; attempt++) {
          if (signal.aborted) return
          let receivedOutput = false
          try {
            const prompt = [
              'You are a player in a social deduction game, not the judge. Use only your supplied player view. No tools. Never claim other players spoke or voted. Never reveal your secret word directly. Keep speech under 150 characters and use the language supplied in the player view.',
              'Return exactly one JSON object for the current turn. For speak: {"text":"your actual speech"}. For vote or inspect: {"targetId":"one exact ID from turn.targetIds"}. An empty targetId means abstain. A private wolf discussion must stay in its private channel. Public @mentions do not schedule extra turns.',
              lastError ? `Your previous action was invalid: ${lastError}. Correct it.` : '',
              JSON.stringify(gamePlayerView(game, agent.id))
            ].filter(Boolean).join('\n')
            const text = await this.callbacks.reply(agent, prompt, `${id}:${turn.slotId}:${attempt}`, signal)
            if (signal.aborted || this.store.currentAccountId !== ownerId) return
            receivedOutput = true
            const payload = decisionJson(text) as { text?: string; targetId?: string }
            if (!payload || typeof payload !== 'object') throw new GameRuleError("The model did not return a valid game action.", language)
            const next = applyGameAction(game, { slotId: turn.slotId, actorId: agent.id, text: payload.text, targetId: payload.targetId })
            this.store.commitGame(next, game.revision)
            this.callbacks.changed(); committed = true; break
          } catch (error) {
            // Store conflicts and membership changes are never player forfeits.
            if (error instanceof GameRuleError && ['Game state has changed.', 'A player left the group. End this game and select players again.'].includes(error.code)) throw error
            if (receivedOutput) invalidOutputs++
            lastError = error instanceof GameRuleError ? error.message
              : receivedOutput ? gameText(language, 'The model did not return a valid game action.')
              : error instanceof Error && error.name === 'TimeoutError' ? gameText(language, 'Model request timed out.')
              : gameText(language, 'The model service is unavailable or the action has expired. Check player model settings before continuing.')
            if (invalidOutputs >= 2) {
              this.store.commitGame(skipGameTurn(game, turn.slotId), game.revision)
              this.callbacks.changed(); committed = true; break
            }
          }
        }
        if (!committed && !signal.aborted) throw new Error(gameText(language, '{member} cannot complete this action. {detail}', { member: agent.name, detail: lastError }))
        // Let cancellation and human input run between slots.
        await new Promise<void>(resolve => setImmediate(resolve))
      }
      throw new GameRuleError('The activity reached its execution budget. The game is paused.', this.store.groupGame(id)?.language ?? this.callbacks.language?.() ?? 'en')
    } catch (error) {
      if (signal.aborted || this.store.currentAccountId !== ownerId) return
      const game = this.store.groupGame(id)
      if (game && game.status === 'running') this.store.commitGame({ ...game, revision: game.revision + 1, status: 'paused',
        error: error instanceof Error ? error.message : gameText(game.language ?? 'zh-CN', 'The game is paused.') }, game.revision)
    }
  }
}
