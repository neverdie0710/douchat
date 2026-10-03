import { useEffect, useRef, useState } from 'react'
import { ChevronRight, X } from 'lucide-react'
import { type ConnectorCommand, type ConnectorName, type ConnanySession, type ConnanyState, type ConnectorSelection } from '../../../shared/connany'
import { t } from '../preferences'
import { ConnanyDetails, ConnectorIcon, connectorDescription } from './ConnanyDetails'
import './ConnanyPanel.css'

const waiting = (s: ConnanySession) => ['pending', 'authorizing', 'processing'].includes(s.status)
export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const messages: Record<string, string> = {
    tool_not_found: t("This tool is unavailable. Refresh the connector tool list."),
    upstream_error: t("Cannot reach the platform. Try again later."),
    mcp_tool_error: t("The platform could not complete this request. Check the parameters and access."),
    reauth_required: t("Authorization expired. Reconnect this account."),
    connection_revoked: t("This account was disconnected."),
    session_unavailable: t("The link expired. Connect again to create a new link."),
    connector_not_configured: t("This platform is not configured yet."),
    connector_not_found: t("This platform is not configured yet."),
    not_found: t("Connection not found for this account."),
    unauthorized: t("The connector service key needs administrator attention."),
    not_configured: t("An administrator needs to configure this connector."),
    service_unavailable: t("Cannot reach the connector service. Try again."),
    rate_limited: t("Too many requests. Wait a moment and retry."),
    invalid_response: t("The connector service returned an unexpected response. Check the backend's CONNANY_BASE_URL."),
  }
  return Object.entries(messages).find(([key]) => text.includes(key))?.[1] || text.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '').replace(/^Connector error: \w+$/, t('Cannot reach the connector service. Try again.'))
}
export function ConnanyPanel() {
  const [detail, setDetail] = useState<ConnectorName>()
  const [filter, setFilter] = useState<'all' | 'connected' | 'disconnected'>('all')
  const [state, setState] = useState<ConnanyState>()
  const [sessions, setSessions] = useState<ConnanySession[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [accountErrors, setAccountErrors] = useState<Record<string, string>>({})
  const [notices, setNotices] = useState<Record<string, string>>({})
  // Connections whose resource-access page is open; polled until access appears.
  const [accessWaiting, setAccessWaiting] = useState<Record<string, number>>({})
  const dismissedSessions = useRef(new Set<string>())
  const alive = useRef(true)
  const load = async () => {
    const result = await window.douchat.connanyCommand({ op: 'list' }) as ConnanyState
    if (alive.current) { setState(result); if (result.sessions) setSessions(result.sessions.filter(s => !dismissedSessions.current.has(s.id))) }
  }
  useEffect(() => {
    alive.current = true
    void load().catch(e => setError(errorText(e)))
    // Connections can change outside Settings: chat authorization, events from Connany.
    const unsubscribe = window.douchat.onConnanyChanged?.(() => void load().catch(() => { /* The next action reports errors. */ }))
    return () => { alive.current = false; unsubscribe?.() }
  }, [])
  useEffect(() => {
    if (!sessions.some(waiting)) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const next: ConnanySession[] = []
        for (const session of sessions) {
          if (!waiting(session)) { next.push(session); continue }
          next.push(Date.parse(session.expires_at) <= Date.now() ? { ...session, status: 'expired' } : await window.douchat.connanyCommand({ op: 'session', connector: session.connector, id: session.id }) as ConnanySession)
        }
        if (cancelled) return
        setSessions(next)
        if (next.some((s, i) => s.status === 'connected' && sessions[i]?.status !== 'connected')) await load()
      } catch (e) { if (!cancelled) { setSessions(s => s.map(x => waiting(x) ? { ...x, status: 'error', error_code: 'poll_failed', error_message: errorText(e) } : x)) } }
    }, 5000)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [sessions])
  useEffect(() => {
    const ids = Object.keys(accessWaiting)
    if (!ids.length) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      const next = { ...accessWaiting }
      let granted = false
      for (const id of ids) {
        try {
          const access = await window.douchat.connanyCommand({ op: 'access', id }) as { total: number }
          if (access.total > 0) { delete next[id]; granted = true }
          else if (Date.now() - next[id] > 10 * 60_000) delete next[id]
        } catch { delete next[id] }
      }
      if (cancelled) return
      setAccessWaiting(next)
      if (granted) await load().catch(() => {})
    }, 5000)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [accessWaiting])
  async function run(command: ConnectorCommand): Promise<boolean> {
    setBusy(true); setError('')
    const accountId = 'id' in command && command.op !== 'session' ? command.id : undefined
    if (accountId) { setAccountErrors(errors => ({ ...errors, [accountId]: '' })); setNotices(n => ({ ...n, [accountId]: '' })) }
    try {
      const result = await window.douchat.connanyCommand(command)
      if (!alive.current) return false
      if (command.op === 'connect' || command.op === 'reconnect') {
        const session = result as ConnanySession
        setSessions(s => [...s.filter(x => x.connector !== session.connector), session])
      } else if (command.op === 'check') {
        setNotices(n => ({ ...n, [command.id]: t('Connection is working.') }))
        await load()
      } else if (command.op === 'openAccess') {
        setAccessWaiting(waiting => ({ ...waiting, [command.id]: Date.now() }))
      } else {
        if (command.op === 'disconnect' && (result as { status?: string })?.status === 'revoked') {
          setState(previous => previous && { ...previous, connections: previous.connections.filter(c => c.id !== command.id), selections: previous.selections.map(s => s.connectionId === command.id ? { ...s, connectionId: '' } : s) })
          setSessions(previous => previous.filter(s => s.connection_id !== command.id))
        }
        await load()
      }
      if (command.op === 'disconnect' && (result as { revocation_status?: string })?.revocation_status === 'failed') setError(t('Disconnected locally. Platform revocation failed; remove app access on the platform.'))
      return true
    } catch (e) {
      if (alive.current) {
        if (accountId) setAccountErrors(errors => ({ ...errors, [accountId]: errorText(e) })); else setError(errorText(e))
        if (command.op === 'check') await load().catch(() => {})
      }
      return false
    }
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
    {detail ? <ConnanyDetails key={detail} connector={detail} state={state} session={sessions.find(s => s.connector === detail)} busy={busy} run={run} select={select} accountErrors={accountErrors} notices={notices} accessWaiting={Object.keys(accessWaiting)} dismissAccountError={id => setAccountErrors(errors => ({ ...errors, [id]: '' }))} dismissSession={() => { const session = sessions.find(s => s.connector === detail); if (session) dismissedSessions.current.add(session.id); setSessions(s => s.filter(x => x.connector !== detail)) }}
      stopWaiting={() => setSessions(s => s.filter(x => x.connector !== detail))} onBack={() => setDetail(undefined)} /> : <>
      {(() => {
        // A connector counts as connected once it has any account, including one awaiting reconnection.
        const hasAccount = (name: string) => Boolean(state?.connections.some(c => c.connector === name))
        const all = state?.connectors || []
        const counts = { all: all.length, connected: all.filter(c => hasAccount(c.name)).length, disconnected: all.filter(c => !hasAccount(c.name)).length }
        const shown = all.filter(c => filter === 'all' || (filter === 'connected') === hasAccount(c.name))
        const labels = { all: t('All'), connected: t('Connected'), disconnected: t('Not connected') }
        return <>
          <div className="connany-heading">
            <h1>{t('Connectors')}</h1>
            {all.length > 0 && <select className="connany-filter" aria-label={t('Filter connectors')} value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
              {(['all', 'connected', 'disconnected'] as const).map(key => <option key={key} value={key}>{labels[key]} ({counts[key]})</option>)}
            </select>}
          </div>
          <p className="connany-description">{t('Connect external accounts so your agents can use their data.')}</p>
          {!state && !error && <p role="status">{t('Loading…')}</p>}
          {state && !all.length && <p className="connany-description">{t('No connectors are available yet.')}</p>}
          {state && all.length > 0 && !shown.length && <p className="connany-empty">{t(filter === 'connected' ? 'No connected accounts yet.' : 'Every connector has an account.')}</p>}
          <div className="connany-list">{shown.map(item => {
            const connector = item.name
            const session = sessions.find(s => s.connector === connector)
            const connections = state?.connections.filter(c => c.connector === connector) || []
            const connected = connections.some(c => c.status === 'connected')
            const status = session && waiting(session) ? t('Finish connecting in your browser…') : connected ? t('Connected') : connections.some(c => c.status === 'reauth_required') ? t('Reconnect required') : t('Not connected')
            const description = connectorDescription(item)
            return <button className="connany-list-item" key={connector} onClick={() => setDetail(connector)} aria-label={item.title}>
              <ConnectorIcon connector={item} /><span className="connany-list-copy"><strong>{item.title}</strong><small title={description}>{description}</small></span><span className={`connany-status ${connected ? 'is-connected' : ''}`}>{status}</span><ChevronRight size={17} />
            </button>
          })}</div>
        </>
      })()}
    </>}
  </div>
}
