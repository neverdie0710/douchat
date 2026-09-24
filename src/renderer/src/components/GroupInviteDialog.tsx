import { NativeDialog } from './NativeDialog'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Link, LoaderCircle, RefreshCw, X } from 'lucide-react'
import type { AgentConfig, Conversation } from '../../../shared/types'
import type { GroupInvite } from '../../../shared/social'
import { ConversationAvatar } from './common'
import { t, tr } from '../preferences'

export function GroupInviteDialog({ conversation, agents, userName, userAvatar, onClose }: {
  conversation: Conversation; agents: AgentConfig[]; userName: string; userAvatar: string; onClose: () => void
}): ReactElement {
  const [invite, setInvite] = useState<GroupInvite>()
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [expired, setExpired] = useState(false)
  const panel = useRef<HTMLElement>(null)
  const generation = useRef(0)
  const load = async (regenerate = false): Promise<void> => {
    const attempt = ++generation.current
    setBusy(true); setError(''); setStatus(''); setConfirmReset(false)
    // Never offer the previous link while rotating the invitation.
    if (regenerate) setInvite(undefined)
    try {
      const result = await window.douchat.socialAction({ action: 'group-invite', conversationId: conversation.id, regenerate })
      if (!result.invite) throw new Error(t('Could not create invitation'))
      if (attempt !== generation.current) return
      setInvite(result.invite); setExpired(result.invite.expiresAt !== null && Date.parse(result.invite.expiresAt) <= Date.now())
      if (regenerate) setStatus(t('Invitation link updated'))
    } catch (cause) {
      if (attempt === generation.current) setError(cause instanceof Error ? cause.message : t('Could not create invitation'))
    } finally { if (attempt === generation.current) setBusy(false) }
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus()
    void load()
    return () => { generation.current++; previous?.focus() }
  }, [conversation.id])
  useEffect(() => {
    if (!invite?.expiresAt) return
    const expiresAt = Date.parse(invite.expiresAt)
    let timer: number | undefined
    const checkExpiry = () => {
      const remaining = expiresAt - Date.now()
      if (remaining <= 0) setExpired(true)
      else timer = window.setTimeout(checkExpiry, Math.min(remaining, 2_147_483_647))
    }
    checkExpiry()
    return () => window.clearTimeout(timer)
  }, [invite])
  return <NativeDialog width={460} height={540} className="modal-backdrop group-invite-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose() }
    if (event.key === 'Tab') {
      const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input') ?? [])
      if (!nodes.length) return
      if (event.shiftKey && panel.current?.ownerDocument.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus() }
      else if (!event.shiftKey && panel.current?.ownerDocument.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus() }
    }
  }} onClose={onClose}>
    <section ref={panel} className="group-invite-dialog" role="dialog" aria-modal="true" aria-labelledby="group-invite-title">
      <button className="group-invite-close" onClick={onClose} aria-label={t('Close')}><X size={19} /></button>
      <ConversationAvatar conversation={conversation} agents={agents} userName={userName} userAvatar={userAvatar} size={64} />
      <h2 id="group-invite-title">{conversation.name}</h2>
      <p>{t('Share this link to invite people to the group')}</p>
      {busy && <LoaderCircle className="voice-spinner" size={20} aria-label={t('Loading…')} />}
      {expired && <p role="status">{t('Invitation expired')}</p>}
      {invite && <input aria-label={t('Invitation link')} value={invite.url} readOnly onFocus={(event) => event.currentTarget.select()} />}
      <div className="group-invite-actions">
        <button disabled={!invite || busy || expired} onClick={() => { setError(''); void window.douchat.copyText(invite!.url).then(() => setStatus(t('Copied'))).catch(() => setError(t('Could not copy message'))) }}><Link size={16} />{status === t('Copied') ? t('Copied') : t('Copy link')}</button>
        {confirmReset && <button disabled={busy} onClick={() => setConfirmReset(false)}>{t('Cancel')}</button>}
        <button className="group-invite-refresh" disabled={busy} onClick={() => {
          if (confirmReset) void load(true)
          else if (invite) { setStatus(''); setError(''); setConfirmReset(true) }
          else void load()
        }}><RefreshCw size={14} />{t(confirmReset ? 'Confirm regeneration' : invite ? 'Regenerate invitation' : 'Retry')}</button>
      </div>
      {invite && <p className="group-invite-expiry">{invite.expiresAt === null ? t('Never expires') : tr('Valid until {date}', { date: new Date(invite.expiresAt).toLocaleString() })}</p>}
      <div className="group-invite-feedback" aria-live="polite">
        {confirmReset && <p>{t('The old invitation link will stop working.')}</p>}
        {error && <p className="group-invite-error" role="alert">{t(error)}</p>}
        {status && status !== t('Copied') && <p role="status">{status}</p>}
      </div>
    </section>
  </NativeDialog>
}
