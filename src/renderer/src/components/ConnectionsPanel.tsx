import { Copy, MoreHorizontal, Plus, RefreshCw, ScanSearch, Server, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { ConnectionStatus, ConnectionTestReport, ConnectionView, DaemonEnrollment, DaemonEnrollmentResult, DiscoveredRemoteAgent, LocalAgent, RemoteConnectionInput } from '../../../shared/types'
import { messageSendError } from '../messageQueue'
import { t } from '../preferences'
import { NativeDialog } from './NativeDialog'

const MANUAL_HOST = '\u0000manual'
const ADAPTER_NAMES: Record<string, string> = {
  codex: 'Codex', claude: 'Claude Code', gemini: 'Gemini', grok: 'Grok Build', cursor: 'Cursor', opencode: 'OpenCode',
  kimi: 'Kimi', openclaw: 'OpenClaw', fastclaw: 'FastClaw', hermes: 'Hermes', omp: 'OMP'
}
const STEP_NAMES: Record<string, string> = { ssh: 'SSH login and host key', shell: 'Shell and base64', environment: 'Login PATH and home folder', workspace: 'Private folder on the server', forwarding: 'Socket forwarding', host: 'douchat-host online' }
const UNINSTALL_COMMAND = '"$HOME/.douchat-host/bin/douchat-host" uninstall --purge'
type ConnectionTab = 'ssh' | 'daemon'
const tabOf = (item: ConnectionView): ConnectionTab => item.kind === 'daemon' ? 'daemon' : 'ssh'

export function statusText(status: ConnectionStatus): string {
  if (status.state === 'disabled') return t('Turned off')
  if (status.state === 'connecting') return t('Connecting…')
  if (status.state === 'connected') return status.latencyMs === undefined ? t('Connected') : `${t('Connected')} · ${status.latencyMs} ms`
  return status.message
}

/** Settings → Connections: one row per server; agents on it are added from a scan. */
export function ConnectionsPanel({ onAgentsChange }: { onAgentsChange: (agents: LocalAgent[]) => void }): ReactElement {
  const [items, setItems] = useState<ConnectionView[]>()
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<ConnectionView | 'new'>()
  const [tab, setTab] = useState<ConnectionTab>('ssh')
  const [enrolling, setEnrolling] = useState(false)
  const [scanning, setScanning] = useState<ConnectionView>()
  const [menu, setMenu] = useState<string>()
  const [report, setReport] = useState<{ id: string; result?: ConnectionTestReport; running: boolean }>()
  const load = useCallback(() => window.douchat.listConnections().then(setItems, cause => setError(messageSendError(cause))), [])
  useEffect(() => { void load(); return window.douchat.onConnectionsChanged(() => void load()) }, [load])
  const run = async (action: () => Promise<ConnectionView[] | void>): Promise<void> => {
    setError('')
    try { const next = await action(); if (next) setItems(next) } catch (cause) { setError(messageSendError(cause)) }
  }
  const remove = (item: ConnectionView): void => {
    setMenu(undefined)
    if (!item.agentIds.length) { if (window.confirm(t('Delete this connection?'))) void run(() => window.douchat.removeConnection(item.id, 'disable-agents')); return }
    const deleteAgents = window.confirm(t('Agents use this connection. Press OK to delete them too (agents used by contacts are kept), or Cancel to keep them all (they will be unavailable).'))
    if (!deleteAgents && !window.confirm(t('Keep the agents and delete the connection?'))) return
    void run(async () => {
      const next = await window.douchat.removeConnection(item.id, deleteAgents ? 'delete-agents' : 'disable-agents')
      onAgentsChange(await window.douchat.detectLocalAgents())
      return next
    })
  }
  const test = async (item: ConnectionView): Promise<void> => {
    setMenu(undefined); setReport({ id: item.id, running: true })
    try { setReport({ id: item.id, result: await window.douchat.testConnection(item.id), running: false }) }
    catch (cause) { setReport(undefined); setError(messageSendError(cause)) }
  }
  return <>
    <header className="settings-heading local-proxy-heading"><div><h1>{t('Connections')}</h1><p>{t('Servers your agents run on. Host, user and key are set once here and shared by every agent on that server.')}</p></div>
      <div className="local-agent-heading-actions"><button className="secondary-button" onClick={() => tab === 'daemon' ? setEnrolling(true) : setEditing('new')}><Plus size={15} />{t('Add')}</button></div>
    </header>
    <div className="connections-tabs" role="tablist">
      {(['ssh', 'daemon'] as const).map(value => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{value === 'ssh' ? 'SSH' : 'douchat-host'}</button>)}
    </div>
    {tab === 'daemon' && <p className="settings-note">{t('douchat-host runs on your server and connects out to Douchat, so this computer needs no SSH access or open port to reach it. Agents on it work like SSH agents: Douchat on this computer drives them, and requests wait while it is offline.')}</p>}
    {error && <p className="settings-error" role="alert">{t(error)}</p>}
    {items && !items.some(item => tabOf(item) === tab) && <p className="settings-note">{t(tab === 'ssh' ? 'No connections yet. Add a server from your SSH config to run agents on it.' : 'No douchat-host servers yet. Add one and run the install command on the server.')}</p>}
    <section aria-label={t('Connections')}>{items?.filter(item => tabOf(item) === tab).map(item => <article className="local-agent-row connection-row" key={item.id}>
      <button type="button" className="detail-switch" role="switch" aria-label={`${t('Enabled')} ${item.name}`} aria-checked={item.enabled} onClick={() => void run(() => window.douchat.setConnectionEnabled(item.id, !item.enabled))} />
      <span className="local-agent-icon installed"><Server size={20} /></span>
      <div className="local-agent-copy">
        <strong>{item.name}</strong>
        <code>{item.label}</code>
        <span className={`connection-status connection-status-${item.status.state}`} role="status"><i aria-hidden="true" />{statusText(item.status)}{item.agentIds.length ? ` · ${item.agentIds.length} ${t(item.agentIds.length === 1 ? 'agent' : 'agents')}` : ''}</span>
        {report?.id === item.id && <div className="connection-report">
          {report.running ? <p className="settings-note"><RefreshCw size={13} className="spin" /> {t('Testing…')}</p> : report.result?.steps.map(step => <p key={step.name} className={step.passed ? 'connection-step-ok' : 'connection-step-failed'}>{step.passed ? '✓' : '✕'} {t(STEP_NAMES[step.name] ?? step.name)}{step.message ? ` · ${t(step.message)}` : ''}</p>)}
          {!report.running && <button type="button" className="local-settings-link" onClick={() => setReport(undefined)}>{t('Close')}</button>}
        </div>}
      </div>
      <div className="local-agent-row-aside">
        <button type="button" className="secondary-button" disabled={!item.enabled} title={t('Scan for agents on this server')} aria-label={`${t('Scan for agents on this server')} ${item.name}`} onClick={() => setScanning(item)}><ScanSearch size={15} /></button>
        <div className="connection-menu">
          <button type="button" className="icon-button" aria-label={`${t('More')} ${item.name}`} aria-expanded={menu === item.id} onClick={() => setMenu(menu === item.id ? undefined : item.id)}><MoreHorizontal size={16} /></button>
          {menu === item.id && <div className="connection-menu-items" role="menu">
            {item.kind !== 'daemon' && <button role="menuitem" onClick={() => { setMenu(undefined); setEditing(item) }}>{t('Edit')}</button>}
            <button role="menuitem" onClick={() => void test(item)}>{t('Test connection')}</button>
            <button role="menuitem" disabled={!item.enabled} onClick={() => { setMenu(undefined); void run(() => window.douchat.setConnectionEnabled(item.id, false)) }}>{t('Disconnect')}</button>
            <button role="menuitem" disabled={item.kind === 'daemon' || !item.enabled} title={item.kind === 'daemon' ? t('douchat-host servers have no terminal here. Work on the server directly.') : undefined}
              onClick={() => { setMenu(undefined); void run(() => window.douchat.openConnectionTerminal(item.id)) }}>{t('Open in terminal')}</button>
            {item.kind === 'daemon' && <button role="menuitem" onClick={() => { setMenu(undefined); void navigator.clipboard.writeText(UNINSTALL_COMMAND) }}>{t('Copy uninstall command')}</button>}
            <button role="menuitem" className="danger" onClick={() => remove(item)}>{t('Delete')}</button>
          </div>}
        </div>
      </div>
    </article>)}</section>
    {enrolling && <DaemonEnrollDialog onClose={() => setEnrolling(false)} onSaved={next => { setItems(next); setEnrolling(false) }} />}
    {editing && <ConnectionEditor connection={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} onSaved={next => { setItems(next); setEditing(undefined) }} />}
    {scanning && <DiscoverDialog connection={scanning} onClose={() => setScanning(undefined)} onAdded={agents => { onAgentsChange(agents); setScanning(undefined); void load() }} />}
  </>
}

function ConnectionEditor({ connection, onClose, onSaved }: { connection?: ConnectionView; onClose: () => void; onSaved: (items: ConnectionView[]) => void }): ReactElement {
  const [name, setName] = useState(connection?.name ?? '')
  const [host, setHost] = useState(connection?.ssh?.host ?? '')
  const [port, setPort] = useState(connection?.ssh?.port ? String(connection.ssh.port) : '')
  const [user, setUser] = useState(connection?.ssh?.user ?? '')
  const [identityFile, setIdentityFile] = useState(connection?.ssh?.identityFile ?? '')
  const [hosts, setHosts] = useState<string[]>([])
  const [manual, setManual] = useState(Boolean(connection))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  useEffect(() => {
    void window.douchat.listSshHosts().then(list => {
      if (!mounted.current) return
      setHosts(list)
      if (!connection && list.length) setHost(current => current || list[0])
      else if (!list.length || (connection && !list.includes(connection.ssh?.host ?? ''))) setManual(true)
      else if (connection) setManual(false)
    }).catch(() => { if (mounted.current) setManual(true) })
  }, [])
  const moved = connection && (host.trim() !== connection.ssh?.host || (port ? Number(port) : undefined) !== connection.ssh?.port || (user.trim() || undefined) !== connection.ssh?.user || (identityFile.trim() || undefined) !== connection.ssh?.identityFile)
  const save = async (): Promise<void> => {
    if (moved && connection.agentIds.length && !window.confirm(t('Changing the server stops running turns on it, and folders chosen on the old server will no longer be used. Continue?'))) return
    setBusy(true); setError('')
    const input: RemoteConnectionInput = { ...(connection ? { id: connection.id } : {}), name: name.trim(),
      ssh: { host: host.trim(), ...(port.trim() ? { port: Number(port) } : {}), ...(user.trim() ? { user: user.trim() } : {}), ...(identityFile.trim() ? { identityFile: identityFile.trim() } : {}) } }
    try { onSaved(await window.douchat.saveConnection(input)) }
    catch (cause) { if (mounted.current) { setError(messageSendError(cause)); setBusy(false) } }
  }
  return <NativeDialog className="modal-backdrop" onClose={onClose} width={520}>
    <form className="local-agent-editor" role="dialog" aria-modal="true" aria-labelledby="connection-editor-title" onSubmit={event => { event.preventDefault(); if (!busy && host.trim()) void save() }}>
      <header><h2 id="connection-editor-title">{t(connection ? 'Edit connection' : 'Add connection')}</h2><button type="button" className="icon-button" aria-label={t('Close')} onClick={onClose}><X size={18} /></button></header>
      <fieldset disabled={busy}>
        <label>{t('Server')}<select value={manual ? MANUAL_HOST : host} onChange={event => { if (event.target.value === MANUAL_HOST) { setManual(true); setHost('') } else { setManual(false); setHost(event.target.value) } }}>
          {hosts.map(item => <option key={item} value={item}>{item}</option>)}
          <option value={MANUAL_HOST}>{t('Enter manually…')}</option>
        </select></label>
        {manual && <label>{t('Host alias or address')}<input required maxLength={255} value={host} placeholder="dev-box" spellCheck={false} onChange={event => setHost(event.target.value)} /></label>}
        <div className="local-agent-remote-grid">
          <label>{t('User')}<input maxLength={32} value={user} placeholder={t('From SSH config')} spellCheck={false} onChange={event => setUser(event.target.value)} /></label>
          <label>{t('Port')}<input inputMode="numeric" maxLength={5} value={port} placeholder="22" onChange={event => setPort(event.target.value.replace(/\D/g, ''))} /></label>
          <label>{t('Identity file')}<input maxLength={1024} value={identityFile} placeholder="~/.ssh/id_ed25519" spellCheck={false} onChange={event => setIdentityFile(event.target.value)} /></label>
        </div>
        <label>{t('Name')}<input maxLength={80} value={name} placeholder={host || 'dev-box'} onChange={event => setName(event.target.value)} /></label>
        <p className="settings-note">{t('Leave user, port and key empty to use your SSH config (~/.ssh/config). Uses the ssh client, keys and ssh-agent on this computer; passwords are not stored. Confirm the host key once in Terminal with ssh before testing.')}</p>
      </fieldset>
      {error && <p className="settings-error" role="alert">{t(error)}</p>}
      <footer><span /><button type="button" className="secondary-button" onClick={onClose}>{t('Cancel')}</button><button type="submit" className="primary-button" disabled={busy || !host.trim()}>{t(busy ? 'Saving…' : 'Save')}</button></footer>
    </form>
  </NativeDialog>
}

function DiscoverDialog({ connection, onClose, onAdded }: { connection: ConnectionView; onClose: () => void; onAdded: (agents: LocalAgent[]) => void }): ReactElement {
  const [found, setFound] = useState<DiscoveredRemoteAgent[]>()
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    void window.douchat.discoverRemoteAgents(connection.id).then(list => { setFound(list); setChosen(new Set(list.map(item => item.adapter))) }, cause => setError(messageSendError(cause))).finally(() => setBusy(false))
  }, [connection.id])
  const add = async (): Promise<void> => {
    setBusy(true); setError('')
    try {
      onAdded(await window.douchat.addDiscoveredAgents(connection.id, (found ?? []).filter(item => chosen.has(item.adapter)).map(item => ({
        adapter: item.adapter, executable: item.executable, name: `${ADAPTER_NAMES[item.adapter] ?? item.adapter} · ${connection.name}`
      }))))
    } catch (cause) { setError(messageSendError(cause)); setBusy(false) }
  }
  return <NativeDialog className="modal-backdrop" onClose={onClose} width={520}>
    <div className="local-agent-editor" role="dialog" aria-modal="true" aria-labelledby="discover-title">
      <header><h2 id="discover-title">{t('Agents on')} {connection.name}</h2><button type="button" className="icon-button" aria-label={t('Close')} onClick={onClose}><X size={18} /></button></header>
      {!found && busy && <p className="settings-note"><RefreshCw size={13} className="spin" /> {t('Scanning the server…')}</p>}
      {found && !found.length && <p className="settings-note">{t('No supported agents were found in the login PATH on this server.')}</p>}
      {found?.map(item => <label key={item.adapter} className="local-agent-checkbox">
        <input type="checkbox" checked={chosen.has(item.adapter)} onChange={event => setChosen(current => { const next = new Set(current); if (event.target.checked) next.add(item.adapter); else next.delete(item.adapter); return next })} />
        <span>{ADAPTER_NAMES[item.adapter] ?? item.adapter} <code>{item.executable}</code>{item.version ? ` · ${item.version}` : ''}</span>
      </label>)}
      {error && <p className="settings-error" role="alert">{t(error)}</p>}
      <footer><span /><button type="button" className="secondary-button" onClick={onClose}>{t('Cancel')}</button><button type="button" className="primary-button" disabled={busy || !chosen.size} onClick={() => void add()}>{t('Add selected')}</button></footer>
    </div>
  </NativeDialog>
}

/**
 * Adds a douchat-host: the install command carries a one-time ticket and this
 * device's public key, so only this account's devices can direct the host.
 */
function DaemonEnrollDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (items: ConnectionView[]) => void }): ReactElement {
  const [enrollment, setEnrollment] = useState<DaemonEnrollment>()
  const [host, setHost] = useState<DaemonEnrollmentResult>()
  const [name, setName] = useState('')
  const [expired, setExpired] = useState(false)
  const [copied, setCopied] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const done = useRef(false)
  useEffect(() => {
    let active = true
    let current: DaemonEnrollment | undefined
    setEnrollment(undefined); setHost(undefined); setExpired(false); setError('')
    void window.douchat.createDaemonEnrollment().then(async created => {
      current = created
      if (!active) { void window.douchat.cancelDaemonEnrollment(created.id); return }
      setEnrollment(created)
      const result = await window.douchat.waitDaemonEnrollment(created.id)
      if (!active) return
      if (!result) { setExpired(true); return }
      setHost(result)
      setName(current => current || [result.info.os, result.info.arch].filter(Boolean).join(' ') || 'douchat-host')
    }).catch(cause => { if (active) setError(messageSendError(cause)) })
    return () => {
      active = false
      if (current && !done.current) void window.douchat.cancelDaemonEnrollment(current.id)
    }
  }, [attempt])
  const copy = (value: string, key: string): void => {
    void navigator.clipboard.writeText(value).then(() => { setCopied(key); setTimeout(() => setCopied(current => current === key ? '' : current), 2000) })
  }
  const save = async (): Promise<void> => {
    if (!enrollment) return
    setBusy(true); setError('')
    try { const next = await window.douchat.completeDaemonEnrollment(enrollment.id, { name: name.trim() }); done.current = true; onSaved(next) }
    catch (cause) { setError(messageSendError(cause)); setBusy(false) }
  }
  return <NativeDialog className="modal-backdrop" onClose={onClose} width={560}>
    <form className="local-agent-editor" role="dialog" aria-modal="true" aria-labelledby="daemon-enroll-title" onSubmit={event => { event.preventDefault(); if (host && !busy) void save() }}>
      <header><h2 id="daemon-enroll-title">{t('Add douchat-host')}</h2><button type="button" className="icon-button" aria-label={t('Close')} onClick={onClose}><X size={18} /></button></header>
      {!enrollment && !error && <p className="settings-note"><RefreshCw size={13} className="spin" /> {t('Creating install command…')}</p>}
      {enrollment && !host && <>
        <p className="settings-note">{t('1. Run this on the server as the user agents should run as (not root). It installs douchat-host in ~/.douchat-host, downloads Node.js there if the server has no Node.js 20+, and keeps it running as a user service.')}</p>
        <div className="daemon-command"><code>{enrollment.installCommand}</code><button type="button" className="secondary-button" aria-label={t('Copy install command')} onClick={() => copy(enrollment.installCommand, 'install')}><Copy size={14} />{t(copied === 'install' ? 'Copied' : 'Copy')}</button></div>
        <p className="settings-note">{t('2. When the installer asks, confirm that it shows this fingerprint:')} <code>{enrollment.fingerprint}</code></p>
        <p className="settings-note">{t('The command contains a one-time ticket that expires in 15 minutes. Do not share it. Closing this window without saving cancels it.')}</p>
        {expired
          ? <p className="settings-error" role="alert">{t('The install command expired before the server connected.')} <button type="button" className="local-settings-link" onClick={() => setAttempt(value => value + 1)}>{t('Create a new one')}</button></p>
          : <p className="settings-note" role="status"><RefreshCw size={13} className="spin" /> {t('Waiting for the server to connect…')} {t('If it does not connect, run this on the server:')} <code>~/.douchat-host/bin/douchat-host doctor</code></p>}
        <details><summary>{t('Uninstall')}</summary><div className="daemon-command"><code>{enrollment.uninstallCommand}</code><button type="button" className="secondary-button" onClick={() => copy(enrollment.uninstallCommand, 'uninstall')}><Copy size={14} />{t(copied === 'uninstall' ? 'Copied' : 'Copy')}</button></div></details>
      </>}
      {host && <fieldset disabled={busy}>
        <p className="connection-step-ok" role="status">✓ {t('douchat-host is online')}{host.info.version ? ` · v${host.info.version}` : ''}{host.info.os ? ` · ${[host.info.os, host.info.arch].filter(Boolean).join('/')}` : ''}</p>
        <label>{t('Name')}<input autoFocus maxLength={80} value={name} placeholder="dev-box" onChange={event => setName(event.target.value)} /></label>
        <p className="settings-note">{t('Next, scan the server for agents and add them. They run on the server, driven by Douchat on this computer, just like agents on an SSH connection.')}</p>
      </fieldset>}
      {error && <p className="settings-error" role="alert">{t(error)}</p>}
      <footer><span /><button type="button" className="secondary-button" onClick={onClose}>{t('Cancel')}</button>{host && <button type="submit" className="primary-button" disabled={busy}>{t(busy ? 'Saving…' : 'Save')}</button>}</footer>
    </form>
  </NativeDialog>
}
