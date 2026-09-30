import { Monitor, Server, UserRound } from 'lucide-react'
import { t } from '../preferences'

export function ContactKindBadge({ human, local, remote }: { human?: boolean; local?: boolean; remote?: string }) {
  if (!human && !local) return null
  const label = human ? t('Douchat user') : remote ? `${t('Remote')} · ${remote}` : t('Local')
  const Icon = human ? UserRound : remote ? Server : Monitor
  return <span className={`contact-kind-badge${remote ? ' remote' : ''}`} title={label} aria-label={label}><Icon size={12} strokeWidth={1.6} /></span>
}
