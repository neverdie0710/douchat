import { cancellableGroupPlan } from './groupPlanning'
import { CLOUD_DECISION_PROVIDER_ID, type CloudDecisionModel } from '../shared/groupDecision'
import type { DecisionProvider } from './groupDecision'

export interface CloudDecisionGateway {
  baseUrl: string
  resolveAccessToken: () => string | undefined
  onUnauthorized?: () => void | Promise<void>
}

export class CloudDecisionClient {
  private cache?: { token: string; expires: number; models: CloudDecisionModel[] }
  private pending?: { token: string; promise: Promise<CloudDecisionModel[]> }
  invalidate(): void { this.cache = undefined; this.pending = undefined }
  constructor(private readonly gateway?: CloudDecisionGateway, private readonly request: typeof fetch = fetch) {}

  async models(signal?: AbortSignal, refresh = false): Promise<CloudDecisionModel[]> {
    signal?.throwIfAborted()
    const token = this.gateway?.resolveAccessToken()
    if (!this.gateway || !token) { this.invalidate(); throw new Error("Sign in to Douchat first.") }
    if (this.cache?.token !== token) this.cache = undefined
    if (!refresh && this.cache && this.cache.expires > Date.now()) return structuredClone(this.cache.models)
    if (this.pending?.token !== token) {
      const pending = { token, promise: Promise.resolve([] as CloudDecisionModel[]) }
      this.pending = pending
      pending.promise = this.loadModels(token).then(models => {
        if (this.gateway?.resolveAccessToken() !== token) throw new Error("The sign-in session changed. Try again.")
        if (this.pending === pending && models.length) this.cache = { token, expires: Date.now() + 300_000, models }
        return models
      }).finally(() => { if (this.pending === pending) this.pending = undefined })
    }
    // A cancelled caller cannot cancel another task's shared catalog request.
    const promise = this.pending.promise
    const models = signal ? await cancellableGroupPlan(() => promise, signal) : await promise
    if (this.gateway.resolveAccessToken() !== token) throw new Error("The sign-in session changed. Try again.")
    return structuredClone(models)
  }

  private async loadModels(token: string): Promise<CloudDecisionModel[]> {
    const response = await this.request(`${this.gateway!.baseUrl.replace(/\/+$/, '')}/decisions/models`, {
      headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(10_000)
    })
    if (response.status === 401 && this.gateway?.resolveAccessToken() === token) {
      this.invalidate()
      await this.gateway.onUnauthorized?.()
    }
    const payload = await response.json().catch(() => null) as { code?: number; message?: string; data?: unknown } | null
    if (!response.ok || payload?.code !== 0 || !Array.isArray(payload.data)) throw new Error(payload?.message || "Cloud decision models could not be loaded. Try again later.")
    return payload.data.filter((model): model is CloudDecisionModel => !!model && typeof model.id === 'string'
      && typeof model.name === 'string' && model.protocol === 'jev'
      && Number.isSafeInteger(model.creditsPerRequest) && model.creditsPerRequest > 0)
      .map(({ id, name, protocol, creditsPerRequest }) => ({ id, name, protocol, creditsPerRequest }))
  }

  async provider(signal?: AbortSignal): Promise<DecisionProvider> {
    const token = this.gateway?.resolveAccessToken()
    const model = (await this.models(signal))[0]
    if (!model) throw new Error("The cloud decision model is unavailable. Using the default decision mode.")
    if (!token || token !== this.gateway?.resolveAccessToken()) throw new Error("The sign-in session changed. Try again.")
    const baseUrl = this.gateway!.baseUrl.replace(/\/+$/, '')
    return { id: CLOUD_DECISION_PROVIDER_ID, name: 'Douchat Cloud', kind: 'openai', apiBase: baseUrl,
      apiKey: token, models: [model.id], cloud: { endpoint: `${baseUrl}/decisions/completions`,
        protocol: 'jev', onUnauthorized: async () => { if (this.gateway?.resolveAccessToken() === token) { this.invalidate(); await this.gateway.onUnauthorized?.() } } } }
  }
}
