import { EmbeddedAgentSettings, AgentDialogSurface as NativeDialog } from './AgentDialogSurface'
import { useContext, useState, type ReactElement } from 'react'
import { agentPermissions, permissionLabels, sensitiveCapabilities, type AgentPermissions, type PermissionApproval, type PermissionDecision, type PermissionRequest } from '../../../shared/agentPermissions'
import type { AgentConfig } from '../../../shared/types'
import { t, tr } from '../preferences'
import type { SocialSnapshot } from '../../../shared/social'
import { AgentAvatar, agentDisplayName, UserAvatar } from './common'

export function AgentPermissionsDialog({ agent, onClose, onSave }: {
  agent: AgentConfig; onClose: () => void; onSave: (permissions: AgentPermissions) => Promise<void>
}): ReactElement {
  const embedded = useContext(EmbeddedAgentSettings)
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
  return <NativeDialog className="modal-backdrop" onClick={() => !saving && onClose()} onClose={onClose}>
    <form className="agent-modal agent-permissions-modal" role="dialog" aria-modal="true" aria-label={t('Agent permissions')}
      onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape' && !saving) { e.stopPropagation(); onClose() } }}
      onSubmit={async (e) => { e.preventDefault(); setSaving(true); setError(''); try { await onSave(value); onClose() } catch { setError(t('Could not save changes')) } finally { setSaving(false) } }}>
      <header className="edit-contact-heading"><h2>{t('Agent permissions')}</h2></header><div className="permission-body"><p className="permission-agent-name">{agent.name}</p>
      <h3>{t('Who can send it requests?')}</h3>
      {row('groupHumans', value.groupHumans, (v) => setValue({ ...value, groupHumans: v }))}
      {row('groupAgents', value.groupAgents, (v) => setValue({ ...value, groupAgents: v }))}
      <h3>{t(agent.localAgentId ? 'When should it ask me?' : 'What can it do for others?')}</h3>
      <p className="muted">{t('These settings only apply when someone else asks your agent to do something. Your own requests are unchanged.')}</p>
      {agent.localAgentId ? <>
        <p className="permission-notice">{t('Allowing a run may let the agent read files, execute commands and access the internet on your computer. Codex Computer Use requests separate approval; other internal actions are controlled by the local agent.')}</p>
        {row('localExecution', value.sensitive.localExecution, (v) => setValue({ ...value, sensitive: { ...value.sensitive, localExecution: v } }))}
      </> : sensitiveCapabilities.filter((key) => key !== 'localExecution').map((key) => row(key, value.sensitive[key], (v) => setValue({ ...value, sensitive: { ...value.sensitive, [key]: v } })))}
      {error && <p role="alert">{t(error)}</p>}
      </div><footer className="edit-contact-footer"><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>{t('Cancel')}</button><button type="submit" className="primary-button" disabled={saving}>{t(embedded ? 'Save' : 'Done')}</button></footer>
    </form>
  </NativeDialog>
}

export function AgentPermissionPrompt({ request, agent, social, onResolve }: { request: PermissionRequest; agent?: AgentConfig; social?: SocialSnapshot; onResolve: (allow: PermissionApproval) => Promise<void> }): ReactElement {
  const contact = agent?.id === request.agentId && agent.ownerId === request.ownerId ? agent : undefined
  let native: { tool?: string; input?: { command?: string }; arguments?: { command?: string; app?: string } } | undefined
  try { native = JSON.parse(request.details) } catch { /* Plain-text requests remain visible. */ }
  const nativeLabels: Record<string, string> = {
    Bash: 'Run a terminal command', Read: 'Read a file', Write: 'Write a file', Edit: 'Edit a file',
    Glob: 'Find files', Grep: 'Search file contents', WebFetch: 'Read a web page', WebSearch: 'Search the web',
    get_app_state: 'Access a desktop app', launch_app: 'Access a desktop app'
  }
  const nativeTool = typeof native?.tool === 'string' ? native.tool : request.operation === 'Claude: Bash' ? 'Bash' : undefined
  const actionLabel = request.nativeApp ? 'Access a desktop app' : nativeTool && Object.hasOwn(nativeLabels, nativeTool) ? nativeLabels[nativeTool] : undefined
  const command = nativeTool === 'Bash' ? native?.input?.command ?? native?.arguments?.command : undefined
  const desktopApp = request.nativeApp?.name || (['get_app_state', 'launch_app'].includes(nativeTool ?? '') && typeof native?.arguments?.app === 'string'
    ? native.arguments.app : undefined)
  const people = social?.userId === request.ownerId && request.requesterKind !== 'agent' ? social : undefined
  const person = people?.rooms.flatMap(room => room.members).find(member => member.id === request.requesterId)
    ?? people?.friendships.find(friend => friend.person.id === request.requesterId)?.person
  const requesterName = person?.name || request.requester
  const selfRequest = request.requesterKind === 'agent' && request.requesterId === request.agentId
  const room = request.context === 'group' || request.context !== 'direct' && request.roomName !== request.agentName && request.roomName !== requesterName ? request.roomName : undefined
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const resolve = async (allow: PermissionApproval) => { setBusy(true); try { await onResolve(allow) } catch { setError(t('Could not save changes')); setBusy(false) } }
  if (request.connect) {
    const label = request.connect.access ? t('Grant {name} access').replace('{name}', request.connect.title) : `${request.connect.reconnect ? t('Reconnect') : t('Connect')} ${request.connect.title}`
    return <NativeDialog className="modal-backdrop permission-approval-backdrop" onClose={() => { if (!busy) void resolve(false) }}>
      <section className="agent-modal agent-permissions-modal" role="dialog" aria-modal="true" aria-label={label} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); if (!busy) void resolve(false) } }}>
        <header className="edit-contact-heading"><h2>{label}</h2></header><div className="permission-body">
        <div className="permission-actor">
          {contact ? <AgentAvatar agent={contact} size={40} /> : <UserAvatar src="" name={request.agentName} size={40} />}
          <span className="permission-requester-copy"><strong>{contact ? agentDisplayName(contact) : request.agentName}</strong>
            <span>{t(request.connect.access ? 'Needs access to more resources in your account to continue' : request.connect.reconnect ? 'Needs your account to be reconnected to continue' : 'Needs access to your account to continue')}</span></span>
        </div>
        {room && <p className="muted">{t('Group')}: {room}</p>}
        <p>{request.details}</p>
        <p className="muted">{t('Authorization happens on the platform’s own page. Douchat never sees your password.')}</p>
        {error && <p role="alert">{t(error)}</p>}
        </div><footer className="edit-contact-footer"><button className="secondary-button" disabled={busy} onClick={() => void resolve(false)}>{t('Not now')}</button><button autoFocus className="primary-button" disabled={busy} onClick={() => void resolve(true)}>{label}</button></footer>
      </section>
    </NativeDialog>
  }
  return <NativeDialog className="modal-backdrop permission-approval-backdrop" onClose={() => { if (!busy) void resolve(false) }}>
    <section className="agent-modal agent-permissions-modal" role="dialog" aria-modal="true" aria-label={t('Permission required')} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); if (!busy) void resolve(false) } }}>
      <header className="edit-contact-heading"><h2>{t('Permission required')}</h2></header><div className="permission-body">
      <div className="permission-actor">
        {contact ? <AgentAvatar agent={contact} size={40} /> : <UserAvatar src="" name={request.agentName} size={40} />}
        <span className="permission-requester-copy"><strong>{contact ? agentDisplayName(contact) : request.agentName}</strong>
          <span>{t(actionLabel ?? (request.capability === 'otherTools' ? 'Run requested operation' : permissionLabels[request.capability]))}</span></span>
      </div>
      {!selfRequest && (request.requesterKind !== 'agent' ? <div className="permission-requester">
        <UserAvatar src={person?.image || ''} name={requesterName} size={32} />
        <span className="permission-requester-copy"><small className="muted">{t('Requested by')}</small><strong>{requesterName}</strong></span>
      </div> : <p className="muted" title={request.requesterId}>{t('Requested by')}: {requesterName} · {t('Agent')}</p>)}
      {room && <p className="muted">{t('Group')}: {room}</p>}
      {request.executorLabel && <p className="permission-notice">{tr('Request from douchat-host on {server}. Allowing it runs there, not on this computer.', { server: request.executorLabel })}</p>}
      {!actionLabel && <p>{request.operation}</p>}
      {nativeTool === 'Bash' && <p>{request.executorLabel ? tr('This runs the command below on {server}.', { server: request.executorLabel }) : t('This runs the command below on your computer.')}</p>}
      {desktopApp ? <>
        <p>{t('Application')}: <strong>{desktopApp}</strong></p>
        <p>{t('Allow this agent to view and interact with this app through Computer Use.')}</p>
        <details><summary>{t('Full request details')}</summary><p>{request.operation}</p><pre className="permission-details">{request.details}</pre></details>
      </> : typeof command === 'string' && command.trim() ? <>
        <pre className="permission-details">{command}</pre>
        <details><summary>{t('Full request details')}</summary><pre className="permission-details">{request.details}</pre></details>
      </> : <pre className="permission-details">{request.details}</pre>}
      {request.capability === 'localExecution' && !request.executorLabel && <p className="permission-notice">{t('Allowing a run may let the agent read files, execute commands and access the internet on your computer. Codex Computer Use requests separate approval; other internal actions are controlled by the local agent.')}</p>}
      {request.context !== 'direct' && <p className="muted">{t('Results may be visible to everyone in this group.')}</p>}
      {request.taskScope && <p className="permission-notice">{t('Task approval scope')}: {request.taskScope}<br />{t('Expires when this task ends. Other resources still require approval.')}</p>}
      {request.sessionScope && <p className="permission-notice">{t('Session approval applies only to this app. Other apps and separate sensitive-action confirmations still require approval.')}<br />{t('Expires when the native session closes, including idle cleanup, stop, reset or app restart.')}</p>}
      <p className="muted">{t(request.sessionScope ? 'Choose once or allow this app for this session. No response within 10 minutes means deny.' : request.taskScope ? 'Allow this operation once, or reuse approval within the scope above for this task. No response within 10 minutes means deny.' : 'This approval is for this operation only. No response within 10 minutes means deny.')}</p>
      {error && <p role="alert">{t(error)}</p>}
      </div><footer className="edit-contact-footer"><button autoFocus className="secondary-button" disabled={busy} onClick={() => void resolve(false)}>{t('Deny')}</button><button className="primary-button" disabled={busy} onClick={() => void resolve(true)}>{t('Allow once')}</button>{request.taskScope && <button className="primary-button" disabled={busy} onClick={() => void resolve('task')}>{t('Allow for this task')}</button>}{request.sessionScope && <button className="primary-button" disabled={busy} onClick={() => void resolve('session')}>{t('Allow this app for this session')}</button>}</footer>
    </section>
  </NativeDialog>
}
