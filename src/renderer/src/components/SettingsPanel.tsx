import { CustomModelSettings } from './CustomModelSettings'
import { messageSendError } from '../messageQueue'
import { NativeDialog } from './NativeDialog'
import { reportDiagnostic } from '../diagnostics'
import { agentIcons } from '../agentIcons'
import { setPreferences, usePreferences, t, tr, type LanguagePreference } from '../preferences'
import { SlidersHorizontal, Bot, CalendarClock, Camera, CircleUserRound, Coins, Cpu, ExternalLink, Info, LogOut, Pause, Play, Plus, RefreshCw, ScanSearch, Trash2, TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactElement } from 'react'
import type { AgentConfig, Conversation, DesktopAuthUser, LocalAgent, Routine, RoutineSchedule, TaskRun, UpdateDesktopProfileInput, UpdateState, UsageSummary } from '../../../shared/types'
import { readAvatarFile } from '../avatarFile'
import { AgentAvatar, ConversationAvatar, EmptyAvatar, UserAvatar, agentDisplayName, conversationDisplayName } from './common'

export type SettingsTab = 'profile' | 'general' | 'usage' | 'automation' | 'agents' | 'models' | 'about'

export function SettingsPanel({ user, agents, routines = [], runs = [], workspaceAgents = [], conversations = [], scanning, error, tab, creditsRefreshToken, creditsAttention = false, onCreditsAvailable, onTab, onClose, onSignOut, onUpdateProfile, onDetect, onRemoveCustom, onDeleteRoutine, onSetRoutineEnabled, onRunRoutineNow }: {
  user: DesktopAuthUser
  agents: LocalAgent[]
  routines?: Routine[]
  runs?: TaskRun[]
  workspaceAgents?: AgentConfig[]
  conversations?: Conversation[]
  scanning: boolean
  error: string
  tab: SettingsTab
  creditsRefreshToken: number
  creditsAttention?: boolean
  onCreditsAvailable?: () => void
  onTab: (tab: SettingsTab) => void
  onClose: () => void
  onSignOut: () => Promise<void>
  onUpdateProfile: (input: UpdateDesktopProfileInput) => Promise<void>
  onDetect: () => void
  onRemoveCustom?: (id: string) => Promise<void>
  onDeleteRoutine?: (id: string) => Promise<void>
  onSetRoutineEnabled?: (id: string, enabled: boolean) => Promise<void>
  onRunRoutineNow?: (id: string) => Promise<void>
}): ReactElement {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    // Avoid a synchronous focus/layout flush in React's initial DOM commit on Windows.
    // Keep keyboard focus in the dialog, and restore it to the opener when dismissed.
    const opener = document.activeElement
    const timer = window.setTimeout(() => {
      reportDiagnostic('settings.focus-start')
      closeRef.current?.focus({ preventScroll: true })
      reportDiagnostic('settings.focus-complete')
    }, 300)
    return () => {
      window.clearTimeout(timer)
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    reportDiagnostic('settings.mounted')
    const timer = window.setTimeout(() => {
      const element = closeRef.current?.ownerDocument.querySelector('.settings-modal')
      const bounds = element?.getBoundingClientRect()
      const style = element ? getComputedStyle(element) : undefined
      reportDiagnostic('settings.layout', JSON.stringify({ tab, width: bounds?.width, height: bounds?.height, display: style?.display, visibility: style?.visibility, opacity: style?.opacity, viewport: [element?.ownerDocument.defaultView?.innerWidth, element?.ownerDocument.defaultView?.innerHeight] }))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [tab])
  const preferences = usePreferences()
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const [customError, setCustomError] = useState('')
  const installed = agents.filter((agent) => agent.installed)
  const desktopOnly = agents.filter((agent) => agent.status === 'desktop-only')
  const missing = agents.filter((agent) => agent.status === 'not-found')


  const signOut = async (): Promise<void> => {
    setSigningOut(true)
    setSignOutError('')
    try { await onSignOut() }
    catch (cause) {
      setSignOutError(cause instanceof Error ? cause.message : 'Could not sign out. Try again.')
      setSigningOut(false)
    }
  }
  const removeCustom = async (agent: LocalAgent): Promise<void> => {
    if (!onRemoveCustom || !window.confirm(t('Delete this custom local agent?'))) return
    setCustomError('')
    try { await onRemoveCustom(agent.id) }
    catch (cause) { setCustomError(cause instanceof Error ? cause.message : 'Could not remove custom local agent.') }
  }
  const [maintaining, setMaintaining] = useState('')
  const refreshAfterTerminal = useRef(false)
  useEffect(() => {
    const focus = () => { if (refreshAfterTerminal.current) { refreshAfterTerminal.current = false; onDetect() } }
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [onDetect])
  const maintain = async (agent: LocalAgent): Promise<void> => {
    setMaintaining(agent.id); setCustomError('')
    try { refreshAfterTerminal.current = await window.douchat.maintainLocalAgent(agent.id) }
    catch (cause) { setCustomError(messageSendError(cause)) }
    finally { setMaintaining('') }
  }
  const row = (agent: LocalAgent): ReactElement => {
    const version = agent.custom ? '' : agent.version?.match(/v?\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?/)?.[0] ?? agent.version ?? ''
    return <article className="local-agent-row" key={agent.id}>
        <span data-agent={agent.id} className={`local-agent-icon ${agent.installed ? 'installed' : ''}`}>{agentIcons[agent.id] ? <img src={agentIcons[agent.id]} alt="" /> : <Bot size={22} />}</span>
        <div className="local-agent-copy">
          <strong>{agent.name}</strong>
          <code title={agent.path || agent.desktopPath}>{agent.path || agent.desktopPath || agent.command}</code>
        </div>
        <div className="local-agent-row-aside">
          {version && <span className="local-agent-version" title={agent.version}>{version}</span>}
          {agent.installed && !agent.custom && (!agent.updateStatus || agent.updateStatus === 'unknown') && <span className="local-agent-version" title={t('Could not confirm the latest version. Detect again later.')}>{t('Version unconfirmed')}</span>}
          {(agent.custom || !agent.installed || agent.updateStatus === 'available') && <button type="button" className="secondary-button" title={agent.latestVersion ? tr('Latest version: {version}', { version: agent.latestVersion }) : undefined} disabled={Boolean(maintaining) || scanning} onClick={() => void maintain(agent)}>{t(maintaining === agent.id ? 'Preparing…' : agent.custom ? 'Installation instructions' : agent.installed ? 'Update' : 'Install')}</button>}
          {agent.custom && <button type="button" className="icon-button local-agent-remove" aria-label={`${t('Remove')} ${agent.name}`} title={t('Remove')} onClick={() => void removeCustom(agent)}><Trash2 size={16} /></button>}
        </div>
      </article>
  }
  return <NativeDialog className="modal-backdrop settings-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()} onClose={onClose} width={980} height={720}>
    <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <aside className="settings-sidebar">
      <div className="settings-modal-title"><div id="settings-title" className="wordmark">{t('Settings')}</div></div>
      <div className="settings-tabs" role="tablist" aria-label={t('Settings')}>
        <button id="profile-tab" role="tab" aria-selected={tab === 'profile'} aria-controls="settings-content" className={tab === 'profile' ? 'active' : ''} onClick={() => onTab('profile')}><CircleUserRound size={18} /><span>{t('Account')}</span></button>
        <button id="general-tab" role="tab" aria-selected={tab === 'general'} aria-controls="settings-content" className={tab === 'general' ? 'active' : ''} onClick={() => onTab('general')}><SlidersHorizontal size={18} /><span>{t('General')}</span></button>
        <button id="usage-tab" role="tab" aria-selected={tab === 'usage'} aria-controls="settings-content" className={tab === 'usage' ? 'active' : ''} onClick={() => onTab('usage')}><Coins size={18} /><span>{t('Credits')}</span></button>
        <button id="automation-tab" role="tab" aria-selected={tab === 'automation'} aria-controls="settings-content" className={tab === 'automation' ? 'active' : ''} onClick={() => onTab('automation')}><CalendarClock size={18} /><span>{t('Automation')}</span></button>
        <button id="models-tab" role="tab" aria-selected={tab === 'models'} aria-controls="settings-content" className={tab === 'models' ? 'active' : ''} onClick={() => onTab('models')}><Cpu size={18} /><span>{t("Models")}</span></button>
        <button id="agents-tab" role="tab" aria-selected={tab === 'agents'} aria-controls="settings-content" className={tab === 'agents' ? 'active' : ''} onClick={() => onTab('agents')}><Bot size={18} /><span>{t('Local agents')}</span></button>
        <button id="about-tab" role="tab" aria-selected={tab === 'about'} aria-controls="settings-content" className={tab === 'about' ? 'active' : ''} onClick={() => onTab('about')}><Info size={18} /><span>{t('About')}</span></button>
      </div>
    </aside>
    <main id="settings-content" role="tabpanel" aria-labelledby={`${tab}-tab`} className="settings-content">
      <button ref={closeRef} className="settings-close" onClick={onClose} aria-label={t('Close')} title={t('Close')}><X size={18} /></button>
      {tab === 'profile' ? (
        <ProfileTab user={user} signingOut={signingOut} signOutError={signOutError} onSignOut={() => void signOut()} onUpdateProfile={onUpdateProfile} />
      ) : tab === 'general' ? <>
        <header className="settings-heading"><div><h1>{t('General')}</h1><p>{t('Choose your language and appearance.')}</p></div></header>
        <div className="general-settings">
          <label><span>{t('Language')}</span><select value={preferences.language} onChange={(event) => setPreferences({ language: event.target.value as LanguagePreference })}><option value="system">{t('Follow system')}</option><option value="en">English</option><option value="zh-CN">简体中文</option></select></label>
          <label><span>{t('Appearance')}</span><select value={preferences.appearance} onChange={(event) => setPreferences({ appearance: event.target.value as 'system' | 'light' | 'dark' })}><option value="system">{t('System')}</option><option value="light">{t('Light')}</option><option value="dark">{t('Dark')}</option></select></label>
          <label className="font-size-setting"><span>{t('Font size')}</span><div className="font-size-control">
            <input type="range" min="0" max="4" step="1" value={preferences.fontSize} aria-label={t('Font size')} aria-valuetext={`${[85, 92, 100, 110, 120][preferences.fontSize]}%`} onChange={(event) => setPreferences({ fontSize: Number(event.target.value) })} />
            <div className="font-size-labels"><span>{t('Small')}</span><button type="button" onClick={() => setPreferences({ fontSize: 1 })}>{t('Standard')}</button><span>{t('Large')}</span></div>
          </div></label>
          <div className="font-size-preview" aria-label={t('Font preview')}>{t('Messages and interface text update immediately.')}</div>
        </div>
      </> : tab === 'usage' ? <UsageTab refreshToken={creditsRefreshToken} attention={creditsAttention} onCreditsAvailable={onCreditsAvailable} /> : tab === 'automation' ? <AutomationTab
        routines={routines}
        runs={runs}
        agents={workspaceAgents}
        conversations={conversations}
        userName={user.name}
        userAvatar={user.image || ''}
        onDelete={onDeleteRoutine}
        onSetEnabled={onSetRoutineEnabled}
        onRunNow={onRunRoutineNow}
      /> : tab === 'agents'  ? <>
        <header className="settings-heading local-proxy-heading"><div><h1>{t('Local agents')}</h1><p>{t('View the local agents available on this computer.')}</p></div>
          <button className="secondary-button" disabled={scanning} onClick={onDetect}>{scanning ? <RefreshCw className="spin" size={15} /> : <ScanSearch size={15} />}{scanning ? t('Detecting…') : t('Detect')}</button>
        </header>
        {error && <p className="settings-error" role="alert">{t(error)}</p>}
        {maintaining && <p role="status">{t('Preparing to install or update. Downloading the runtime for the first time may take a few minutes.')}</p>}
        {customError && <p className="settings-error" role="alert">{t(customError)}</p>}
        <section aria-label={t('Installed agents')}><h2>{t('Installed')} <span>{installed.length}</span></h2>
          {installed.map(row)}
          {!installed.length && <p className="settings-note">{scanning ? t('Checking your shell and installed commands…') : t('No supported local agents found. Install one in your terminal, then detect again.')}</p>}
        </section>
        {desktopOnly.length > 0 && <section aria-label={t('Desktop apps needing a CLI')}><h2>{t('Desktop app only')} <span>{desktopOnly.length}</span></h2>{desktopOnly.map(row)}</section>}
        {missing.length > 0 && <section aria-label={t('Other supported agents')}><h2>{t('Not detected')} <span>{missing.length}</span></h2>{missing.map(row)}</section>}
      </> : tab === 'models' ? <CustomModelSettings /> : <AboutTab />}
    </main>
    </section>
  </NativeDialog>
}

function routineScheduleLabel(schedule: RoutineSchedule): string {
  if (schedule.kind === 'once') {
    return t('Once')
  }
  if (schedule.kind === 'interval') {
    const minutes = Math.max(1, Math.round(schedule.intervalMinutes))
    if (minutes % 1440 === 0) return t('Every {count} days').replace('{count}', String(minutes / 1440))
    if (minutes % 60 === 0) return t('Every {count} hours').replace('{count}', String(minutes / 60))
    return t('Every {count} minutes').replace('{count}', String(minutes))
  }
  const labels = [t('Sun'), t('Mon'), t('Tue'), t('Wed'), t('Thu'), t('Fri'), t('Sat')]
  const days = [...new Set(schedule.days)].sort().map((day) => labels[day]).join(' · ')
  return `${days} · ${schedule.time}`
}

function AutomationTab({ routines, runs, agents, conversations, userName, userAvatar, onDelete, onSetEnabled, onRunNow }: {
  routines: Routine[]
  runs: TaskRun[]
  agents: AgentConfig[]
  conversations: Conversation[]
  userName: string
  userAvatar: string
  onDelete?: (id: string) => Promise<void>
  onSetEnabled?: (id: string, enabled: boolean) => Promise<void>
  onRunNow?: (id: string) => Promise<void>
}): ReactElement {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const perform = async (key: string, action: () => Promise<void>): Promise<void> => {
    setBusy(key)
    setError('')
    try { await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy('') }
  }
  const remove = async (routine: Routine): Promise<void> => {
    if (!onDelete || !window.confirm(t('Delete this automation?'))) return
    await perform(`delete:${routine.id}`, () => onDelete(routine.id))
  }
  const date = (value: number): string => new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))

  return <>
    <header className="settings-heading"><div><h1>{t('Automation')}</h1><p>{t('Scheduled tasks created from your conversations.')}</p></div></header>
    {error && <p className="settings-error" role="alert">{t(error)}</p>}
    {!routines.length ? <section className="automation-empty">
      <CalendarClock size={28} aria-hidden="true" />
      <strong>{t('No scheduled tasks yet')}</strong>
      <p>{t('Ask any contact to remind you later or run something on a schedule.')}</p>
    </section> : <section className="automation-list" aria-label={t('Automation')}>
      {routines.map((routine) => {
        const agent = agents.find((item) => item.id === routine.agentId)
        const conversation = conversations.find((item) => item.id === routine.conversationId)
        const contactName = conversation
          ? conversationDisplayName(conversation, agents)
          : agent
            ? agentDisplayName(agent)
            : t('Unknown conversation')
        const lastRun = runs
          .filter((run) => run.routineId === routine.id)
          .sort((left, right) => right.createdAt - left.createdAt)[0]
        const onceFinished = routine.schedule.kind === 'once' && routine.schedule.runAt <= Date.now()
        const status = lastRun?.status === 'running'
          ? t('Running')
          : routine.enabled && lastRun?.status === 'failed'
            ? t('Retrying')
            : routine.enabled
              ? t('Active')
              : lastRun?.status === 'failed'
                ? t('Failed')
                : onceFinished && lastRun?.status === 'succeeded'
                  ? t('Completed')
                  : onceFinished
                    ? t('Expired')
                    : t('Paused')
        return <article className="automation-row" key={routine.id}>
          <div className="automation-row-copy">
            <div className="automation-row-title"><strong>{routine.name}</strong><span data-enabled={routine.enabled}>{status}</span></div>
            <p>{routine.prompt}</p>
            <div className="automation-row-meta">
              <span className="automation-row-contact">
                {conversation
                  ? <ConversationAvatar conversation={conversation} agents={agents} userName={userName} userAvatar={userAvatar} size={22} />
                  : agent
                    ? <AgentAvatar agent={agent} size={22} />
                    : <EmptyAvatar size={22} />}
                <span className="automation-row-contact-name">{contactName}</span>
              </span>
              <span>{routineScheduleLabel(routine.schedule)}</span>
              {routine.enabled
                ? <span>{t('Next run: {time}').replace('{time}', date(routine.nextRunAt))}</span>
                : routine.lastRunAt
                  ? <span>{t('Last run: {time}').replace('{time}', date(routine.lastRunAt))}</span>
                  : null}
            </div>
          </div>
          <div className="automation-row-actions">
            <button type="button" className="icon-button" disabled={!onRunNow || Boolean(busy)} aria-label={t('Run now')} title={t('Run now')} onClick={() => onRunNow && void perform(`run:${routine.id}`, () => onRunNow(routine.id))}><Play size={16} /></button>
            <button
              type="button"
              className="icon-button"
              disabled={!onSetEnabled || Boolean(busy) || (!routine.enabled && onceFinished)}
              aria-label={routine.enabled ? t('Pause') : t('Resume')}
              title={routine.enabled ? t('Pause') : t('Resume')}
              onClick={() => onSetEnabled && void perform(`enabled:${routine.id}`, () => onSetEnabled(routine.id, !routine.enabled))}
            >{routine.enabled ? <Pause size={16} /> : <Play size={16} />}</button>
            <button type="button" className="icon-button automation-delete" disabled={!onDelete || Boolean(busy)} aria-label={t('Delete')} title={t('Delete')} onClick={() => void remove(routine)}><Trash2 size={16} /></button>
          </div>
        </article>
      })}
    </section>}
    <p className="automation-footnote">{t('If Douchat is not running when a task is due, it runs once after the next launch.')}</p>
  </>
}

export function UsageTab({ refreshToken = 0, attention = false, onCreditsAvailable }: { refreshToken?: number; attention?: boolean; onCreditsAvailable?: () => void }): ReactElement {
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const next = await window.douchat.getUsageSummary()
      setSummary(next)
      if (next.credits > 0) onCreditsAvailable?.()
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [refreshToken])

  const openTopUp = async (): Promise<void> => {
    setOpening(true)
    setError('')
    try { await window.douchat.openSubscriptionPlans() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setOpening(false) }
  }

  const credits = summary ? new Intl.NumberFormat(document.documentElement.lang || undefined).format(summary.credits) : '—'
  const showAttention = attention && (!summary || summary.credits <= 0)
  return <>
    <header className="settings-heading usage-heading">
      <div><h1>{t('Credits')}</h1><p>{t('Manage your Douchat credit balance.')}</p></div>
      <button className="secondary-button usage-refresh" type="button" disabled={loading} onClick={() => void load()}>
        <RefreshCw className={loading ? 'spin' : ''} size={15} />{t('Refresh')}
      </button>
    </header>
    {showAttention && <div className="usage-credit-alert" role="alert">
      <TriangleAlert size={18} aria-hidden="true" />
      <div><strong>{t('Not enough Douchat credits')}</strong><span>{t('Top up credits to continue.')}</span></div>
    </div>}
    <section className="usage-card" aria-label={t('Credits')} aria-busy={loading}>
      <div className="usage-credit-row">
        <span className="usage-credit-icon" aria-hidden="true"><Coins size={23} /></span>
        <div className="usage-credit-copy">
          <span>{t('Credit balance')}</span>
          <strong aria-live="polite">{loading && !summary ? '—' : credits}</strong>
        </div>
        <button
          className="primary-button usage-top-up-button"
          type="button"
          disabled={opening}
          onClick={() => void openTopUp()}
        >
          <Plus size={16} />{t(opening ? 'Opening…' : 'Top up')}
        </button>
      </div>
      <div className="usage-credit-note">
        <span>{t('Cloud agent replies use Douchat credits. Local agents do not.')}</span>
        <span>{t('Top up securely in your browser.')}</span>
      </div>
      {error && <div className="usage-error" role="alert"><span>{t(error)}</span><button type="button" onClick={() => void load()}>{t('Try again')}</button></div>}
    </section>
  </>
}

function AboutTab(): ReactElement {
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [requestError, setRequestError] = useState('')

  useEffect(() => {
    let active = true
    void window.douchat.getUpdateState()
      .then((state) => { if (active) setUpdate(state) })
      .catch((cause) => { if (active) setRequestError(cause instanceof Error ? cause.message : String(cause)) })
    const unsubscribe = window.douchat.onUpdateState((state) => { if (active) setUpdate(state) })
    return () => { active = false; unsubscribe() }
  }, [])

  const check = async (): Promise<void> => {
    setRequestError('')
    try { setUpdate(await window.douchat.checkForUpdates()) }
    catch (cause) { setRequestError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const install = async (): Promise<void> => {
    setRequestError('')
    try { setUpdate(await window.douchat.installUpdate()) }
    catch (cause) { setRequestError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const status = update?.status ?? 'idle'
  const version = update?.availableVersion
  const error = requestError || update?.error || ''
  const checkButton = (
    <button
      className="secondary-button update-check-button"
      disabled={status === 'checking' || status === 'disabled'}
      title={status === 'disabled' ? t('Update checks are available in packaged builds.') : undefined}
      onClick={() => void check()}
    >
      {status === 'checking' && <RefreshCw className="spin" size={15} />}
      {status === 'checking' ? t('Checking for updates…') : t('Check for updates')}
    </button>
  )
  return <>
    <header className="settings-heading"><div><h1>{t('About')}</h1><p>{t('Version information and software updates.')}</p></div></header>
    <section className="about-card">
      <div className="about-row about-version-row">
        <div className="about-row-copy">
          <strong>{t('Version information')}</strong>
          <span>{update?.currentVersion ?? '…'}</span>
          <div className="about-update-status" aria-live="polite">
            {status === 'downloading' ? <>
              <div className="update-progress"><i style={{ width: `${update?.percent ?? 0}%` }} /></div>
              <span>{t('Downloading the verified update from Douchat…')}</span>
            </> : status === 'available' ? <div className="update-copy"><span>{t('Version {version} is available').replace('{version}', version ?? '')}</span>{update?.releaseNotes && <p>{update.releaseNotes}</p>}</div>
              : status === 'downloaded' ? <div className="update-copy"><span>{t('Update ready to install')}</span>{Boolean(update?.busyTasks) && <p>{t('Finish {count} active tasks before restarting.').replace('{count}', String(update?.busyTasks))}</p>}</div>
                : status === 'installing' ? <span>{t('Installing update and restarting…')}</span>
                  : status === 'checking' ? <span>{t('Connecting to the Douchat update service…')}</span>
                    : status === 'up-to-date' ? <span>{t('You are using the latest version.')}</span>
                      : status === 'disabled' ? <span>{t('Update checks are available in packaged builds.')}</span>
                        : null}
            {error && <p className="settings-error">{t('Update failed:')} {t(error)}</p>}
          </div>
        </div>
        <div className="about-action">
          {status === 'available'
            ? <button className="primary-button" onClick={() => void install()}>{t('Update to v{version} and restart').replace('{version}', version ?? '')}</button>
            : status === 'downloaded'
              ? <button className="primary-button" onClick={() => void install()}>{t('Restart to finish update')}</button>
              : status === 'installing'
                ? <button className="secondary-button update-check-button" disabled>{t('Installing update and restarting…')}</button>
                : status === 'downloading'
                  ? <button className="secondary-button update-check-button" disabled>{t('Downloading update…')} {update?.percent ?? 0}%</button>
                  : checkButton}
        </div>
      </div>
      <div className="about-row">
        <div className="about-row-copy">
          <strong>{t('Douchat website')}</strong>
          <span>douchat.ai</span>
        </div>
        <div className="about-action">
          <a className="secondary-button about-website-button" href="https://douchat.ai/?utm_source=douchat-desktop" target="_blank" rel="noreferrer">
            {t('Open website')}<ExternalLink size={14} />
          </a>
        </div>
      </div>
      <div className="about-row">
        <div className="about-row-copy">
          <strong>{t('Diagnostic logs')}</strong>
          <span>{t('Share local logs to help troubleshoot display errors.')}</span>
        </div>
        <div className="about-action">
          <button className="secondary-button" onClick={() => { void window.douchat.openDiagnosticLogs().catch((error) => window.alert(String(error))) }}>{t('Open log folder')}</button>
        </div>
      </div>
    </section>
  </>
}

/** One account, one identity: edits are saved to the service and the returned
 * user record becomes the desktop-wide source of truth. */
function ProfileTab({ user, signingOut, signOutError, onSignOut, onUpdateProfile }: {
  user: DesktopAuthUser
  signingOut: boolean
  signOutError: string
  onSignOut: () => void
  onUpdateProfile: (input: UpdateDesktopProfileInput) => Promise<void>
}): ReactElement {
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(user.name)
  const [image, setImage] = useState(user.image || '')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [failure, setFailure] = useState('')

  useEffect(() => {
    setName(user.name)
    setImage(user.image || '')
  }, [user.name, user.image])

  const dirty = name.trim() !== user.name || image !== (user.image || '')

  const choose = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    // Clearing lets the same file be picked again after a failure.
    event.target.value = ''
    if (!file) return
    setFailure('')
    setNotice('')
    try {
      setImage(await readAvatarFile(file))
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'This picture could not be used.')
    }
  }

  const save = async (): Promise<void> => {
    const nextName = name.trim()
    if (!nextName) {
      setFailure('Name cannot be empty.')
      return
    }
    setSaving(true)
    setFailure('')
    setNotice('')
    try {
      const changes: UpdateDesktopProfileInput = {}
      if (nextName !== user.name) changes.name = nextName
      if (image !== (user.image || '')) changes.image = image
      await onUpdateProfile(changes)
      setNotice(t('Saved to your Douchat account'))
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Could not save account changes.')
    } finally {
      setSaving(false)
    }
  }

  return <>
    <header className="settings-heading"><div><h1>{t('Account')}</h1><p>{t('Your account identity is used everywhere in Douchat.')}</p></div></header>
    <form className="account-profile" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <section className="profile-identity" aria-label={t('Profile picture')}>
        <button type="button" className="profile-avatar" onClick={() => fileRef.current?.click()} aria-label={t('Change your picture')}>
          <UserAvatar src={image} name={name || user.name} size={96} />
          <span className="profile-avatar-overlay"><Camera size={18} strokeWidth={1.9} /></span>
        </button>
        <div className="profile-identity-copy">
          <strong>{name.trim() || user.name}</strong>
          <small>{t('PNG or JPG. Your picture is synced to your Douchat account.')}</small>
          <div className="profile-avatar-actions">
            <button type="button" className="secondary-button" onClick={() => fileRef.current?.click()}>{t('Choose picture')}</button>
            {image && <button type="button" className="secondary-button" onClick={() => { setImage(''); setNotice('') }}>{t('Remove')}</button>}
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void choose(event)} />
      </section>
      <section className="profile-name-section" aria-label={t('Your name')}>
        <label className="profile-field">
          <span>{t('Name')}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('Your name')}
            aria-label={t('Display name')}
          />
        </label>
        <label className="profile-field">
          <span>{t('Email')}</span>
          <input value={user.email} disabled aria-label={t('Email')} />
        </label>
      </section>
      <div className="account-save-row">
        <div aria-live="polite">{failure ? <span className="settings-error">{t(failure)}</span> : notice ? <span className="settings-success">{notice}</span> : <span>{t('Changes sync to every signed-in Douchat app.')}</span>}</div>
        <button className="primary-button" type="submit" disabled={!dirty || saving || !name.trim()}>{t(saving ? 'Saving…' : 'Save changes')}</button>
      </div>
    </form>
    <section className="account-session" aria-label={t('Signed-in account')}>
      <div><strong>{t('Signed in to Douchat')}</strong><span>{user.email}</span></div>
      <button className="sign-out-button" disabled={signingOut} onClick={onSignOut}><LogOut size={15} />{t(signingOut ? 'Signing out…' : 'Sign out')}</button>
    </section>
    {signOutError && <p className="settings-error" role="alert">{t(signOutError)}</p>}
  </>
}
