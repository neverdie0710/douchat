import { agentIcons } from '../agentIcons'
import { setPreferences, usePreferences, t } from '../preferences'
import { SlidersHorizontal, Bot, Camera, CircleUserRound, LogOut, PlugZap, RefreshCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactElement } from 'react'
import type { AppSnapshot, DesktopAuthUser, LocalAgent, UpdateDesktopProfileInput } from '../../../shared/types'
import { readAvatarFile } from '../avatarFile'
import { UserAvatar } from './common'

export type SettingsTab = 'profile' | 'general' | 'agents' | 'models'

export function SettingsPanel({ snapshot, user, agents, scanning, error, tab, onTab, onClose, onSignOut, onUpdateProfile, onRefresh, onCreate, onContact, onEndpoint }: {
  snapshot: AppSnapshot
  user: DesktopAuthUser
  agents: LocalAgent[]
  scanning: boolean
  error: string
  tab: SettingsTab
  onTab: (tab: SettingsTab) => void
  onClose: () => void
  onSignOut: () => Promise<void>
  onUpdateProfile: (input: UpdateDesktopProfileInput) => Promise<void>
  onRefresh: () => void
  onCreate: (agent: LocalAgent) => void
  onContact: (id: string) => void
  onEndpoint: () => void
}): ReactElement {
  const preferences = usePreferences()
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const installed = agents.filter((agent) => agent.installed)
  const missing = agents.filter((agent) => !agent.installed)
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
  const row = (agent: LocalAgent): ReactElement => {
    const contacts = snapshot.agents.filter((contact) => contact.localAgentId === agent.id)
    return <article className="local-agent-row" key={agent.id}>
      <span data-agent={agent.id} className={`local-agent-icon ${agent.installed ? 'installed' : ''}`}>{agentIcons[agent.id] ? <img src={agentIcons[agent.id]} alt="" /> : <Bot size={22} />}</span>
      <div className="local-agent-copy">
        <strong>{agent.name}</strong>
        <code title={agent.path}>{agent.path || agent.command}</code>
        <small>{!agent.installed ? t('Not installed') : agent.chatSupported ? t('Installed · uses your local login and default model') : t('Installed · chat adapter coming soon')}</small>
        {contacts.length > 0 && <div className="local-agent-contacts">{contacts.map((contact) =>
          <button key={contact.id} onClick={() => onContact(contact.id)}>{contact.name}</button>
        )}</div>}
      </div>
      {agent.installed && <button className="secondary-button" disabled={!agent.chatSupported} onClick={() => onCreate(agent)}>{t('Create contact')}</button>}
    </article>
  }
  return <div className="modal-backdrop settings-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <aside className="settings-sidebar">
      <div className="settings-modal-title"><div id="settings-title" className="wordmark">{t('Settings')}</div></div>
      <div className="settings-tabs" role="tablist" aria-label={t('Settings')}>
        <button id="profile-tab" role="tab" aria-selected={tab === 'profile'} aria-controls="settings-content" className={tab === 'profile' ? 'active' : ''} onClick={() => onTab('profile')}><CircleUserRound size={18} /><span>{t('Account')}</span></button>
        <button id="general-tab" role="tab" aria-selected={tab === 'general'} aria-controls="settings-content" className={tab === 'general' ? 'active' : ''} onClick={() => onTab('general')}><SlidersHorizontal size={18} /><span>{t('General')}</span></button>
        <button id="agents-tab" role="tab" aria-selected={tab === 'agents'} aria-controls="settings-content" className={tab === 'agents' ? 'active' : ''} onClick={() => onTab('agents')}><Bot size={18} /><span>{t('Agents')}</span></button>
        <button id="models-tab" role="tab" aria-selected={tab === 'models'} aria-controls="settings-content" className={tab === 'models' ? 'active' : ''} onClick={() => onTab('models')}><PlugZap size={18} /><span>{t('Models')}</span></button>
      </div>
    </aside>
    <main id="settings-content" role="tabpanel" aria-labelledby={`${tab}-tab`} className="settings-content">
      <button autoFocus className="settings-close" onClick={onClose} aria-label={t('Close')} title={t('Close')}><X size={18} /></button>
      {tab === 'profile' ? (
        <ProfileTab user={user} signingOut={signingOut} signOutError={signOutError} onSignOut={() => void signOut()} onUpdateProfile={onUpdateProfile} />
      ) : tab === 'general' ? <>
        <header className="settings-heading"><div><h1>{t('General')}</h1><p>{t('Choose your language and appearance.')}</p></div></header>
        <div className="general-settings">
          <label><span>{t('Language')}</span><select value={preferences.language} onChange={(event) => setPreferences({ language: event.target.value as 'en' | 'zh-CN' })}><option value="en">English</option><option value="zh-CN">简体中文</option></select></label>
          <label><span>{t('Appearance')}</span><select value={preferences.appearance} onChange={(event) => setPreferences({ appearance: event.target.value as 'system' | 'light' | 'dark' })}><option value="system">{t('System')}</option><option value="light">{t('Light')}</option><option value="dark">{t('Dark')}</option></select></label>
          <label className="font-size-setting"><span>{t('Font size')}</span><div className="font-size-control">
            <input type="range" min="0" max="4" step="1" value={preferences.fontSize} aria-label={t('Font size')} aria-valuetext={`${[85, 92, 100, 110, 120][preferences.fontSize]}%`} onChange={(event) => setPreferences({ fontSize: Number(event.target.value) })} />
            <div className="font-size-labels"><span>{t('Small')}</span><button type="button" onClick={() => setPreferences({ fontSize: 1 })}>{t('Standard')}</button><span>{t('Large')}</span></div>
          </div></label>
          <div className="font-size-preview" aria-label={t('Font preview')}>{t('Messages and interface text update immediately.')}</div>
        </div>
      </> : tab === 'agents'  ? <>
        <header className="settings-heading"><div><h1>{t('Local agents')}</h1><p>{t('Connect the agents on this computer to your contacts.')}</p></div>
          <button className="secondary-button" disabled={scanning} onClick={onRefresh}><RefreshCw size={15} />{scanning ? t('Scanning…') : t('Refresh')}</button>
        </header>
        <p className="settings-note">{t('Each contact has its own name, instructions and conversation history. Local agents use their existing login and model settings.')}</p>
        {error && <p className="settings-error" role="alert">{error}</p>}
        <section aria-label="Installed agents"><h2>{t('Installed')} <span>{installed.length}</span></h2>
          {installed.map(row)}
          {!installed.length && <p className="settings-note">{scanning ? t('Checking your shell and installed commands…') : t('No supported agent commands found. Install an agent in your terminal, then refresh.')}</p>}
        </section>
        {missing.length > 0 && <section aria-label="Not installed agents"><h2>{t('Not installed')} <span>{missing.length}</span></h2>{missing.map(row)}</section>}
      </> : <>
        <header className="settings-heading"><div><h1>{t('Models')}</h1><p>{t('Cloud models are provided by your Douchat account.')}</p></div></header>
        <article className="local-agent-row"><PlugZap size={24} /><div className="local-agent-copy"><strong>{snapshot.runtime.mode === 'live' ? t('Douchat Cloud connected') : t('Douchat Cloud unavailable')}</strong><small>{snapshot.endpoint.baseUrl}</small><small>{t('Available cloud models').replace('{count}', String(snapshot.models.length))}</small>{snapshot.runtime.error && <small className="settings-error">{t(snapshot.runtime.error)}</small>}</div>{snapshot.endpoint.source !== 'account' && <button className="secondary-button" onClick={onEndpoint}>{t('Configure')}</button>}</article>
      </>}
    </main>
    </section>
  </div>
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
    {signOutError && <p className="settings-error" role="alert">{signOutError}</p>}
  </>
}
