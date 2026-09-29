import { useEffect, useRef, useState } from 'react'
import { ChevronRight, X } from 'lucide-react'
import type { ConnectorCommand, ConnectorPlatform, ConnanySession, ConnanyState, ConnectorSelection } from '../../../shared/connany'
import { t } from '../preferences'
import { ConnanyDetails, ConnectorIcon, connectorCatalog } from './ConnanyDetails'
import './ConnanyPanel.css'

const waiting = (s: ConnanySession) => ['pending', 'authorizing', 'processing'].includes(s.status)
function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const messages: Record<string, string> = {
    action_not_found: t("This tool is unavailable. Refresh the connector tool list."),
    unsupported_tool_schema: t("This tool's parameters are not supported yet."),
    provider_unavailable: t("Cannot reach the platform. Try again later."),
    mcp_tool_error: t("Notion could not complete this request. Check the parameters and page access."),
    mcp_protocol_error: t("Notion protocol error. Contact the connector administrator."),
    invalid_mcp_response: t("Notion returned an invalid response. Try again later."),
    reauth_required: t("Authorization expired. Reconnect this account."),
    connection_revoked: t("This account was disconnected."),
    not_found: t("Connection not found for this account."),
    unauthorized: t("The connector service key needs administrator attention."),
    not_configured: t("An administrator needs to configure this connector."),
    provider_not_configured: t("This platform is not configured yet."),
    service_unavailable: t("Cannot reach the connector service. Try again."),
    rate_limited: t("Too many requests. Wait a moment and retry."),
  }
  return Object.entries(messages).find(([key]) => text.includes(key))?.[1] || text
}
export function ConnanyPanel() {
  const [detail, setDetail] = useState<ConnectorPlatform>()
  const [state, setState] = useState<ConnanyState>()
  const [sessions, setSessions] = useState<ConnanySession[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [accountErrors, setAccountErrors] = useState<Record<string, string>>({})
  const dismissedSessions = useRef(new Set<string>())
  const alive = useRef(true)
  const load = async () => {
    const result = await window.douchat.connanyCommand({ op: 'list' }) as ConnanyState
    if (alive.current) { setState(result); if (result.sessions) setSessions(result.sessions.filter(s => !dismissedSessions.current.has(s.id))) }
  }
  useEffect(() => { alive.current = true; void load().catch(e => setError(errorText(e))); return () => { alive.current = false } }, [])
  useEffect(() => {
    if (!sessions.some(waiting)) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const next: ConnanySession[] = []
        for (const session of sessions) {
          if (!waiting(session)) { next.push(session); continue }
          next.push(Date.parse(session.expires_at) <= Date.now() ? { ...session, status: 'expired' } : await window.douchat.connanyCommand({ op: 'session', id: session.id }) as ConnanySession)
        }
        if (cancelled) return
        setSessions(next)
        if (next.some((s, i) => s.status === 'connected' && sessions[i]?.status !== 'connected')) await load()
      } catch (e) { if (!cancelled) { setSessions(s => s.map(x => waiting(x) ? { ...x, status: 'error', error_code: 'poll_failed', error_message: errorText(e) } : x)) } }
    }, 5000)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [sessions])
  async function run(command: ConnectorCommand): Promise<boolean> {
    setBusy(true); setError('')
    const accountId = 'id' in command && command.op !== 'session' ? command.id : undefined
    if (accountId) setAccountErrors(errors => ({ ...errors, [accountId]: '' }))
    try {
      const result = await window.douchat.connanyCommand(command)
      if (!alive.current) return false
      if (command.op === 'connect' || command.op === 'reconnect') {
        const session = result as ConnanySession
        setSessions(s => [...s.filter(x => x.provider !== session.provider), session])
      } else {
        if (command.op === 'disconnect' && (result as { status?: string })?.status === 'revoked') {
          setState(previous => previous && { ...previous, connections: previous.connections.filter(c => c.id !== command.id), selections: previous.selections.map(s => s.connectionId === command.id ? { ...s, connectionId: '' } : s) })
          setSessions(previous => previous.filter(s => s.connection_id !== command.id))
        }
        await load()
      }
      if (command.op === 'disconnect' && (result as { revocation_status?: string })?.revocation_status === 'failed') setError(t('Disconnected locally. Platform revocation failed; remove app access on the platform.'))
      return true
    } catch (e) { if (alive.current) { if (accountId) setAccountErrors(errors => ({ ...errors, [accountId]: errorText(e) })); else setError(errorText(e)) } return false }
    finally { if (alive.current) setBusy(false) }
  }
  async function select(selection: ConnectorSelection) {
    setBusy(true); setError('')
    try { await window.douchat.connanySelect(selection); await load() }
    catch (e) { if (alive.current) setAccountErrors(errors => ({ ...errors, [selection.connectionId]: errorText(e) })) }
    finally { if (alive.current) setBusy(false) }
  }
  return <div className="connany-panel">
    {error && <div role="alert" className="connany-error">{error} <button disabled={busy} onClick={() => void run({ op: 'list' })}>{t('Retry')}</button><button aria-label={t('Dismiss')} onClick={() => setError('')}><X size={14} /></button></div>}
    {detail ? <ConnanyDetails key={detail} provider={detail} state={state} session={sessions.find(s => s.provider === detail)} busy={busy} run={run} select={select} accountErrors={accountErrors} dismissAccountError={id => setAccountErrors(errors => ({ ...errors, [id]: '' }))} dismissSession={() => { const session = sessions.find(s => s.provider === detail); if (session) dismissedSessions.current.add(session.id); setSessions(s => s.filter(x => x.provider !== detail)) }}
      stopWaiting={() => setSessions(s => s.filter(x => x.provider !== detail))} onBack={() => setDetail(undefined)} /> : <>
      <h1>{t('Connectors')}</h1>
      <p className="connany-description">{t('Connect external accounts so your agents can read their data.')}</p>
      {!state && !error && <p role="status">{t('Loading…')}</p>}
      <div className="connany-list">{(['github', 'notion', 'linear'] as ConnectorPlatform[]).map(provider => {
        const catalog = connectorCatalog[provider]
        const session = sessions.find(s => s.provider === provider)
        const connections = state?.connections.filter(c => c.provider === provider) || []
        const connected = connections.some(c => c.status === 'connected')
        const status = session && waiting(session) ? t('Finish connecting in your browser…') : connected ? t('Connected') : connections.some(c => c.status === 'reauth_required') ? t('Reconnect required') : !state?.providers.some(p => p.name === provider && p.enabled) ? t('Not configured') : t('Not connected')
        return <button className="connany-list-item" key={provider} onClick={() => setDetail(provider)} aria-label={catalog.name}>
          <ConnectorIcon provider={provider} /><span className="connany-list-copy"><strong>{catalog.name}</strong><small>{t(catalog.description)}</small></span><span className={`connany-status ${connected ? 'is-connected' : ''}`}>{status}</span><ChevronRight size={17} />
        </button>
      })}</div>
    </>}
  </div>
}
