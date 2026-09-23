import { Bot, Camera, RefreshCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { CustomLocalAgentInput, LocalAgent } from '../../../shared/types'
import { agentIcons } from '../agentIcons'
import { readAvatarFile } from '../avatarFile'
import { messageSendError } from '../messageQueue'
import { t } from '../preferences'
import { NativeDialog } from './NativeDialog'

export function LocalAgentEditor({ agent, onSaved, onClose }: {
  agent?: LocalAgent
  onSaved: (agents: LocalAgent[]) => void
  onClose: () => void
}) {
  const [name, setName] = useState(agent?.name ?? '')
  const [command, setCommand] = useState(agent?.path || agent?.command || '')
  const [args, setArgs] = useState((agent?.args ?? []).join('\n'))
  const [avatar, setAvatar] = useState(agent?.avatar ?? '')
  const [busy, setBusy] = useState<'test' | 'save' | 'avatar' | ''>('')
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const testing = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (testing.current) void window.douchat.cancelLocalAgentTest().catch(() => {})
    }
  }, [])
  const draft = (): CustomLocalAgentInput => ({ name, command, avatar, args: args.split(/\r?\n/).filter(arg => arg.length > 0) })
  const changed = () => { setResult(''); setError('') }
  const test = async () => {
    setBusy('test'); setError(''); setResult(''); testing.current = true
    try {
      const response = await window.douchat.testLocalAgent(agent?.id, draft())
      if (mounted.current) {
        const version = response.version?.match(/v?\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?/)?.[0] ?? response.version
        setResult(`${t('Connected')} · ${(response.durationMs / 1000).toFixed(1)}s${version ? ` · ${version}` : ''}`)
      }
    } catch (cause) { if (mounted.current) setError(messageSendError(cause)) }
    finally { testing.current = false; if (mounted.current) setBusy('') }
  }
  const save = async () => {
    setBusy('save'); setError('')
    try {
      const agents = agent ? await window.douchat.updateLocalAgent(agent.id, draft()) : await window.douchat.addCustomLocalAgent(draft())
      onSaved(agents)
      if (mounted.current) onClose()
    } catch (cause) { if (mounted.current) { setError(messageSendError(cause)); setBusy('') } }
  }
  const icon = avatar || (agent && agentIcons[agent.id])
  return <NativeDialog className="modal-backdrop" onClose={onClose} width={540}>
    <form className="local-agent-editor" role="dialog" aria-modal="true" aria-labelledby="local-agent-editor-title" onSubmit={event => { event.preventDefault(); if (!busy) void save() }}>
      <header><h2 id="local-agent-editor-title">{t(agent ? 'Edit local agent' : 'Add local agent')}</h2><button type="button" className="icon-button" aria-label={t('Close')} onClick={onClose}><X size={18} /></button></header>
      <fieldset disabled={Boolean(busy)}>
        <div className="local-agent-editor-avatar">
          <button type="button" className="local-agent-picture" aria-label={t('Choose picture')} onClick={() => file.current?.click()}>{icon ? <img src={icon} alt="" /> : <Bot size={30} />}<Camera size={14} /></button>
          <button type="button" className="secondary-button" onClick={() => file.current?.click()}>{t('Choose picture')}</button>
          {avatar && <button type="button" className="local-settings-link" onClick={() => { setAvatar(''); changed() }}>{t('Remove picture')}</button>}
          <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={async event => {
            const selected = event.target.files?.[0]; event.target.value = ''
            if (!selected) return
            setBusy('avatar'); changed()
            try { const image = await readAvatarFile(selected); if (mounted.current) setAvatar(image) }
            catch (cause) { if (mounted.current) setError(messageSendError(cause)) }
            finally { if (mounted.current) setBusy('') }
          }} />
        </div>
        <label>{t('Name')}<input autoFocus required maxLength={80} value={name} onChange={event => { setName(event.target.value); changed() }} /></label>
        <label>{t('Executable path')}<input required maxLength={2048} value={command} placeholder={agent?.path || '/path/to/agent'} spellCheck={false} onChange={event => { setCommand(event.target.value); changed() }} /></label>
        <label>{t('Startup arguments')}<textarea value={args} rows={4} spellCheck={false} placeholder={'--model\nmy-model'} onChange={event => { setArgs(event.target.value); changed() }} /></label>
        <p className="settings-note">{t(agent && !agent.custom ? 'One argument per line. Added to the built-in launch arguments.' : 'One argument per line. Use {prompt} for the message; otherwise it is appended as the last argument.')}</p>
      </fieldset>
      {error && <p className="settings-error" role="alert">{t(error)}</p>}
      {result && <p className="local-agent-test-result" role="status">{result}</p>}
      <p className="settings-note">{t('Testing sends a short request using this CLI’s account and may use its quota.')}</p>
      <footer>
        <button type="button" className="secondary-button" disabled={Boolean(busy) || !name.trim() || !command.trim()} onClick={() => void test()}>{busy === 'test' && <RefreshCw size={15} className="spin" />}{t(busy === 'test' ? 'Testing…' : 'Test connection')}</button>
        <span />
        <button type="button" className="secondary-button" onClick={onClose}>{t('Cancel')}</button>
        <button type="submit" className="primary-button" disabled={Boolean(busy) || !name.trim() || !command.trim()}>{t(busy === 'save' ? 'Saving…' : 'Save')}</button>
      </footer>
    </form>
  </NativeDialog>
}
