import { t } from '../preferences'
import { Settings, UsersRound, MessageCircle, X, Minus, Maximize2 } from 'lucide-react'
import type { ReactElement } from 'react'
import { UserAvatar } from './common'

export type AppView = 'chats' | 'contacts'

export function AppRail({
  view,
  unread,
  userName,
  userAvatar,
  settingsOpen,
  onSelect,
  onOpenSettings
}: {
  view: AppView
  unread: number
  userName: string
  userAvatar: string
  settingsOpen: boolean
  onSelect: (view: AppView) => void
  onOpenSettings: (profile?: boolean) => void
}): ReactElement {
  return (
    <nav className="app-rail window-drag" aria-label="Sections">
      {window.douchat.platform === 'darwin' && <div className="window-controls no-drag" role="group" aria-label="Window controls">
        <button className="window-control close" title="Close window" aria-label="Close window" onClick={() => window.douchat.windowAction('close')}><X size={8} strokeWidth={2} /></button>
        <button className="window-control minimize" title="Minimize window" aria-label="Minimize window" onClick={() => window.douchat.windowAction('minimize')}><Minus size={8} strokeWidth={2} /></button>
        <button className="window-control fullscreen" title="Toggle full screen" aria-label="Toggle full screen" onClick={() => window.douchat.windowAction('fullscreen')}><Maximize2 size={7} strokeWidth={2} /></button>
      </div>}
      <button className="rail-profile no-drag" onClick={() => onOpenSettings(true)} title={userName} aria-label={`${userName} — open your profile`}>
        <UserAvatar src={userAvatar} name={userName} size={34} />
      </button>
      <button
        className={`rail-button no-drag ${view === 'chats' ? 'active' : ''}`}
        onClick={() => onSelect('chats')}
        aria-label={t('Chats')}
        aria-current={view === 'chats'}
        title={t('Chats')}
      >
        <MessageCircle size={23} strokeWidth={1.8} />
        {unread > 0 && <span className="rail-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      <button
        className={`rail-button no-drag ${view === 'contacts' ? 'active' : ''}`}
        onClick={() => onSelect('contacts')}
        aria-label={t('Contacts')}
        aria-current={view === 'contacts'}
        title={t('Contacts')}
      >
        <UsersRound size={23} strokeWidth={1.8} />
      </button>
      <div className="rail-spacer" />
      <button className={`rail-button no-drag ${settingsOpen ? 'active' : ''}`} onClick={() => onOpenSettings()} aria-label={t('Settings')} title={t('Settings')} aria-current={settingsOpen}><Settings size={23} strokeWidth={1.8} /></button>
    </nav>
  )
}
