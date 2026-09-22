import { useState, type ReactElement } from 'react'
import { agentPermissions, permissionLabels, sensitiveCapabilities, type AgentPermissions, type PermissionDecision, type PermissionRequest } from '../../../shared/agentPermissions'
import type { AgentConfig } from '../../../shared/types'
import { t } from '../preferences'

export function AgentPermissionsDialog({ agent, onClose, onSave }: {
  agent: AgentConfig; onClose: () => void; onSave: (permissions: AgentPermissions) => Promise<void>
}): ReactElement {
  const [value, setValue] = useState(() => agentPermissions(agent.permissions))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const labels = { ...permissionLabels, groupHumans: 'Requests from other people', groupAgents: 'Requests from other agents', localExecution: 'Run on my computer' }
  const descriptions: Partial<Record<keyof typeof permissionLabels, string>> = {
    groupHumans: 'Let other people in the group ask this agent questions or give it tasks.',
    groupAgents: 'Let other agents in the group send tasks to this agent.',
    localExecution: 'After accepting someone else’s request, ask me before starting the local agent — even just to chat.'
  }
  const row = (key: keyof typeof permissionLabels, decision: PermissionDecision, change: (v: PermissionDecision) => void) => (
    <div className="agent-permission-row" key={key}>
      <span className="permission-row-label">{t(labels[key])}{descriptions[key] && <small>{t(descriptions[key]!)}</small>}</span>
      <select aria-label={t(labels[key])} value={decision} disabled={saving} onChange={(e) => change(e.target.value as PermissionDecision)}>
        <option value="allow">{t(key === 'localExecution' ? 'No confirmation' : 'Allow')}</option><option value="ask">{t('Ask me each time')}</option><option value="deny">{t(key === 'localExecution' ? 'Do not run' : 'Deny')}</option>
      </select>
    </div>
  )
  return <div className="modal-backdrop" onClick={() => !saving && onClose()}>
    <form className="agent-modal agent-permissions-modal" role="dialog" aria-modal="true" aria-label={t('Agent permissions')}
      onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape' && !saving) { e.stopPropagation(); onClose() } }}
      onSubmit={async (e) => { e.preventDefault(); setSaving(true); setError(''); try { await onSave(value); onClose() } catch { setError(t('Could not save changes')); setSaving(false) } }}>
      <header className="edit-contact-heading"><h2>{t('Agent permissions')}</h2></header><div className="permission-body"><p className="permission-agent-name">{agent.name}</p>
      <h3>{t('Who can send it requests?')}</h3>
      {row('groupHumans', value.groupHumans, (v) => setValue({ ...value, groupHumans: v }))}
      {row('groupAgents', value.groupAgents, (v) => setValue({ ...value, groupAgents: v }))}
      <h3>{t(agent.localAgentId ? 'When should it ask me?' : 'What can it do for others?')}</h3>
      <p className="muted">{t('These settings only apply when someone else asks your agent to do something. Your own requests are unchanged.')}</p>
      {agent.localAgentId ? <>
        <p className="permission-notice">{t('Allowing a run may let the agent read files, execute commands and access the internet on your computer. Approval covers the whole run; individual actions cannot currently be approved separately.')}</p>
        {row('localExecution', value.sensitive.localExecution, (v) => setValue({ ...value, sensitive: { ...value.sensitive, localExecution: v } }))}
      </> : sensitiveCapabilities.filter((key) => key !== 'localExecution').map((key) => row(key, value.sensitive[key], (v) => setValue({ ...value, sensitive: { ...value.sensitive, [key]: v } })))}
      {error && <p role="alert">{error}</p>}
      </div><footer className="edit-contact-footer"><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>{t('Cancel')}</button><button type="submit" className="primary-button" disabled={saving}>{t('Done')}</button></footer>
    </form>
  </div>
}

export function AgentPermissionPrompt({ request, onResolve }: { request: PermissionRequest; onResolve: (allow: boolean) => Promise<void> }): ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const resolve = async (allow: boolean) => { setBusy(true); try { await onResolve(allow) } catch { setError(t('Could not save changes')); setBusy(false) } }
  return <div className="modal-backdrop permission-approval-backdrop">
    <section className="agent-modal agent-permissions-modal" role="dialog" aria-modal="true" aria-label={t('Permission required')} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); if (!busy) void resolve(false) } }}>
      <header className="edit-contact-heading"><h2>{t('Permission required')}</h2></header><div className="permission-body">
      <p><strong>{request.agentName}</strong> · {t(permissionLabels[request.capability])}</p>
      <p className="muted">{t('Requested by')}: {request.requester} · {request.roomName}</p>
      {request.requesterId && <p className="muted permission-requester-id">{t(request.requesterKind === 'agent' ? 'Agent' : 'Human member')} · {request.requesterId}</p>}
      <p>{request.operation}</p><pre className="permission-details">{request.details}</pre>
      {request.capability === 'localExecution' && <p className="permission-notice">{t('Allowing a run may let the agent read files, execute commands and access the internet on your computer. Approval covers the whole run; individual actions cannot currently be approved separately.')}</p>}
      <p className="muted">{t('Results may be visible to everyone in this group.')}</p>
      <p className="muted">{t('This approval is for this operation only. No response within 10 minutes means deny.')}</p>
      {error && <p role="alert">{error}</p>}
      </div><footer className="edit-contact-footer"><button autoFocus className="secondary-button" disabled={busy} onClick={() => void resolve(false)}>{t('Deny')}</button><button className="primary-button" disabled={busy} onClick={() => void resolve(true)}>{t('Allow once')}</button></footer>
    </section>
  </div>
}
