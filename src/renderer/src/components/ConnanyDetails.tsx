import { ArrowLeft, Check, ChevronDown, LoaderCircle, Pencil, X } from 'lucide-react'
import { useState } from 'react'
import githubLogo from '../assets/connectors/github.svg'
import notionLogo from '../assets/connectors/notion.svg'
import linearLogo from '../assets/connectors/linear.svg'
import type { ConnanyConnection, ConnanySession, ConnanyState, ConnectorCommand, ConnectorPlatform, ConnectorSelection } from '../../../shared/connany'
import { t } from '../preferences'

export const connectorCatalog = {
  github: { name: 'GitHub', description: 'Read your GitHub installations and repositories.' },
  notion: { name: 'Notion', description: 'Search shared pages and read page content in Notion.' },
  linear: { name: 'Linear', description: 'Read teams and issues in your Linear workspace.' }
} as const
export function ConnectorIcon({ provider }: { provider: ConnectorPlatform }) {
  const logos = { github: githubLogo, notion: notionLogo, linear: linearLogo }
  return <span className={`connany-icon connany-icon-${provider}`} aria-hidden="true"><img src={logos[provider]} alt="" /></span>
}
export function connectionStatus(connection?: ConnanyConnection): string {
  return !connection ? t('Not connected') : connection.status === 'connected' ? t('Connected') : connection.status === 'revoked' ? t('Disconnected') : t('Reconnect required')
}
export function ConnanyDetails({ provider, state, session, busy, run, select, stopWaiting, onBack, accountErrors = {}, dismissAccountError, dismissSession }: {
  accountErrors?: Record<string, string>
  dismissAccountError?: (id: string) => void
  dismissSession?: () => void
  provider: ConnectorPlatform
  state?: ConnanyState
  session?: ConnanySession
  busy: boolean
  run: (command: ConnectorCommand) => Promise<boolean>
  select: (selection: ConnectorSelection) => Promise<void>
  stopWaiting: () => void
  onBack: () => void
}) {
  const catalog = connectorCatalog[provider]
  const [expandedId, setExpandedId] = useState('')
  const [editingId, setEditingId] = useState('')
  const [draftName, setDraftName] = useState('')
  const connections = state?.connections.filter(c => c.provider === provider && c.status !== 'revoked') || []
  const selection = state?.selections.find(s => s.provider === provider)
  const usable = connections.find(c => c.id === selection?.connectionId && c.status === 'connected')
  const enabled = state?.providers.some(p => p.name === provider && p.enabled)
  const pending = session && ['pending', 'authorizing', 'processing'].includes(session.status)
  const sessionError = session && ['error', 'expired'].includes(session.status) ? <div className="connany-inline-error" role="alert">
    <span>{session.error_message || (session.status === 'expired' ? t('The link expired. Connect again to create a new link.') : session.error_code === 'access_denied' ? t('Authorization cancelled. You can connect again.') : t('Authorization failed. Try connecting again.'))}</span>
    <button aria-label={t('Dismiss')} onClick={dismissSession}><X size={14} /></button>
  </div> : null
  return <div className="connany-details">
    <button className="connany-back" onClick={onBack}><ArrowLeft size={16} />{t('Back to connectors')}</button>
    <header className="connany-detail-header">
      <ConnectorIcon provider={provider} /><h1>{catalog.name}</h1>
    </header>
    <p className="connany-description">{t(catalog.description)}</p>
    {pending && <div className="connany-notice" role="status"><LoaderCircle size={16} className="connany-spinner" />{t('Finish connecting in your browser…')}<button disabled={busy} onClick={stopWaiting}>{t('Stop waiting')}</button></div>}
    {!session?.target_connection_id && sessionError}
    <section className="connany-section" aria-label={t('Accounts')}>
      <div className="connany-section-heading"><h2>{t('Accounts')}</h2><button disabled={busy || !!pending || !enabled} onClick={() => void run({ op: 'connect', provider })}>{t('Add account')}</button></div>
      <div className="connany-accounts">
        {connections.length ? connections.map(c => {
          const original = c.identity.workspace_name || c.identity.account_name || catalog.name
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
            {accountErrors[c.id] && <div className="connany-inline-error" role="alert"><span>{accountErrors[c.id]}</span><button aria-label={t('Dismiss')} onClick={() => dismissAccountError?.(c.id)}><X size={14} /></button></div>}
            {expandedId === c.id && <div id={`connany-account-panel-${c.id}`} className="connany-account-panel" role="region" aria-label={name}>
              <div className="connany-actions">
                {c.status === 'connected' && usable?.id !== c.id && <button disabled={busy} onClick={() => void select({ provider, connectionId: c.id })}>{t('Set as default')}</button>}
                {provider === 'github' && c.status === 'connected' && <button disabled={busy || !enabled} onClick={() => void run({ op: 'installGithub' })}>{t('Manage repository access')}</button>}
                <button disabled={busy || !!pending || !enabled} onClick={() => void run({ op: 'reconnect', id: c.id })}>{t('Reconnect')}</button>
                <button className="connany-danger" disabled={busy} onClick={() => { if (window.confirm(`${t('Disconnect this account? All contacts will lose access.')}\n\n${name}`)) void run({ op: 'disconnect', id: c.id }) }}>{t('Disconnect')}</button>
              </div>
            </div>}
          </div>
        }) : <div className="connany-account-row"><div className="connany-account-header"><span className="connany-status">{enabled ? t('No accounts connected') : t('Not configured')}</span></div></div>}
      </div>
      <p className="connany-section-note">{usable ? t('Uses the default account unless you name another connected account in chat.') : connections.some(c => c.status === 'connected') ? t('Set a default account, or name a connected account in chat.') : t('Once connected, this account is available to all contacts that support connector tools.')}</p>
    </section>
  </div>
}
