import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { UserMemoryPanel } from './UserMemoryPanel'
import { resolveInterfaceLanguage, usePreferences, t } from '../preferences'
import './AgentSettingsDialog.css'

export function GroupMemoryDialog({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const preferences = usePreferences()
  useEffect(() => {
    const element = dialog.current!
    const focused = document.activeElement as HTMLElement | null
    element.showModal()
    return () => { element.close(); focused?.focus() }
  }, [])
  const close = () => {
    if (busy) return
    if (dirty && !window.confirm(resolveInterfaceLanguage(preferences.language) === 'zh-CN' ? '放弃尚未保存的修改？' : 'Discard unsaved changes?')) return
    onClose()
  }
  return <dialog ref={dialog} className="agent-settings-dialog group-memory-dialog messenger" aria-label={t('Group memory')} onCancel={event => { event.preventDefault(); close() }} onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className="settings-modal group-memory-layout"><div className="settings-content agent-settings-content">
      <button className="settings-close agent-settings-close" aria-label={t('Close')} disabled={busy} onClick={close}><X size={18} /></button>
      <UserMemoryPanel conversationId={conversationId} onDirty={() => setDirty(true)} onSaved={() => setDirty(false)} onBusyChange={setBusy} />
    </div></div>
  </dialog>
}
