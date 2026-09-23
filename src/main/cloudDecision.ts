import { CLOUD_DECISION_PROVIDER_ID, type CloudDecisionModel } from '../shared/groupDecision'
import type { DecisionProvider } from './groupDecision'

export interface CloudDecisionGateway {
  baseUrl: string
  resolveAccessToken: () => string | undefined
  onUnauthorized?: () => void | Promise<void>
}

export class CloudDecisionClient {
  constructor(private readonly gateway?: CloudDecisionGateway, private readonly request: typeof fetch = fetch) {}

  async models(signal?: AbortSignal): Promise<CloudDecisionModel[]> {
    const token = this.gateway?.resolveAccessToken()
    if (!this.gateway || !token) throw new Error("Sign in to Douchat first.")
    const response = await this.request(`${this.gateway.baseUrl.replace(/\/+$/, '')}/decisions/models`, {
      headers: { Authorization: `Bearer ${token}` }, redirect: 'error',
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10_000)])
    })
    if (response.status === 401) await this.gateway.onUnauthorized?.()
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
        protocol: 'jev', onUnauthorized: this.gateway?.onUnauthorized } }
  }
}
