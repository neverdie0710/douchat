import { invitationSvgSource } from './InvitationAvatar'
import { QRCodeSVG } from 'qrcode.react'
import { NativeDialog } from './NativeDialog'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Link, LoaderCircle, RefreshCw, Download, Copy, MessageSquare, UsersRound, X } from 'lucide-react'
import type { AgentConfig, Conversation } from '../../../shared/types'
import type { GroupInvite } from '../../../shared/social'
import { t, tr } from '../preferences'

export function GroupInviteDialog({ conversation, agents, userName, userAvatar, onClose }: {
  conversation: Conversation; agents: AgentConfig[]; userName: string; userAvatar: string; onClose: () => void
}): ReactElement {
  const theme = { background: '#f8faff', ink: '#172b4d', header: '#0b5cff', brand: '#ffffff' }
  const memberCount = conversation.socialRoom ? conversation.socialRoom.members.length + conversation.socialRoom.agents.length : (conversation.agentIds?.length ?? agents.length) + 1
  const [invite, setInvite] = useState<GroupInvite>()
  const [saving, setSaving] = useState(false)
  const qr = useRef<HTMLDivElement>(null)
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
  const saveCard = async (action: 'save' | 'copy'): Promise<void> => {
    const svg = qr.current?.querySelector('svg')
    if (!svg || !invite || busy || expired) return
    setSaving(true); setError(''); setStatus('')
    const attempt = generation.current
    // The renderer CSP allows data: images, but deliberately disallows blob: URLs.
    try {
      const source = await invitationSvgSource(svg)
      const image = new Image()
      image.src = source
      await image.decode()
      if (attempt !== generation.current) return
      const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 1180
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error(t('Could not save invitation image'))
      ctx.drawImage(image, 0, 0, 720, 1180)
      if (attempt !== generation.current || (invite.expiresAt !== null && Date.parse(invite.expiresAt) <= Date.now())) return
      if (action === 'copy') { await window.douchat.copyInvitationImage(canvas.toDataURL('image/png')); setStatus(t('Poster copied. Paste it into your chat.')) }
      else if (await window.douchat.saveInvitationImage(canvas.toDataURL('image/png'))) setStatus(t('Image saved'))
    } catch { setError(t(action === 'copy' ? 'Image could not be copied' : 'Could not save invitation image')) }
    finally { setSaving(false) }
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
  return <NativeDialog width={520} height={820} className="modal-backdrop group-invite-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose() }
    if (event.key === 'Tab') {
      const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, summary') ?? []).filter(node => node.tagName === 'SUMMARY' || !node.closest('details:not([open])'))
      if (!nodes.length) return
      if (event.shiftKey && panel.current?.ownerDocument.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus() }
      else if (!event.shiftKey && panel.current?.ownerDocument.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus() }
    }
  }} onClose={onClose}>
    <section ref={panel} className="group-invite-dialog group-invite-redesign" role="dialog" aria-modal="true" aria-labelledby="group-invite-title">
      <button className="group-invite-close" onClick={onClose} aria-label={t('Close')}><X size={19} /></button>
      <header className="group-invite-heading">
        <h2 id="group-invite-title">{t('Invite friends')}</h2>
        <p>{t('Copy a card and share it with friends')}</p>
      </header>
      <div className="group-invite-stage">
      {invite && !busy && !expired && <div className="group-invite-poster" ref={qr}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 1180" width="720" height="1180" role="img" aria-label={t('Group invitation poster')}>
          <rect width="720" height="1180" fill={theme.background} />
          <path d="M0 0H720V464Q360 544 0 464Z" fill={theme.header} />
          <g fill={theme.brand} opacity=".1">
            <rect x="58" y="198" width="114" height="72" rx="24" />
            <rect x="552" y="338" width="110" height="72" rx="24" />
            <path d="M144 250v38l-30-28M578 390v38l28-28" />
          </g>
          <g fontFamily="Arial, PingFang SC, Microsoft YaHei, sans-serif" textAnchor="middle" fill={theme.ink}>
            <text x="360" y="190" fill={theme.brand} fontSize="38" fontWeight="750">Douchat</text>
            <text x="360" y="607" fontSize="52" fontWeight="700" textLength={Array.from(conversation.name).length > 16 ? 590 : undefined} lengthAdjust="spacingAndGlyphs">{Array.from(conversation.name).slice(0, 28).join('')}{Array.from(conversation.name).length > 28 ? '…' : ''}</text>
            <text x="360" y="664" fontSize="27" textLength={userName.length > 16 ? 570 : undefined} lengthAdjust="spacingAndGlyphs">{tr('{name} invites you to the group', { name: Array.from(userName || t('A friend')).slice(0, 24).join('') })}</text>
            <text x="360" y="710" fontSize="25">{tr('{count} members', { count: memberCount })}</text>
            <text x="360" y="1015" fontSize="25">{t('Scan to view the invitation')}</text>
            <text x="360" y="1090" fontSize="21">{t('Join from your computer')} · douchat.ai</text>
          </g>
          <g data-invitation-avatar="default">
            <rect x="252" y="250" width="216" height="216" rx="56" fill="#ffffff" />
            <UsersRound x={294} y={292} width={132} height={132} color={theme.header} strokeWidth={1.7} />
          </g>
          <QRCodeSVG value={invite.url} x={245} y={747} size={230} level="M" marginSize={4} title={t('Invitation QR code')} />
        </svg>
      </div>}
      {busy && <LoaderCircle className="voice-spinner" size={24} aria-label={t('Loading…')} />}
      {expired && <p role="status">{t('Invitation expired')}</p>}
      </div>
      {invite && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(invite.url).hostname) && <p className="group-invite-note">{t('This local invitation cannot be opened on other devices.')}</p>}
      <div className="group-invite-primary">
        <button className="group-invite-copy-card" disabled={!invite || busy || expired || saving} onClick={() => void saveCard('copy')}>
          {saving ? <LoaderCircle className="voice-spinner" size={18} /> : <Copy size={18} />}{t('Copy invite card')}
        </button>
        <button className="group-invite-copy-link" aria-label={t('Copy link')} title={t('Copy link')} disabled={!invite || busy || expired} onClick={() => { setError(''); void window.douchat.copyText(invite!.url).then(() => setStatus(t('Copied'))).catch(() => setError(t('Could not copy message'))) }}><Link size={20} /></button>
      </div>
      <details className="group-invite-more"><summary>{t('More sharing options')}</summary>
      {invite && <input aria-label={t('Invitation link')} value={invite.url} readOnly onFocus={(event) => event.currentTarget.select()} />}
      <div className="group-invite-actions">
        <button disabled={!invite || busy || expired || saving} onClick={() => {
          if (!invite) return
          const text = `${tr('Join me in “{name}” on Douchat.', { name: conversation.name })}\n${t('People and AI agents, together in one chat.')}\n\n${t('Open this invitation on your computer:')}\n${invite.url}\n\n${t('Download the desktop app:')} https://douchat.ai\n${t('Desktop app required · macOS / Windows / Linux')}`
          setError(''); void window.douchat.copyText(text).then(() => setStatus(t('Invitation text copied'))).catch(() => setError(t('Could not copy message')))
        }}><MessageSquare size={16} />{t('Copy invitation text')}</button>
        <button disabled={!invite || busy || expired || saving} onClick={() => void saveCard('save')}><Download size={16} />{t('Save poster')}</button>
        {confirmReset && <button disabled={busy || saving} onClick={() => setConfirmReset(false)}>{t('Cancel')}</button>}
        <button className="group-invite-refresh" disabled={busy || saving} onClick={() => {
          if (confirmReset) void load(true)
          else if (invite) { setStatus(''); setError(''); setConfirmReset(true) }
          else void load()
        }}><RefreshCw size={14} />{t(confirmReset ? 'Confirm regeneration' : invite ? 'Regenerate invitation' : 'Retry')}</button>
      </div>
      </details>
      <div className="group-invite-feedback" aria-live="polite">
        {confirmReset && <p>{t('The old invitation link will stop working.')}</p>}
        {error && <p className="group-invite-error" role="alert">{t(error)}</p>}
        {status && <p role="status">{status}</p>}
      </div>
    </section>
  </NativeDialog>
}
