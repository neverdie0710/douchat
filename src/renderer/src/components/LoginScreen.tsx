import { ArrowUpRight, Check, LoaderCircle, Maximize2, Minus, ShieldCheck, X } from 'lucide-react'
import type { ReactElement } from 'react'
import type { DesktopAuthState } from '../../../shared/types'
import logo from '../assets/douchat.svg'
import { t } from '../preferences'

function WindowControls(): ReactElement | null {
  if (window.douchat.platform !== 'darwin') return null
  return <div className="window-controls login-window-controls no-drag" role="group" aria-label={t('Window controls')}>
    <button className="window-control close" title={t('Close window')} aria-label={t('Close window')} onClick={() => window.douchat.windowAction('close')}><X size={8} strokeWidth={2} /></button>
    <button className="window-control minimize" title={t('Minimize window')} aria-label={t('Minimize window')} onClick={() => window.douchat.windowAction('minimize')}><Minus size={8} strokeWidth={2} /></button>
    <button className="window-control fullscreen" title={t('Toggle full screen')} aria-label={t('Toggle full screen')} onClick={() => window.douchat.windowAction('fullscreen')}><Maximize2 size={7} strokeWidth={2} /></button>
  </div>
}

export function LoginScreen({ state, onLogin }: { state: DesktopAuthState; onLogin: () => void }): ReactElement {
  const waiting = state.status === 'waiting'
  const error = state.status === 'error' ? state.error : ''

  return <main className="login-screen window-drag">
    <WindowControls />
    <section className="login-card no-drag" aria-labelledby="login-title">
      <div className="login-brand">
        <img src={logo} alt="" />
        <span>DOUCHAT</span>
      </div>
      <div className="login-heading">
        <p>{t('Meet Douchat')}</p>
        <h1 id="login-title">{t('Your smartest collaboration partner.')}</h1>
      </div>

      <div className="login-action-panel">
        <button type="button" className="login-primary" onClick={onLogin}>
          {waiting ? <LoaderCircle className="login-spinner" size={20} /> : <ArrowUpRight size={20} />}
          <span>{t(waiting ? 'Open login page again' : 'Continue in browser')}</span>
        </button>

        <div className={`login-status ${error ? 'has-error' : ''}`} role={error ? 'alert' : 'status'}>
          <span>{waiting ? <LoaderCircle className="login-spinner" size={18} /> : error ? <X size={18} /> : <Check size={18} />}</span>
          <div>
            <strong>{error ? t('Login could not be completed') : waiting ? t('Waiting for browser login…') : t('Secure browser login')}</strong>
            <small>{error ? t(error) : t(waiting ? 'Finish signing in in your browser. Douchat will return automatically.' : 'Your password stays in the browser. Douchat only receives a one-time authorization code.')}</small>
          </div>
        </div>
      </div>

      <footer className="login-footnote"><ShieldCheck size={15} />{t('Encrypted session storage on this device')}</footer>
    </section>
  </main>
}
