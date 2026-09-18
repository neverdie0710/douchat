import { useMemo, useState, type ReactElement } from 'react'
import { ArrowLeft, Check, CheckCircle2, ChevronRight, CircleAlert, Mail, Server, ShieldCheck, Unplug } from 'lucide-react'
import type { AppSnapshot, EmailConnectionTestResult, EmailConnectorAccount, EmailConnectorInput } from '../../../shared/types'
import { t } from '../preferences'
import { agentDisplayName } from './common'

const feishuPreset = {
  imapHost: 'imap.feishu.cn', imapPort: 993, imapSecure: true,
  smtpHost: 'smtp.feishu.cn', smtpPort: 465, smtpSecure: true
}

function initial(account?: EmailConnectorAccount): EmailConnectorInput {
  return account ? {
    id: account.id,
    name: account.name,
    email: account.email,
    username: account.username,
    password: '',
    imapHost: account.imapHost,
    imapPort: account.imapPort,
    imapSecure: account.imapSecure,
    smtpHost: account.smtpHost,
    smtpPort: account.smtpPort,
    smtpSecure: account.smtpSecure,
    agentIds: account.agentIds
  } : {
    name: t('Work email'), email: '', username: '', password: '',
    ...feishuPreset, agentIds: []
  }
}

export function ConnectorsPanel({ snapshot }: { snapshot: AppSnapshot }): ReactElement {
  const [editing, setEditing] = useState<EmailConnectorAccount | 'new'>()
  const accounts = snapshot.connectors.filter((connector) => connector.kind === 'email')
  if (editing) {
    return <EmailConnectorForm
      key={editing === 'new' ? 'new' : editing.id}
      snapshot={snapshot}
      account={editing === 'new' ? undefined : editing}
      onBack={() => setEditing(undefined)}
    />
  }
  return <>
    <header className="settings-heading connector-heading">
      <div><h1>{t('Connectors')}</h1><p>{t('Connect accounts and let selected agents use their data and actions.')}</p></div>
    </header>
    {accounts.length > 0 && <section className="connector-section" aria-label={t('Connected accounts')}>
      <div className="connector-section-title"><h2>{t('Connected accounts')}</h2><span>{accounts.length}</span></div>
      <div className="connector-account-list">
        {accounts.map((account) => <button type="button" className="connector-account-row" key={account.id} onClick={() => setEditing(account)}>
          <span className="connector-logo email"><Mail size={22} strokeWidth={1.8} /></span>
          <span className="connector-account-copy"><strong>{account.name}</strong><small>{account.email} · {account.agentIds.length ? t('{count} agents enabled').replace('{count}', String(account.agentIds.length)) : t('No agents enabled')}</small></span>
          <span className="connector-status connected"><CheckCircle2 size={15} />{t('Connected')}</span>
          <ChevronRight size={17} aria-hidden="true" />
        </button>)}
      </div>
    </section>}
    <section className="connector-section" aria-label={t('Available connectors')}>
      <div className="connector-section-title"><h2>{t('Available connectors')}</h2><span>{t('Built in')}</span></div>
      <article className="connector-catalog-card">
        <span className="connector-logo email"><Mail size={26} strokeWidth={1.7} /></span>
        <div><strong>{t('Email')}</strong><p>{t('Search, read, and summarize mail through IMAP. SMTP is verified for future sending support.')}</p><small><ShieldCheck size={13} />{t('Credentials stay encrypted on this computer')}</small></div>
        <button className="primary-button" type="button" onClick={() => setEditing('new')}>{t('Connect')}</button>
      </article>
    </section>
    <p className="connector-footnote">{t('Connectors are managed here because they belong to your account. Each agent still needs separate access.')}</p>
  </>
}

function EmailConnectorForm({ snapshot, account, onBack }: { snapshot: AppSnapshot; account?: EmailConnectorAccount; onBack: () => void }): ReactElement {
  const [value, setValue] = useState(() => initial(account))
  const [preset, setPreset] = useState(() => account && account.imapHost !== feishuPreset.imapHost ? 'custom' : 'feishu')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<EmailConnectionTestResult>()
  const [error, setError] = useState('')
  const dirtyPasswordHint = Boolean(account && !value.password)
  const selectedAgents = useMemo(() => new Set(value.agentIds), [value.agentIds])
  const patch = <K extends keyof EmailConnectorInput>(key: K, next: EmailConnectorInput[K]): void => {
    setValue((current) => ({ ...current, [key]: next }))
    setResult(undefined)
    setError('')
  }
  const changePreset = (next: string): void => {
    setPreset(next)
    if (next === 'feishu') setValue((current) => ({ ...current, ...feishuPreset }))
    setResult(undefined)
  }
  const test = async (): Promise<EmailConnectionTestResult | undefined> => {
    setTesting(true); setError(''); setResult(undefined)
    try {
      const tested = await window.douchat.testEmailConnector(value)
      setResult(tested)
      return tested
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Connection test failed'))
      return undefined
    } finally { setTesting(false) }
  }
  const save = async (): Promise<void> => {
    setSaving(true); setError('')
    try {
      await window.douchat.saveEmailConnector(value)
      onBack()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Email connection could not be saved'))
    } finally { setSaving(false) }
  }
  const disconnect = async (): Promise<void> => {
    if (!account || !window.confirm(t('Disconnect this email account? Agents will immediately lose access.'))) return
    setSaving(true); setError('')
    try { await window.douchat.disconnectEmailConnector(account.id); onBack() }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('Email account could not be disconnected')); setSaving(false) }
  }
  const toggleAgent = (agentId: string): void => patch('agentIds', selectedAgents.has(agentId) ? value.agentIds.filter((id) => id !== agentId) : [...value.agentIds, agentId])

  return <>
    <header className="settings-heading connector-form-heading">
      <button className="connector-back" type="button" onClick={onBack} aria-label={t('Back to connectors')}><ArrowLeft size={18} /></button>
      <div><h1>{account ? t('Manage email') : t('Connect email')}</h1><p>{t('Test both incoming and outgoing servers before saving.')}</p></div>
    </header>
    <form className="connector-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <section className="connector-form-section">
        <div className="connector-form-label"><span className="connector-logo email"><Mail size={21} /></span><div><strong>{t('Mailbox')}</strong><small>{t('This name and address identify the account to your agents.')}</small></div></div>
        <div className="connector-field-grid">
          <label><span>{t('Account name')}</span><input value={value.name} onChange={(event) => patch('name', event.target.value)} placeholder={t('Work email')} /></label>
          <label><span>{t('Email address')}</span><input type="email" value={value.email} onChange={(event) => { patch('email', event.target.value); if (!value.username || value.username === value.email) patch('username', event.target.value) }} placeholder="name@company.com" /></label>
          <label><span>{t('Provider')}</span><select value={preset} onChange={(event) => changePreset(event.target.value)}><option value="feishu">{t('Feishu Mail')}</option><option value="custom">{t('Other IMAP/SMTP')}</option></select></label>
          <label><span>{t('Username')}</span><input value={value.username} onChange={(event) => patch('username', event.target.value)} autoCapitalize="none" /></label>
          <label className="connector-password-field"><span>{t('Password or authorization code')}</span><input type="password" value={value.password} onChange={(event) => patch('password', event.target.value)} placeholder={dirtyPasswordHint ? t('Leave blank to keep the saved credential') : t('Enter authorization code')} autoComplete="new-password" /></label>
        </div>
      </section>
      <section className="connector-form-section">
        <div className="connector-form-label"><span className="connector-logo server"><Server size={21} /></span><div><strong>{t('Mail servers')}</strong><small>{t('TLS certificate verification is always enforced.')}</small></div></div>
        <div className="connector-server-grid">
          <label><span>IMAP</span><input value={value.imapHost} onChange={(event) => patch('imapHost', event.target.value)} /></label>
          <label className="connector-port"><span>{t('Port')}</span><input type="number" min="1" max="65535" value={value.imapPort} onChange={(event) => patch('imapPort', Number(event.target.value))} /></label>
          <label className="connector-secure"><input type="checkbox" checked={value.imapSecure} onChange={(event) => patch('imapSecure', event.target.checked)} /><span>{t('Direct TLS')}</span></label>
          <label><span>SMTP</span><input value={value.smtpHost} onChange={(event) => patch('smtpHost', event.target.value)} /></label>
          <label className="connector-port"><span>{t('Port')}</span><input type="number" min="1" max="65535" value={value.smtpPort} onChange={(event) => patch('smtpPort', Number(event.target.value))} /></label>
          <label className="connector-secure"><input type="checkbox" checked={value.smtpSecure} onChange={(event) => patch('smtpSecure', event.target.checked)} /><span>{t('Direct TLS')}</span></label>
        </div>
        {result && <div className={`connector-test-result ${result.ok ? 'ok' : 'failed'}`}>
          {result.ok ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
          <div><strong>{result.ok ? t('Both servers are ready') : t('One or more servers could not connect')}</strong><span>IMAP · {result.imap.ok ? t('Connected') : result.imap.error}</span><span>SMTP · {result.smtp.ok ? t('Connected') : result.smtp.error}</span></div>
        </div>}
      </section>
      <section className="connector-form-section">
        <div className="connector-form-label"><span className="connector-logo access"><Check size={21} /></span><div><strong>{t('Agent access')}</strong><small>{t('Only selected agents receive email search and read tools.')}</small></div></div>
        <div className="connector-agent-grid">
          {snapshot.agents.filter((agent) => !agent.localAgentId).map((agent) => <label className={selectedAgents.has(agent.id) ? 'selected' : ''} key={agent.id}><input type="checkbox" checked={selectedAgents.has(agent.id)} onChange={() => toggleAgent(agent.id)} /><span className="connector-agent-dot" style={{ background: agent.color }} /><span>{agentDisplayName(agent)}</span></label>)}
          {!snapshot.agents.some((agent) => !agent.localAgentId) && <p>{t('Create a cloud agent before granting connector access.')}</p>}
        </div>
      </section>
      {error && <p className="settings-error connector-error" role="alert">{t(error)}</p>}
      <footer className="connector-form-actions">
        {account ? <button type="button" className="connector-disconnect" disabled={saving || testing} onClick={() => void disconnect()}><Unplug size={15} />{t('Disconnect')}</button> : <span />}
        <div><button type="button" className="secondary-button" disabled={saving || testing} onClick={() => void test()}>{testing ? t('Testing…') : t('Test connection')}</button><button type="submit" className="primary-button" disabled={saving || testing}>{saving ? t('Connecting…') : account ? t('Save changes') : t('Connect email')}</button></div>
      </footer>
    </form>
  </>
}
