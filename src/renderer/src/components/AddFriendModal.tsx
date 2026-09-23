import { t } from '../preferences'
import { NativeDialog } from './NativeDialog'
import { useEffect, useRef, useState } from 'react'
import { Check, Search, UserPlus, X } from 'lucide-react'
import type { SocialResult } from '../../../shared/social'
import { resolveInterfaceLanguage, usePreferences } from '../preferences'
import { UserAvatar } from './common'

export function AddFriendModal({ onClose }: { onClose: () => void }) {
  const preferences = usePreferences()
  const zh = resolveInterfaceLanguage(preferences.language) === 'zh-CN'
  const l = (cn: string, en: string) => zh ? cn : en
  const input = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const sending = useRef(false)
  const [email, setEmail] = useState('')
  const [result, setResult] = useState<SocialResult>()
  const [busy, setBusy] = useState<'search' | 'request' | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    input.current?.focus()
    return () => { generation.current++ }
  }, [])
  function changeEmail(value: string) {
    generation.current++
    setEmail(value); setResult(undefined); setError(''); setBusy(null)
  }
  async function search() {
    const current = ++generation.current
    setBusy('search'); setError(''); setResult(undefined)
    try {
      const found = await window.douchat.socialAction({ action: 'lookup', email: email.trim() })
      if (generation.current === current) setResult(found)
    } catch (cause) { if (generation.current === current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (generation.current === current) setBusy(null) }
  }
  async function request() {
    if (!result?.person || sending.current) return
    const current = generation.current
    sending.current = true
    setBusy('request'); setError('')
    try {
      if (result.relationship === 'incoming' && result.friendshipId) {
        await window.douchat.socialAction({ action: 'respond', id: result.friendshipId, accept: true })
      } else {
        await window.douchat.socialAction({ action: 'request', email: result.person.email })
      }
      if (generation.current === current) setResult({ ...result, relationship: result.relationship === 'incoming' ? 'accepted' : 'outgoing' })
    } catch (cause) { if (generation.current === current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { sending.current = false; if (generation.current === current) setBusy(null) }
  }
  const state = result?.relationship ?? 'none'
  const labels = {
    none: l('申请加好友', 'Send friend request'),
    outgoing: l('申请已发送', 'Request sent'),
    incoming: l('接受好友申请', 'Accept friend request'),
    accepted: l('已是好友', 'Already friends'),
    self: l('这是你自己', 'This is you')
  }
  return <NativeDialog onClose={onClose} width={560} height={560}><div role="dialog" className="conversation-records-modal routine-records-modal add-friend-modal" aria-labelledby="add-friend-title" onClick={(e) => { if (e.target === e.currentTarget) { const bounds = e.currentTarget.getBoundingClientRect(); if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) onClose() } }}>
    <header className="records-header"><div className="records-title-spacer" /><div><h1 id="add-friend-title">{l('添加朋友', 'Add friend')}</h1></div><button type="button" aria-label={l('关闭', 'Close')} onClick={onClose}><X size={18} /></button></header>
    <form className="friend-search-form" onSubmit={(e) => { e.preventDefault(); void search() }}>
      <div className="friend-search-input"><Search size={16} /><input ref={input} autoFocus type="email" autoComplete="off" required maxLength={254} aria-label={l('朋友的邮箱', 'Friend’s email')} placeholder={l('输入朋友的邮箱', 'Enter your friend’s email')} value={email} disabled={busy === 'request'} onChange={(e) => changeEmail(e.target.value)} />{email && <button type="button" disabled={busy === 'request'} aria-label={l('清空邮箱', 'Clear email')} onClick={() => { changeEmail(''); input.current?.focus() }}><X size={15} /></button>}</div>
      <button className="primary-button" disabled={Boolean(busy) || !email.trim()}>{busy === 'search' ? l('搜索中…', 'Searching…') : l('搜索', 'Search')}</button>
    </form>
    {error && <p className="records-error" role="alert">{t(error)}</p>}
    <div className="records-list friend-search-content" aria-live="polite">
      {result?.person ? <section className="friend-search-result">
        <div className="friend-result-person"><UserAvatar name={result.person.name} src={result.person.image || ''} size={48} /><div><h3>{result.person.name}</h3><p>{result.person.email}</p></div></div>
        <div className="friend-result-action"><button className="primary-button" disabled={Boolean(busy) || !['none', 'incoming'].includes(state)} onClick={() => void request()}>{state === 'accepted' || state === 'outgoing' ? <Check size={17} /> : <UserPlus size={17} />}{busy === 'request' ? l('处理中…', 'Sending…') : labels[state]}</button>{state === 'outgoing' && <p>{l('等待对方接受申请后，即可开始聊天。', 'You can chat once your friend accepts.')}</p>}</div>
      </section> : <div className="records-empty friend-search-empty"><Search size={30} /><p>{result ? l('没有找到该邮箱对应的 Douchat 用户。', 'No Douchat user found with this email.') : l('通过注册邮箱查找朋友，确认信息后发送申请。', 'Find your friend by their registered email, then send a request.')}</p></div>}
    </div>
  </div></NativeDialog>
}
