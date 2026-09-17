import { LocalAgentSelect } from './LocalAgentSelect'
import { t } from '../preferences'
import { readAvatarFile } from '../avatarFile'
import { CalendarClock, Camera, Check, Cloud, Laptop, PlugZap, Search, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactElement } from 'react'
import type {
  AgentConfig,
  LocalAgent,
  AppSnapshot,
  EndpointInput,
  EndpointSettings,
  EndpointTestResult,
  Conversation,
  CreateAgentInput,
  CreateGroupInput,
  CreateRoutineInput,
  RoutineSchedule,
  UpdateAgentInput
} from '../../../shared/types'
import { AgentAvatar, colors } from './common'

export function BotModal({
  agent,
  localAgents,
  initialLocalAgentId,
  onSettings,
  onClose,
  onCreate,
  onUpdate
}: {
  agent?: AgentConfig
  localAgents: LocalAgent[]
  initialLocalAgentId?: string
  onSettings: () => void
  onClose: () => void
  onCreate: (input: CreateAgentInput) => Promise<void>
  onUpdate: (agentId: string, input: UpdateAgentInput) => Promise<void>
}): ReactElement {
  const [localAgentId, setLocalAgentId] = useState(agent?.localAgentId ?? initialLocalAgentId ?? (!agent ? localAgents.find((item) => item.installed && item.chatSupported)?.id : '') ?? '')
  const [agentSource, setAgentSource] = useState<'cloud' | 'local'>(agent?.localAgentId || initialLocalAgentId ? 'local' : 'cloud')
  const localAgent = localAgents.find((item) => item.id === localAgentId)
  const [error, setError] = useState('')
  const [name, setName] = useState(agent?.name ?? localAgents.find((item) => item.id === initialLocalAgentId)?.name ?? '')
  const [avatar, setAvatar] = useState(agent?.avatar ?? '')
  const [role] = useState(agent?.role ?? 'Assistant')
  const [instructions, setInstructions] = useState(
    agent?.instructions ??
      'Be a helpful assistant. Respond clearly and follow the user’s instructions.'
  )
  const [labels, setLabels] = useState(agent?.labels ?? '')
  const [color] = useState(agent?.color ?? colors[2])
  const [saving, setSaving] = useState(false)
  const avatarFile = useRef<HTMLInputElement>(null)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!name.trim()) return
    if (!agent && (!role.trim() || !instructions.trim())) return
    if (!agent && agentSource === 'local' && (!localAgent?.installed || !localAgent.chatSupported)) return
    setSaving(true)
    setError('')
    try {
      if (agent) {
        await onUpdate(agent.id, {
          name: name.trim(),
          avatar,
          instructions: instructions.trim(),
          labels: labels.trim()
        })
        onClose()
        return
      }
      const input = {
        name: name.trim(),
        role: role.trim(),
        instructions: instructions.trim(),
        labels: labels.trim(),
        color,
        localAgentId: agentSource === 'local' ? localAgentId : ''
      }
      await onCreate(input)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save contact')
    } finally {
      setSaving(false)
    }
  }

  async function chooseAvatar(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    try {
      setAvatar(await readAvatarFile(file))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('This picture could not be used.'))
    }
  }

  if (!agent) return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <form className="agent-modal create-contact-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="create-contact-title">
        <div className="modal-heading">
          <h2 id="create-contact-title">{t('Create contact')}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('Close')}><X size={18} /></button>
        </div>
        <label className="field-row"><span>{t('Contact name')}</span>
          <input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder={t('Enter contact name')} />
        </label>
        <div className="field-row agent-source-field"><span>{t('Agent type')}</span>
          <div className="agent-source-cards" role="radiogroup" aria-label={t('Agent type')}>
            <button type="button" role="radio" aria-checked={agentSource === 'cloud'} className={agentSource === 'cloud' ? 'selected' : ''} onClick={() => setAgentSource('cloud')}>
              <span className="agent-source-icon"><Cloud size={18} strokeWidth={1.9} /></span>
              <span className="agent-source-copy"><strong>{t('Cloud agent')}</strong><small>{t('Uses the cloud default model')}</small></span>
              <span className="agent-source-radio" aria-hidden="true"><i /></span>
            </button>
            <button type="button" role="radio" aria-checked={agentSource === 'local'} className={agentSource === 'local' ? 'selected' : ''} onClick={() => setAgentSource('local')}>
              <span className="agent-source-icon"><Laptop size={18} strokeWidth={1.9} /></span>
              <span className="agent-source-copy"><strong>{t('Local agent')}</strong><small>{t('Use this computer')}</small></span>
              <span className="agent-source-radio" aria-hidden="true"><i /></span>
            </button>
          </div>
        </div>
        {agentSource === 'local' && <div className="field-row"><span>{t('Local agent')}</span>
          <LocalAgentSelect agents={localAgents.filter((item) => item.installed && item.chatSupported)} value={localAgentId} onChange={setLocalAgentId} />
        </div>}
        {agentSource === 'local' && !localAgents.some((item) => item.installed && item.chatSupported) && <p className="settings-note">{t('No available local agents')} <button type="button" className="local-settings-link" onClick={onSettings}>{t('Settings')}</button></p>}
        {error && <p className="settings-error" role="alert">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>{t('Cancel')}</button>
          <button className="primary-button" type="submit" disabled={saving || !name.trim() || (agentSource === 'local' && (!localAgent?.installed || !localAgent.chatSupported))}>{t(saving ? 'Saving…' : 'Create contact')}</button>
        </div>
      </form>
    </div>
  )

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <form className="agent-modal edit-contact-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="edit-contact-title">
        <div className="edit-contact-heading">
          <h2 id="edit-contact-title">{t('Edit contact information')}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('Close')} disabled={saving}><X size={18} /></button>
        </div>

        <div className="edit-contact-avatar-field">
          <span>{t('Avatar')}</span>
          <div className="edit-contact-avatar-row">
            <button type="button" className="edit-contact-avatar" onClick={() => avatarFile.current?.click()} aria-label={t('Choose picture')}>
              <AgentAvatar agent={{ ...agent, avatar }} size={76} />
              <span><Camera size={17} strokeWidth={1.8} /></span>
            </button>
            <div>
              <button type="button" className="edit-contact-picture-action" onClick={() => avatarFile.current?.click()}>{t('Choose picture')}</button>
              {avatar && <button type="button" className="edit-contact-picture-action muted" onClick={() => setAvatar('')}>{t('Remove')}</button>}
            </div>
            <input ref={avatarFile} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void chooseAvatar(event)} />
          </div>
        </div>

        <label className="edit-contact-field"><span>{t('Nickname')}</span>
          <input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder={t('Enter contact name')} />
        </label>
        <label className="edit-contact-field"><span>{t('Description')}</span>
          <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={4} placeholder={t('Add a description')} />
        </label>
        <label className="edit-contact-field"><span>{t('Labels')}</span>
          <input value={labels} onChange={(event) => setLabels(event.target.value)} placeholder={t('Search or create labels')} />
        </label>

        {error && <p className="settings-error" role="alert">{error}</p>}
        <div className="edit-contact-footer">
          <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>{t('Cancel')}</button>
          <button className="primary-button" type="submit" disabled={saving || !name.trim()}>{t(saving ? 'Saving…' : 'Done')}</button>
        </div>
      </form>
    </div>
  )
}

export function AddMembersModal({ snapshot, conversation, onClose, onUpdate, manage = false, remove = false, initialAgentIds, onCreate }: {
  snapshot: AppSnapshot
  conversation?: Conversation
  remove?: boolean
  manage?: boolean
  initialAgentIds?: string[]
  onCreate?: (input: CreateGroupInput) => Promise<void>
  onClose: () => void
  onUpdate: (id: string, input: { name: string; description: string; agentIds: string[]; leadAgentId: string }) => Promise<void>
}): ReactElement {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>(manage ? conversation?.agentIds ?? initialAgentIds ?? [] : [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const members = new Set(manage || remove ? [] : conversation?.agentIds ?? [])
  const matching = snapshot.agents.filter((agent) => (!remove || conversation?.agentIds.includes(agent.id)) && agent.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
  const toggle = (id: string): void => setSelected((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])
  const invalid = selected.length < (manage ? 2 : 1) || (remove && selected.length >= (conversation?.agentIds.length ?? 0))
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (invalid || saving) return
    setSaving(true)
    setError('')
    try {
      const agentIds = remove ? (conversation?.agentIds ?? []).filter((id) => !selected.includes(id)) : manage ? selected : [...new Set([...(conversation?.agentIds ?? []), ...selected])]
      const input = {
        name: conversation?.name ?? snapshot.agents.filter((agent) => selected.includes(agent.id)).map((agent) => agent.name).join('、'),
        description: conversation?.description ?? '', agentIds,
        leadAgentId: conversation?.leadAgentId && agentIds.includes(conversation.leadAgentId) ? conversation.leadAgentId : agentIds[0]
      }
      if (conversation) await onUpdate(conversation.id, input)
      else if (onCreate) await onCreate(input)
      onClose()
    } catch {
      setError(t('Could not save changes'))
    } finally { setSaving(false) }
  }
  return (
    <div className="modal-backdrop" onMouseDown={(event) => !saving && event.target === event.currentTarget && onClose()}>
      <form className="agent-modal add-members-modal" role="dialog" aria-modal="true" aria-labelledby="add-members-title" onSubmit={submit}
        onKeyDown={(event) => { if (event.key === 'Escape' && !saving) { event.stopPropagation(); onClose() } }}>
        <section className="member-picker-source">
          <label className="member-picker-search"><Search size={17} /><input autoFocus aria-label={t('Search contacts')} placeholder={t('Search contacts')} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <h3>{t('Contacts')}</h3>
          <div className="member-picker-list">
            {matching.map((agent) => {
              const joined = members.has(agent.id)
              const checked = selected.includes(agent.id)
              return <button type="button" key={agent.id} className={`member-picker-row ${checked ? 'selected' : ''}`} role="checkbox" aria-checked={joined || checked} disabled={joined || saving} onClick={() => toggle(agent.id)}>
                <span className={`member-picker-check ${joined || checked ? 'checked' : ''}`}><Check size={13} /></span>
                <AgentAvatar agent={agent} size={36} /><span className="member-picker-name">{agent.name}</span>
                {joined && <small>{t('Already added')}</small>}
              </button>
            })}
            {!matching.length && <p className="member-picker-empty">{t('No matching contacts')}</p>}
          </div>
        </section>
        <section className="member-picker-selection">
          <header><h2 id="add-members-title">{t(remove ? 'Remove group members' : manage ? conversation ? 'Group members' : 'Create group' : 'Add group members')}</h2><span>{t('Selected contacts')}: {selected.length}</span></header>
          <div className="member-picker-list">
            {selected.map((id) => {
              const agent = snapshot.agents.find((item) => item.id === id)
              return agent && <div className="member-picker-chosen" key={id}><AgentAvatar agent={agent} size={36} /><span className="member-picker-name">{agent.name}</span><button type="button" disabled={saving} onClick={() => toggle(id)} aria-label={`${t('Remove')} ${agent.name}`}><X size={13} /></button></div>
            })}
            {!selected.length && <p className="member-picker-empty">{t(remove ? 'Select members to remove' : 'Select contacts to add')}</p>}
          </div>
          {remove && selected.length >= (conversation?.agentIds.length ?? 0) && <p className="member-picker-error">{t('Keep at least one member')}</p>}
          {error && <p role="alert" className="member-picker-error">{error}</p>}
          <footer><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>{t('Cancel')}</button><button type="submit" className="primary-button" disabled={invalid || saving}>{saving ? t('Saving…') : t(remove ? 'Remove' : manage ? conversation ? 'Save' : 'Create group' : 'Add')}</button></footer>
        </section>
      </form>
    </div>
  )
}

export function GroupModal(props: {
  snapshot: AppSnapshot
  conversation?: Conversation
  initialAgentIds?: string[]
  onClose: () => void
  onCreate: (input: CreateGroupInput) => Promise<void>
  onUpdate: (id: string, input: { name: string; description: string; agentIds: string[]; leadAgentId: string }) => Promise<void>
  onNewBot: () => void
}): ReactElement {
  return <AddMembersModal {...props} manage />
}

export function RoutineModal({
  snapshot,
  initialAgentId,
  initialConversationId,
  onClose,
  onCreate
}: {
  snapshot: AppSnapshot
  initialAgentId?: string
  initialConversationId?: string
  onClose: () => void
  onCreate: (input: CreateRoutineInput) => Promise<void>
}): ReactElement {
  const firstAgent = snapshot.agents.find((agent) => agent.id === initialAgentId) ?? snapshot.agents[0]
  const defaultConversation =
    snapshot.conversations.find((conversation) => conversation.id === initialConversationId) ??
    snapshot.conversations.find(
      (conversation) => conversation.type === 'direct' && conversation.agentIds[0] === firstAgent?.id
    ) ??
    snapshot.conversations[0]
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [agentId, setAgentId] = useState(firstAgent?.id ?? '')
  const [conversationId, setConversationId] = useState(defaultConversation?.id ?? '')
  const [cadence, setCadence] = useState<'daily' | 'weekdays' | 'weekly' | 'interval'>('daily')
  const [time, setTime] = useState('09:00')
  const [day, setDay] = useState('1')
  const [intervalMinutes, setIntervalMinutes] = useState('60')
  const [saving, setSaving] = useState(false)

  function changeAgent(nextAgentId: string): void {
    setAgentId(nextAgentId)
    const direct = snapshot.conversations.find(
      (conversation) => conversation.type === 'direct' && conversation.agentIds[0] === nextAgentId
    )
    if (direct) setConversationId(direct.id)
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!name.trim() || !prompt.trim() || !agentId || !conversationId) return
    const schedule: RoutineSchedule =
      cadence === 'interval'
        ? { kind: 'interval', intervalMinutes: Math.max(1, Number(intervalMinutes) || 60) }
        : {
            kind: 'weekly',
            days: cadence === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : cadence === 'weekdays' ? [1, 2, 3, 4, 5] : [Number(day)],
            time
          }
    setSaving(true)
    try {
      await onCreate({
        name: name.trim(),
        prompt: prompt.trim(),
        agentId,
        conversationId,
        schedule,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const selectedAgent = snapshot.agents.find((agent) => agent.id === agentId)

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="agent-modal routine-modal" onSubmit={submit}>
        <div className="modal-heading">
          <div>
            <span className="eyebrow">Automation</span>
            <h2>Create a routine</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="routine-preview">
          <span className="routine-clock">
            <CalendarClock size={21} />
          </span>
          <div>
            <strong>{name.trim() || 'Untitled routine'}</strong>
            <span>{selectedAgent?.name ?? 'Choose a bot'} will run this in a private computer.</span>
          </div>
        </div>

        <label className="field-row">
          <span>Name</span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Review the morning brief"
          />
        </label>

        <label className="field-row">
          <span>What should happen?</span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Give the bot a complete instruction, including the expected result."
            rows={4}
          />
        </label>

        <div className="field-row two-fields">
          <label>
            <span>Bot</span>
            <select value={agentId} onChange={(event) => changeAgent(event.target.value)}>
              {snapshot.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Post results to</span>
            <select value={conversationId} onChange={(event) => setConversationId(event.target.value)}>
              {snapshot.conversations
                .filter((conversation) => conversation.agentIds.includes(agentId))
                .map((conversation) => (
                  <option key={conversation.id} value={conversation.id}>
                    {conversation.name}
                  </option>
                ))}
            </select>
          </label>
        </div>

        <div className="field-row routine-schedule-fields">
          <span>Schedule</span>
          <div className="schedule-grid">
            <select value={cadence} onChange={(event) => setCadence(event.target.value as typeof cadence)}>
              <option value="daily">Every day</option>
              <option value="weekdays">Weekdays</option>
              <option value="weekly">Every week</option>
              <option value="interval">Repeating interval</option>
            </select>
            {cadence === 'weekly' && (
              <select value={day} onChange={(event) => setDay(event.target.value)}>
                {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((label, index) => (
                  <option key={label} value={index}>
                    {label}
                  </option>
                ))}
              </select>
            )}
            {cadence === 'interval' ? (
              <select value={intervalMinutes} onChange={(event) => setIntervalMinutes(event.target.value)}>
                <option value="15">Every 15 minutes</option>
                <option value="30">Every 30 minutes</option>
                <option value="60">Every hour</option>
                <option value="360">Every 6 hours</option>
                <option value="720">Every 12 hours</option>
              </select>
            ) : (
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            )}
          </div>
          <small>Times use {Intl.DateTimeFormat().resolvedOptions().timeZone}.</small>
        </div>

        <div className="modal-footer">
          <p>The app must be running. Missed times run once when the computer wakes.</p>
          <button className="primary-button" type="submit" disabled={saving || !name.trim() || !prompt.trim()}>
            {saving ? 'Creating…' : 'Create routine'}
          </button>
        </div>
      </form>
    </div>
  )
}

export function EndpointModal({
  endpoint,
  models,
  onClose,
  onSave,
  onTest
}: {
  endpoint: EndpointSettings
  models: number
  onClose: () => void
  onSave: (input: EndpointInput) => Promise<void>
  onTest: (input: EndpointInput) => Promise<EndpointTestResult>
}): ReactElement {
  const [baseUrl, setBaseUrl] = useState(endpoint.baseUrl)
  const [apiKey, setApiKey] = useState('')
  const [result, setResult] = useState<EndpointTestResult>()
  const [busy, setBusy] = useState(false)

  const input = (): EndpointInput => ({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || undefined })

  /** A missing IPC handler means the window reloaded onto a newer renderer
   * while the old main process kept running. Say so instead of failing mute. */
  const failure = (cause: unknown): EndpointTestResult => {
    const message = cause instanceof Error ? cause.message : String(cause)
    return {
      ok: false,
      models: 0,
      error: /no handler registered/i.test(message)
        ? 'This window is newer than the running app. Quit and start it again (npm run dev).'
        : message
    }
  }

  async function test(): Promise<EndpointTestResult> {
    setBusy(true)
    try {
      const check = await onTest(input()).catch(failure)
      setResult(check)
      return check
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    const check = await test()
    if (!check.ok) return
    setBusy(true)
    try {
      await onSave(input())
      onClose()
    } catch (cause) {
      setResult(failure(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="agent-modal" onSubmit={submit}>
        <div className="modal-heading">
          <div>
            <span className="eyebrow">Models</span>
            <h2>Connect an endpoint</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="routine-preview">
          <span className="routine-clock">
            <PlugZap size={20} />
          </span>
          <div>
            <strong>{endpoint.hasApiKey ? `${models} chat models available` : 'Not connected yet'}</strong>
            <span>
              {endpoint.source === 'env'
                ? 'Currently read from .env — saving here overrides it.'
                : 'Any OpenAI-compatible base URL works, including a local router.'}
            </span>
          </div>
        </div>

        <label className="field-row">
          <span>Base URL</span>
          <input
            autoFocus
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="http://localhost:8080/api/v1"
            spellCheck={false}
          />
        </label>

        <label className="field-row">
          <span>API key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={endpoint.hasApiKey ? 'Saved — type to replace it' : 'sk-…'}
            spellCheck={false}
          />
          <small>Stored on this computer, in the app&apos;s own data folder.</small>
        </label>

        {result && (
          <p className={`endpoint-result ${result.ok ? 'ok' : 'failed'}`}>
            {result.ok ? `Reached the endpoint · ${result.models} chat models` : result.error}
          </p>
        )}

        <div className="modal-footer">
          <button type="button" className="quiet-link" onClick={() => void test()} disabled={busy}>
            Test connection
          </button>
          <button className="primary-button" type="submit" disabled={busy || !baseUrl.trim()}>
            {busy ? 'Checking…' : 'Save and connect'}
          </button>
        </div>
      </form>
    </div>
  )
}
