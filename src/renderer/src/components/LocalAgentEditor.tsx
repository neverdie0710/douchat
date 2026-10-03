import { Bot, Camera, RefreshCw, X } from 'lucide-react'

const MANUAL_HOST = '\u0000manual'
import { useEffect, useRef, useState } from 'react'
import { REMOTE_AGENT_ADAPTERS, type CustomLocalAgentInput, type LocalAgent, type RemoteAgentAdapter, type RemoteAgentSpec } from '../../../shared/types'
import { agentIcons } from '../agentIcons'
import { readAvatarFile } from '../avatarFile'
import { messageSendError } from '../messageQueue'
import { t } from '../preferences'
import { NativeDialog } from './NativeDialog'

const ADAPTER_LABELS: Record<RemoteAgentAdapter, string> = {
  codex: 'Codex', claude: 'Claude Code', gemini: 'Gemini', grok: 'Grok Build', cursor: 'Cursor', opencode: 'OpenCode',
  kimi: 'Kimi', openclaw: 'OpenClaw', fastclaw: 'FastClaw', hermes: 'Hermes', omp: 'OMP', custom: 'Custom CLI'
}
const DEFAULT_COMMANDS: Record<RemoteAgentAdapter, string> = {
  codex: 'codex', claude: 'claude', gemini: 'gemini', grok: 'grok', cursor: 'cursor-agent', opencode: 'opencode',
  kimi: 'kimi', openclaw: 'openclaw', fastclaw: 'fastclaw', hermes: 'hermes', omp: 'omp', custom: ''
}

export function LocalAgentEditor({ agent, onSaved, onClose }: {
  agent?: LocalAgent
  onSaved: (agents: LocalAgent[]) => void
  onClose: () => void
}) {
  const [name, setName] = useState(agent?.name ?? '')
  const [command, setCommand] = useState(agent?.path || agent?.command || '')
  const [args, setArgs] = useState((agent?.remote?.args ?? agent?.args ?? []).join('\n'))
  const [avatar, setAvatar] = useState(agent?.avatar ?? '')
  // The run location is fixed once saved; only new custom agents can choose it.
  const [location, setLocation] = useState<'local' | 'remote'>(agent?.remote ? 'remote' : 'local')
  const [adapter, setAdapter] = useState<RemoteAgentAdapter>(agent?.remote?.adapter ?? 'codex')
  const [host, setHost] = useState(agent?.remote?.host ?? '')
  const [hosts, setHosts] = useState<string[]>([])
  const [manualHost, setManualHost] = useState(false)
  const [advanced, setAdvanced] = useState(Boolean(agent?.remote && (agent.remote.args.length || agent.remote.executable !== DEFAULT_COMMANDS[agent.remote.adapter])))
  const [executable, setExecutable] = useState(agent?.remote?.executable ?? 'codex')
  const [allowSharing, setAllowSharing] = useState(agent?.remote?.allowSharing ?? false)
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
  useEffect(() => {
    if (typeof window.douchat.listSshHosts !== 'function') return
    void window.douchat.listSshHosts().then(list => {
      if (!mounted.current) return
      setHosts(list)
      const saved = agent?.remote?.host
      if (saved) { if (!list.includes(saved)) setManualHost(true) }
      else if (list.length) setHost(current => current || list[0])
      else setManualHost(true)
    }).catch(() => { if (mounted.current) setManualHost(true) })
  }, [])
  const remote = location === 'remote'
  const canChooseLocation = !agent
  const argumentList = () => args.split(/\r?\n/).filter(arg => arg.length > 0)
  // Port, user and key come from ~/.ssh/config, exactly like `ssh <host>` in Terminal.
  const remoteSpec = (): RemoteAgentSpec => ({
    transport: 'ssh', host: host.trim(), adapter, executable: executable.trim() || DEFAULT_COMMANDS[adapter], args: argumentList(), allowSharing
  })
  const draft = (): CustomLocalAgentInput => remote
    ? { name, command: remoteSpec().executable, avatar, args: [], remote: remoteSpec() }
    : { name, command, avatar, args: argumentList() }
  const changed = () => { setResult(''); setError('') }
  const ready = Boolean(name.trim()) && (remote ? Boolean(host.trim() && (executable.trim() || DEFAULT_COMMANDS[adapter])) : Boolean(command.trim()))
  const test = async () => {
    setBusy('test'); setError(''); setResult(''); testing.current = true
    try {
      const response = await window.douchat.testLocalAgent(agent?.id, draft())
      if (mounted.current) {
        const version = remote ? response.version : response.version?.match(/v?\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?/)?.[0] ?? response.version
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
  const toggleSharing = (checked: boolean) => {
    if (checked && !window.confirm(t('Friends and other agents will be able to run commands on your server through this agent. Allow sharing?'))) return
    setAllowSharing(checked); changed()
  }
  const icon = avatar || (agent && agentIcons[agent.remote?.adapter ?? agent.id]) || (remote ? agentIcons[adapter] : undefined)
  return <NativeDialog className="modal-backdrop" onClose={onClose} width={560}>
    <form className="local-agent-editor" role="dialog" aria-modal="true" aria-labelledby="local-agent-editor-title" onSubmit={event => { event.preventDefault(); if (!busy && ready) void save() }}>
      <header><h2 id="local-agent-editor-title">{t(agent ? (agent.remote ? 'Edit remote agent' : 'Edit agent') : 'Add agent')}</h2><button type="button" className="icon-button" aria-label={t('Close')} onClick={onClose}><X size={18} /></button></header>
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
        {canChooseLocation && <div className="local-agent-location" role="radiogroup" aria-label={t('Run location')}>
          <span>{t('Run location')}</span>
          <label><input type="radio" name="location" checked={!remote} onChange={() => { setLocation('local'); changed() }} />{t('This computer')}</label>
          <label><input type="radio" name="location" checked={remote} onChange={() => { setLocation('remote'); changed() }} />{t('Remote server (SSH)')}</label>
        </div>}
        {!remote && <>
          <label>{t('Executable path')}<input required maxLength={2048} value={command} placeholder={agent?.path || '/path/to/agent'} spellCheck={false} onChange={event => { setCommand(event.target.value); changed() }} /></label>
          <label>{t('Startup arguments')}<textarea value={args} rows={4} spellCheck={false} placeholder={'--model\nmy-model'} onChange={event => { setArgs(event.target.value); changed() }} /></label>
          <p className="settings-note">{t(agent && !agent.custom ? 'One argument per line. Added to the built-in launch arguments.' : 'One argument per line. Use {prompt} for the message; otherwise it is appended as the last argument.')}</p>
        </>}
        {remote && <>
          <label>{t('Server')}<select value={manualHost ? MANUAL_HOST : host} onChange={event => {
            if (event.target.value === MANUAL_HOST) { setManualHost(true); setHost('') } else { setManualHost(false); setHost(event.target.value) }
            changed()
          }}>
            {!hosts.length && !manualHost && <option value="">{t('No hosts in ~/.ssh/config')}</option>}
            {hosts.map(item => <option key={item} value={item}>{item}</option>)}
            <option value={MANUAL_HOST}>{t('Enter manually…')}</option>
          </select></label>
          {manualHost && <label>{t('Host alias or address')}<input required autoFocus maxLength={255} value={host} placeholder="dev-box" spellCheck={false} onChange={event => { setHost(event.target.value); changed() }} /></label>}
          <label>{t('Agent type')}<select value={adapter} onChange={event => {
            const next = event.target.value as RemoteAgentAdapter
            if (executable === DEFAULT_COMMANDS[adapter]) setExecutable(DEFAULT_COMMANDS[next])
            setAdapter(next); changed()
          }}>{REMOTE_AGENT_ADAPTERS.map(item => <option key={item} value={item}>{t(ADAPTER_LABELS[item])}</option>)}</select></label>
          <p className="settings-note">{t('Port, user and key come from your SSH config (~/.ssh/config). Each chat gets its own private folder on the server.')}</p>
          <button type="button" className="local-settings-link" aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}>{t(advanced ? 'Hide advanced settings' : 'Advanced settings')}</button>
          {advanced && <>
            <label>{t('Executable on the server')}<input maxLength={1024} value={executable} placeholder={DEFAULT_COMMANDS[adapter] || '/path/to/agent'} spellCheck={false} onChange={event => { setExecutable(event.target.value); changed() }} /></label>
            <label>{t('Startup arguments')}<textarea value={args} rows={3} spellCheck={false} placeholder={adapter === 'custom' ? '--message\n{prompt}' : '--profile\nwork'} onChange={event => { setArgs(event.target.value); changed() }} /></label>
            <p className="settings-note">{t(adapter === 'custom' ? 'One argument per line. Use {prompt} for the message; otherwise it is appended as the last argument.' : 'One argument per line. Added to the built-in launch arguments. Options that disable the sandbox or approvals are rejected.')}</p>
            <label className="local-agent-checkbox"><input type="checkbox" checked={allowSharing} onChange={event => toggleSharing(event.target.checked)} />{t('Allow friends and other agents to call this agent')}</label>
          </>}
          <p className="settings-note">{t('Uses the ssh client, keys and ssh-agent on this computer; passwords are not stored. Conversation context and attachments are sent to this server. Confirm the host key once in Terminal with ssh before testing.')}</p>
        </>}
      </fieldset>
      {error && <p className="settings-error" role="alert">{t(error)}</p>}
      {result && <p className="local-agent-test-result" role="status">{result}</p>}
      <p className="settings-note">{t('Testing sends a short request using this CLI’s account and may use its quota.')}</p>
      <footer>
        <button type="button" className="secondary-button" disabled={Boolean(busy) || !ready} onClick={() => void test()}>{busy === 'test' && <RefreshCw size={15} className="spin" />}{t(busy === 'test' ? 'Testing…' : 'Test connection')}</button>
        <span />
        <button type="button" className="secondary-button" onClick={onClose}>{t('Cancel')}</button>
        <button type="submit" className="primary-button" disabled={Boolean(busy) || !ready}>{t(busy === 'save' ? 'Saving…' : 'Save')}</button>
      </footer>
    </form>
  </NativeDialog>
}
