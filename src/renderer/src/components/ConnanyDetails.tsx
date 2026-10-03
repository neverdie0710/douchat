import { ArrowLeft, Check, ChevronDown, LoaderCircle, Pencil, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ConnanyAccess, ConnanyConnection, ConnanyConnector, ConnanySession, ConnanyState, ConnectorCommand, ConnectorName, ConnectorSelection } from '../../../shared/connany'
import { t } from '../preferences'

// Name, description and icon all come from GET /v1/connectors.
export function connectorDescription(connector: ConnanyConnector): string {
  return connector.description || t('Let your agents use data from {name}.').replace('{name}', connector.title)
}
export function ConnectorIcon({ connector }: { connector: ConnanyConnector }) {
  const [failed, setFailed] = useState(false)
  return <span className={`connany-icon connany-icon-${connector.name}`} aria-hidden="true">
    {connector.avatar_url && !failed ? <img src={connector.avatar_url} alt="" onError={() => setFailed(true)} /> : <span className="connany-icon-letter">{connector.title.slice(0, 1)}</span>}
  </span>
}
/** Resources a connection may use (e.g. GitHub App installations). Connectors
 * without a resource step return nothing, so the section stays hidden. */
function AccountAccess({ id, busy, run, refreshKey }: { id: string; busy: boolean; run: (command: ConnectorCommand) => Promise<boolean>; refreshKey: unknown }) {
  const [access, setAccess] = useState<ConnanyAccess>()
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    const load = () => void window.douchat.connanyCommand({ op: 'access', id }).then(result => { if (active) { setAccess(result as ConnanyAccess); setError(false) } }).catch(() => { if (active) setError(true) })
    load()
    // Access is granted on the platform's site; refresh when the user comes back.
    window.addEventListener('focus', load)
    return () => { active = false; window.removeEventListener('focus', load) }
  }, [id, refreshKey])
  if (error) return <p className="connany-access-empty">{t('Could not load resource access. Try again later.')}</p>
  if (!access) return <p className="connany-access-empty">{t('Loading…')}</p>
  if (!Array.isArray(access.data) || (!access.add_url && !access.data.length)) return null
  return <div className="connany-access">
    <div className="connany-access-heading"><span>{t('Resource access')}</span>{access.add_url && <button disabled={busy} onClick={() => void run({ op: 'openAccess', id })}>{t('Add organization or repositories')}</button>}</div>
    {access.data.length ? <ul>{access.data.map(grant => <li key={grant.id}>
      <span className="connany-access-name">{grant.name}</span>
      <span className="connany-access-meta">{t(grant.type === 'organization' ? 'Organization' : 'Personal account')} · {t(grant.selection === 'all' ? 'All repositories' : 'Selected repositories')}{grant.suspended ? ` · ${t('Suspended')}` : ''}</span>
      {grant.manage_url && <button disabled={busy} onClick={() => void run({ op: 'openAccess', id, url: grant.manage_url! })}>{t('Manage')}</button>}
    </li>)}</ul> : <p className="connany-access-empty">{t('No resources are shared yet.')}</p>}
  </div>
}
export function connectionStatus(connection?: ConnanyConnection): string {
  return !connection ? t('Not connected') : connection.status === 'connected' ? t('Connected') : connection.status === 'revoked' ? t('Disconnected') : t('Reconnect required')
}
export function ConnanyDetails({ connector: connectorName, state, session, busy, run, select, stopWaiting, onBack, accountErrors = {}, notices = {}, accessWaiting, dismissAccountError, dismissSession }: {
  accessWaiting?: string[]
  accountErrors?: Record<string, string>
  notices?: Record<string, string>
  dismissAccountError?: (id: string) => void
  dismissSession?: () => void
  connector: ConnectorName
  state?: ConnanyState
  session?: ConnanySession
  busy: boolean
  run: (command: ConnectorCommand) => Promise<boolean>
  select: (selection: ConnectorSelection) => Promise<void>
  stopWaiting: () => void
  onBack: () => void
}) {
  const connector: ConnanyConnector = state?.connectors.find(c => c.name === connectorName) ?? { name: connectorName, title: connectorName, avatar_url: '' }
  const [expandedId, setExpandedId] = useState('')
  const [editingId, setEditingId] = useState('')
  const [draftName, setDraftName] = useState('')
  const connections = state?.connections.filter(c => c.connector === connectorName && c.status !== 'revoked') || []
  const selection = state?.selections.find(s => s.provider === connectorName)
  const usable = connections.find(c => c.id === selection?.connectionId && c.status === 'connected')
  const enabled = state?.connectors.some(c => c.name === connectorName)
  const pending = session && ['pending', 'authorizing', 'processing'].includes(session.status)
  const sessionError = session && ['error', 'expired'].includes(session.status) ? <div className="connany-inline-error" role="alert">
    <span>{session.error_message || (session.status === 'expired' ? t('The link expired. Connect again to create a new link.') : session.error_code === 'access_denied' ? t('Authorization cancelled. You can connect again.') : t('Authorization failed. Try connecting again.'))}</span>
    <button aria-label={t('Dismiss')} onClick={dismissSession}><X size={14} /></button>
  </div> : null
  return <div className="connany-details">
    <button className="connany-back" onClick={onBack}><ArrowLeft size={16} />{t('Back to connectors')}</button>
    <header className="connany-detail-header">
      <ConnectorIcon connector={connector} /><h1>{connector.title}</h1>
    </header>
    <p className="connany-description">{connectorDescription(connector)}</p>
    {pending && <div className="connany-notice" role="status"><LoaderCircle size={16} className="connany-spinner" />{t('Finish connecting in your browser…')}<button disabled={busy} onClick={stopWaiting}>{t('Stop waiting')}</button></div>}
    {!session?.target_connection_id && sessionError}
    <section className="connany-section" aria-label={t('Accounts')}>
      <div className="connany-section-heading"><h2>{t('Accounts')}</h2><button disabled={busy || !!pending || !enabled} onClick={() => void run({ op: 'connect', connector: connectorName })}>{t('Add account')}</button></div>
      <div className="connany-accounts">
        {connections.length ? connections.map(c => {
          const original = c.identity.workspace_name || c.identity.account_name || connector.title
          const name = c.display_name || original
          return <div key={c.id} className="connany-account-row">
            <div className="connany-account-header">
              <div className="connany-account-name">
                {editingId === c.id ? <form className="connany-rename-form" onSubmit={async e => {
                  e.preventDefault()
                  if (await run({ op: 'rename', id: c.id, name: draftName })) setEditingId('')
                }}>
                  <input autoFocus aria-label={t('Account name')} value={draftName} maxLength={80} disabled={busy} onChange={e => setDraftName(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditingId('') } }} />
                  <button type="submit" disabled={busy || !draftName.trim()}>{t('Save')}</button><button type="button" disabled={busy} onClick={() => setEditingId('')}>{t('Cancel')}</button>
                </form> : <span className="connany-account-title">
                  <span>{name}</span>
                  <button className="connany-rename" disabled={busy} title={t('Rename account')} aria-label={`${t('Rename account')}: ${name}`} onClick={() => { setDraftName(name); setEditingId(c.id) }}><Pencil size={14} /></button>
                  {usable?.id === c.id && <span className="connany-default"><Check size={12} />{t('Default account')}</span>}
                </span>}
              </div>
              <button className="connany-account-option" disabled={busy} aria-label={`${name}: ${connectionStatus(c)}`} aria-expanded={expandedId === c.id} aria-controls={`connany-account-panel-${c.id}`} onClick={() => setExpandedId(previous => previous === c.id ? '' : c.id)}>
                <span className={`connany-status ${c.status === 'connected' ? 'is-connected' : ''}`}>{connectionStatus(c)}</span>
                <ChevronDown size={16} className="connany-account-chevron" />
              </button>
            </div>
            {session?.target_connection_id === c.id && sessionError}
            {c.status === 'connected' && c.needs_access && <div className="connany-account-notice" role="status">
              <span>{accessWaiting?.includes(c.id) ? t('Finish granting access in your browser. This page refreshes when it is done.') : t('Connected, but no resources are shared yet. Grant access to choose what agents can read.')}</span>
              {accessWaiting?.includes(c.id) ? <LoaderCircle size={16} className="connany-spinner" /> : <button disabled={busy} onClick={() => void run({ op: 'openAccess', id: c.id })}>{t('Grant access')}</button>}
            </div>}
            {notices[c.id] && <div className="connany-account-notice" role="status"><span>{notices[c.id]}</span></div>}
            {accountErrors[c.id] && <div className="connany-inline-error" role="alert"><span>{accountErrors[c.id]}</span><button aria-label={t('Dismiss')} onClick={() => dismissAccountError?.(c.id)}><X size={14} /></button></div>}
            {expandedId === c.id && <div id={`connany-account-panel-${c.id}`} className="connany-account-panel" role="region" aria-label={name}>
              <div className="connany-actions">
                {c.status === 'connected' && usable?.id !== c.id && <button disabled={busy} onClick={() => void select({ provider: connectorName, connectionId: c.id })}>{t('Set as default')}</button>}
                {c.status === 'connected' && <button disabled={busy} onClick={() => void run({ op: 'check', id: c.id })}>{t('Check connection')}</button>}
                <button disabled={busy || !!pending || !enabled} onClick={() => void run({ op: 'reconnect', id: c.id })}>{t('Reconnect')}</button>
                <button className="connany-danger" disabled={busy} onClick={() => { if (window.confirm(`${t('Disconnect this account? All contacts will lose access.')}\n\n${name}`)) void run({ op: 'disconnect', id: c.id }) }}>{t('Disconnect')}</button>
              </div>
              {c.status === 'connected' && <AccountAccess id={c.id} busy={busy} run={run} refreshKey={state} />}
            </div>}
          </div>
        }) : <div className="connany-account-row"><div className="connany-account-header"><span className="connany-status">{enabled ? t('No accounts connected') : t('Not configured')}</span></div></div>}
      </div>
      <p className="connany-section-note">{usable ? t('Uses the default account unless you name another connected account in chat.') : connections.some(c => c.status === 'connected') ? t('Set a default account, or name a connected account in chat.') : t('Once connected, this account is available to all contacts that support connector tools.')}</p>
    </section>
  </div>
}
