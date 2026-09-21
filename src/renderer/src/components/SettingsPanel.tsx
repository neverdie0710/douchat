import { agentIcons } from '../agentIcons'
import { setPreferences, usePreferences, t, type LanguagePreference } from '../preferences'
import { SlidersHorizontal, Bot, Camera, CircleUserRound, Coins, ExternalLink, Info, LogOut, Plus, RefreshCw, ScanSearch, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactElement } from 'react'
import type { DesktopAuthUser, LocalAgent, UpdateDesktopProfileInput, UpdateState, UsageSummary } from '../../../shared/types'
import { readAvatarFile } from '../avatarFile'
import { UserAvatar } from './common'

export type SettingsTab = 'profile' | 'general' | 'usage' | 'agents' | 'about'

export function SettingsPanel({ user, agents, scanning, error, tab, creditsRefreshToken, onTab, onClose, onSignOut, onUpdateProfile, onDetect }: {
  user: DesktopAuthUser
  agents: LocalAgent[]
  scanning: boolean
  error: string
  tab: SettingsTab
  creditsRefreshToken: number
  onTab: (tab: SettingsTab) => void
  onClose: () => void
  onSignOut: () => Promise<void>
  onUpdateProfile: (input: UpdateDesktopProfileInput) => Promise<void>
  onDetect: () => void
}): ReactElement {
  const preferences = usePreferences()
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const installed = agents.filter((agent) => agent.installed)
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const signOut = async (): Promise<void> => {
    setSigningOut(true)
    setSignOutError('')
    try { await onSignOut() }
    catch (cause) {
      setSignOutError(cause instanceof Error ? cause.message : 'Could not sign out. Try again.')
      setSigningOut(false)
    }
  }
  const row = (agent: LocalAgent): ReactElement => (
    <article className="local-agent-row" key={agent.id}>
      <span data-agent={agent.id} className={`local-agent-icon ${agent.installed ? 'installed' : ''}`}>{agentIcons[agent.id] ? <img src={agentIcons[agent.id]} alt="" /> : <Bot size={22} />}</span>
      <div className="local-agent-copy">
        <strong>{agent.name}</strong>
        <code title={agent.path}>{agent.path || agent.command}</code>
      </div>
    </article>
  )
  return <div className="modal-backdrop settings-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <aside className="settings-sidebar">
      <div className="settings-modal-title"><div id="settings-title" className="wordmark">{t('Settings')}</div></div>
      <div className="settings-tabs" role="tablist" aria-label={t('Settings')}>
        <button id="profile-tab" role="tab" aria-selected={tab === 'profile'} aria-controls="settings-content" className={tab === 'profile' ? 'active' : ''} onClick={() => onTab('profile')}><CircleUserRound size={18} /><span>{t('Account')}</span></button>
        <button id="general-tab" role="tab" aria-selected={tab === 'general'} aria-controls="settings-content" className={tab === 'general' ? 'active' : ''} onClick={() => onTab('general')}><SlidersHorizontal size={18} /><span>{t('General')}</span></button>
        <button id="usage-tab" role="tab" aria-selected={tab === 'usage'} aria-controls="settings-content" className={tab === 'usage' ? 'active' : ''} onClick={() => onTab('usage')}><Coins size={18} /><span>{t('Credits')}</span></button>
        <button id="agents-tab" role="tab" aria-selected={tab === 'agents'} aria-controls="settings-content" className={tab === 'agents' ? 'active' : ''} onClick={() => onTab('agents')}><Bot size={18} /><span>{t('Local agents')}</span></button>
        <button id="about-tab" role="tab" aria-selected={tab === 'about'} aria-controls="settings-content" className={tab === 'about' ? 'active' : ''} onClick={() => onTab('about')}><Info size={18} /><span>{t('About')}</span></button>
      </div>
    </aside>
    <main id="settings-content" role="tabpanel" aria-labelledby={`${tab}-tab`} className="settings-content">
      <button autoFocus className="settings-close" onClick={onClose} aria-label={t('Close')} title={t('Close')}><X size={18} /></button>
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
      </> : tab === 'usage' ? <UsageTab refreshToken={creditsRefreshToken} /> : tab === 'agents'  ? <>
        <header className="settings-heading local-proxy-heading"><div><h1>{t('Local agents')}</h1><p>{t('View the local agents available on this computer.')}</p></div>
          <button className="secondary-button" disabled={scanning} onClick={onDetect}>{scanning ? <RefreshCw className="spin" size={15} /> : <ScanSearch size={15} />}{scanning ? t('Detecting…') : t('Detect')}</button>
        </header>
        {error && <p className="settings-error" role="alert">{t(error)}</p>}
        <section aria-label={t('Installed agents')}><h2>{t('Installed')} <span>{installed.length}</span></h2>
          {installed.map(row)}
          {!installed.length && <p className="settings-note">{scanning ? t('Checking your shell and installed commands…') : t('No supported local agents found. Install one in your terminal, then detect again.')}</p>}
        </section>
      </> : <AboutTab />}
    </main>
    </section>
  </div>
}

export function UsageTab({ refreshToken = 0 }: { refreshToken?: number }): ReactElement {
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    setError('')
    try { setSummary(await window.douchat.getUsageSummary()) }
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
  return <>
    <header className="settings-heading usage-heading">
      <div><h1>{t('Credits')}</h1><p>{t('Manage your Douchat credit balance.')}</p></div>
      <button className="secondary-button usage-refresh" type="button" disabled={loading} onClick={() => void load()}>
        <RefreshCw className={loading ? 'spin' : ''} size={15} />{t('Refresh')}
      </button>
    </header>
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
          disabled={!summary || opening}
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
          <a className="secondary-button about-website-button" href="https://douchat.ai" target="_blank" rel="noreferrer">
            {t('Open website')}<ExternalLink size={14} />
          </a>
        </div>
      </div>
    </section>
    <p className="settings-note about-note">{t('Updates are downloaded from signed Douchat releases. The app waits for active agent tasks before restarting.')}</p>
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
