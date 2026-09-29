import { Globe, LoaderCircle, Maximize2, Minus, X } from 'lucide-react'
import type { ReactElement } from 'react'
import type { DesktopAuthState } from '../../../shared/types'
import logo from '../../../../resources/icons/douchat.png'
import { setPreferences, t, usePreferences, type LanguagePreference } from '../preferences'

function WindowControls(): ReactElement | null {
  if (window.douchat.platform !== 'darwin') return null
  return <div className="window-controls login-window-controls no-drag" role="group" aria-label={t('Window controls')}>
    <button className="window-control close" title={t('Close window')} aria-label={t('Close window')} onClick={() => window.douchat.windowAction('close')}><X size={8} strokeWidth={2} /></button>
    <button className="window-control minimize" title={t('Minimize window')} aria-label={t('Minimize window')} onClick={() => window.douchat.windowAction('minimize')}><Minus size={8} strokeWidth={2} /></button>
    <button className="window-control fullscreen" title={t('Toggle full screen')} aria-label={t('Toggle full screen')} onClick={() => window.douchat.windowAction('fullscreen')}><Maximize2 size={7} strokeWidth={2} /></button>
  </div>
}

function LanguageSwitch(): ReactElement {
  const { language } = usePreferences()
  return <label className="login-language no-drag">
    <Globe size={15} aria-hidden="true" />
    <select aria-label={t('Language')} value={language} onChange={(event) => setPreferences({ language: event.target.value as LanguagePreference })}>
      <option value="system">{t('Follow system')}</option>
      <option value="en">English</option>
      <option value="zh-CN">简体中文</option>
    </select>
  </label>
}

export function LoginScreen({ state, onLogin, onCancel }: { state: DesktopAuthState; onLogin: () => void; onCancel: () => void }): ReactElement {
  usePreferences()
  const waiting = state.status === 'waiting'
  const error = state.status === 'error' ? state.error : ''

  return <main className="login-screen window-drag">
    <WindowControls />
    <LanguageSwitch />
    <section className="login-card no-drag" aria-labelledby="login-title">
      <img className="login-logo" src={logo} alt="" />
      <h1 id="login-title">{t('Sign in to Douchat')}</h1>
      <p className={`login-positioning ${error ? 'has-error' : ''}`} role={error ? 'alert' : 'status'}>
        {error ? `${t('Login could not be completed')}: ${t(error)}` : t(waiting ? 'Finish signing in in your browser. Douchat will return automatically.' : 'Continue in your browser to securely sign in and get started.')}
      </p>
      <button type="button" className="login-primary" disabled={waiting} onClick={onLogin}>
        {waiting && <LoaderCircle className="login-spinner" size={17} />}
        <span>{t(waiting ? 'Continue in your browser' : 'Get started')}</span>
      </button>
      {waiting && <div className="login-secondary">
        <button type="button" className="login-reopen" onClick={onLogin}>{t('Reopen browser')}</button>
        <span aria-hidden="true">•</span>
        <button type="button" onClick={onCancel}>{t('Cancel')}</button>
      </div>}
    </section>
  </main>
}
