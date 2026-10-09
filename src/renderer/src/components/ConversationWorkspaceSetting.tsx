import { ArrowUp, Copy, ExternalLink, Folder, FolderOpen, Server, Terminal, X } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { AgentConfig, Conversation, ConversationWorkspaceView, MemberWorkspaceView, RemoteDirectoryListing } from '../../../shared/types'
import { t } from '../preferences'
import { agentDisplayName } from './common'
import { NativeDialog } from './NativeDialog'

const errorText = (cause: unknown): string => cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Could not save changes'
const folderName = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

/** Folders are chosen per member, on the computer or server that member runs on.
 * Main resolves every row; this component never decides where an agent runs. */
export function ConversationWorkspaceSetting({ conversation, agents }: {
  conversation: Conversation
  agents: AgentConfig[]
}): ReactElement | null {
  const [view, setView] = useState<ConversationWorkspaceView>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [browsing, setBrowsing] = useState<string>()
  const load = useCallback(() => window.douchat.conversationWorkspaces(conversation.id).then(setView, cause => setError(errorText(cause))), [conversation.id])
  // Snapshots arrive every few seconds with new arrays; only real changes reload.
  // The last result stays on screen while reloading, so nothing flickers.
  const membersKey = useMemo(() => JSON.stringify([conversation.agentIds, conversation.workspacePath ?? null, conversation.agentWorkspaces ?? null,
    agents.filter(agent => conversation.agentIds.includes(agent.id) || conversation.socialRoom?.agents.some(item => item.localId === agent.id)).map(agent => [agent.id, agent.localAgentId, agent.revision ?? 0])]), [conversation, agents])
  useEffect(() => { void load() }, [load, membersKey])
  // A different chat starts over.
  useEffect(() => { setView(undefined); setBrowsing(undefined) }, [conversation.id])
  if (!view || (!view.eligible && !view.legacyPath)) return null
  const run = async (action: () => Promise<ConversationWorkspaceView | void>): Promise<void> => {
    setBusy(true); setError('')
    try { const next = await action(); if (next) setView(next) }
    catch (cause) { setError(errorText(cause)) }
    finally { setBusy(false) }
  }
  const single = conversation.type === 'direct' && view.members.length === 1
  return <section className="conversation-workspace-setting" aria-label={t('Workspace')}>
    <h2>{t('Workspace')}</h2>
    {view.members.map(member => {
      const agent = agents.find(item => item.id === member.agentId)
      return <MemberRow key={member.agentId} member={member} name={single || !agent ? undefined : agentDisplayName(agent)} busy={busy}
        onChoose={() => member.location === 'remote' ? setBrowsing(member.agentId) : void run(() => window.douchat.chooseAgentWorkspace(conversation.id, member.agentId))}
        onClear={() => void run(() => window.douchat.clearAgentWorkspace(conversation.id, member.agentId))}
        onOpen={() => void run(() => window.douchat.openAgentWorkspace(conversation.id, member.agentId))}
        onCopy={() => void run(() => window.douchat.copyText(member.path!))}
        onTerminal={() => void run(() => window.douchat.openRemoteAgentWorkspaceTerminal(conversation.id, member.agentId))} />
    })}
    {view.legacyPath && view.legacyUnused && <div className="conversation-workspace-legacy">
      <p className="conversation-workspace-note">{t('A folder on this computer is saved for this chat, but no agent here can use it.')} <span title={view.legacyPath}>{folderName(view.legacyPath)}</span></p>
      <div className="conversation-workspace-actions"><button type="button" disabled={busy} onClick={() => void run(() => window.douchat.clearConversationWorkspace(conversation.id))}>{t('Remove')}</button></div>
    </div>}
    {view.legacyPath && !view.legacyUnused && <div className="conversation-workspace-actions">
      <button type="button" disabled={busy} onClick={() => void run(() => window.douchat.clearConversationWorkspace(conversation.id))}>{t('Use default')}</button>
    </div>}
    {error && <p className="conversation-workspace-error" role="alert">{t(error)}</p>}
    {browsing && <RemoteDirectoryPicker conversationId={conversation.id} agentId={browsing} host={view.members.find(item => item.agentId === browsing)?.host}
      initial={view.members.find(item => item.agentId === browsing)?.path}
      onCancel={() => setBrowsing(undefined)}
      onChoose={(parent, name) => { const agentId = browsing; setBrowsing(undefined); void run(() => window.douchat.chooseRemoteAgentWorkspace(conversation.id, agentId, parent, name)) }} />}
  </section>
}

function MemberRow({ member, name, busy, onChoose, onClear, onOpen, onCopy, onTerminal }: {
  member: MemberWorkspaceView
  name?: string
  busy: boolean
  onChoose: () => void
  onClear: () => void
  onOpen: () => void
  onCopy: () => void
  onTerminal: () => void
}): ReactElement {
  const remote = member.location === 'remote'
  const location = remote ? member.host ?? t('Server') : t('This computer')
  return <div className="conversation-workspace-member">
    {name && <p className="conversation-workspace-member-name">{name} · {location}</p>}
    <p className="conversation-workspace-path" title={member.path}>
      {remote ? <Server size={15} /> : <FolderOpen size={15} />}
      <span>{member.path ? folderName(member.path) : t('Default')}</span>
      {!remote && <button className="conversation-workspace-open" type="button" title={t('Open folder')} aria-label={t('Open folder')} disabled={busy} onClick={onOpen}><ExternalLink size={14} /></button>}
      {remote && member.path && <>
        <button className="conversation-workspace-open" type="button" title={t('Copy path')} aria-label={t('Copy path')} disabled={busy} onClick={onCopy}><Copy size={14} /></button>
        <button className="conversation-workspace-open" type="button" title={t('Open in terminal')} aria-label={t('Open in terminal')} disabled={busy} onClick={onTerminal}><Terminal size={14} /></button>
      </>}
    </p>
    {!name && remote && <p className="conversation-workspace-note">{t('Runs on')} {location}</p>}
    {member.source === 'legacy' && <p className="conversation-workspace-note">{t('Uses the folder chosen earlier for this chat.')}</p>}
    {member.stale && <p className="conversation-workspace-note">{t('The folder chosen earlier belongs to another computer or server and is not used.')}</p>}
    <div className="conversation-workspace-actions">
      <button type="button" disabled={busy} onClick={onChoose}>{t(remote ? 'Choose server folder' : member.path ? 'Change folder' : 'Choose folder')}</button>
      {(member.source === 'custom' || member.stale) && <button type="button" disabled={busy} onClick={onClear}>{t('Use default')}</button>}
    </div>
  </div>
}

/** Split a typed path into the folder to list and the name being typed:
 * "/srv/ap" lists /srv and filters by "ap"; "/srv/app/" lists /srv/app. */
export function splitTypedPath(typed: string): { folder: string; filter: string } | undefined {
  if (!typed.startsWith('/')) return undefined
  const slash = typed.lastIndexOf('/')
  return { folder: typed.slice(0, slash) || '/', filter: typed.slice(slash + 1) }
}
const withSlash = (path: string): string => path.endsWith('/') ? path : `${path}/`

/** Browses one level at a time, in its own dialog. Typing filters the folder
 * list by name and follows the typed path; main resolves every path on the
 * server, and only a listed folder plus one child name is ever chosen. */
export function RemoteDirectoryPicker({ conversationId, agentId, host, initial, onChoose, onCancel }: {
  conversationId: string
  agentId: string
  host?: string
  initial?: string
  onChoose: (parent: string, name?: string) => void
  onCancel: () => void
}): ReactElement {
  const [listing, setListing] = useState<RemoteDirectoryListing>()
  const [typed, setTyped] = useState(initial ? withSlash(initial) : '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [active, setActive] = useState(0)
  const request = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const open = useCallback(async (parent?: string, name?: string, options: { fallback?: boolean; keepText?: boolean } = {}): Promise<void> => {
    const id = ++request.current
    setLoading(true); setError('')
    try {
      const next = await window.douchat.listRemoteAgentDirectories(conversationId, agentId, parent, name)
      if (id !== request.current) return
      setListing(next); setActive(0)
      if (!options.keepText) setTyped(withSlash(next.path))
    } catch (cause) {
      if (id !== request.current) return
      // While typing, a folder that doesn't exist yet is not an error worth showing.
      if (!options.keepText) setError(errorText(cause))
      if (options.fallback) {
        const home = await window.douchat.listRemoteAgentDirectories(conversationId, agentId).catch(() => undefined)
        if (home && id === request.current) { setListing(home); setTyped(withSlash(home.path)) }
      }
    } finally { if (id === request.current) setLoading(false) }
  }, [conversationId, agentId])
  useEffect(() => { void open(initial, undefined, { fallback: initial !== undefined }) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the typed path: list its folder once the user pauses typing.
  const parts = splitTypedPath(typed)
  useEffect(() => {
    if (!parts || !listing || parts.folder === listing.path) return
    const timer = setTimeout(() => void open(parts.folder, undefined, { keepText: true }), 250)
    return () => clearTimeout(timer)
  }, [parts?.folder]) // eslint-disable-line react-hooks/exhaustive-deps

  const filter = parts && listing && parts.folder === listing.path ? parts.filter.toLowerCase() : ''
  const matches = useMemo(() => {
    const names = listing?.directories ?? []
    if (!filter) return names
    // Names that start with the text first, then names that contain it.
    return [...names.filter(name => name.toLowerCase().startsWith(filter)), ...names.filter(name => !name.toLowerCase().startsWith(filter) && name.toLowerCase().includes(filter))]
  }, [listing, filter])
  const enter = (name: string): void => { void open(listing!.path, name); input.current?.focus() }
  const up = listing && listing.path !== '/' ? listing.path.slice(0, listing.path.lastIndexOf('/')) || '/' : undefined
  // The folder that "Use this folder" picks: the highlighted match while filtering, else the listed folder.
  const choice = filter && matches[active] ? { parent: listing!.path, name: matches[active] } : listing ? { parent: listing.path } : undefined
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(index + 1, Math.max(matches.length - 1, 0))) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(index - 1, 0)) }
    else if ((event.key === 'Enter' || event.key === 'Tab') && filter && matches[active]) { event.preventDefault(); enter(matches[active]) }
    else if (event.key === 'Enter' && parts && listing && parts.folder !== listing.path) { event.preventDefault(); void open(parts.folder) }
    else if (event.key === 'Enter') event.preventDefault()
  }
  return <NativeDialog className="modal-backdrop" onClose={onCancel} width={560} height={560}>
    <div className="remote-directory-dialog" role="dialog" aria-modal="true" aria-labelledby="remote-directory-title">
      <header>
        <div><h2 id="remote-directory-title">{t('Choose server folder')}</h2>{host && <p><Server size={13} /> {host}</p>}</div>
        <button type="button" className="icon-button" aria-label={t('Close')} onClick={onCancel}><X size={18} /></button>
      </header>
      <div className="remote-directory-address">
        <button type="button" className="icon-button" aria-label={t('Parent folder')} title={t('Parent folder')} disabled={loading || up === undefined} onClick={() => { if (up !== undefined) void open(up); input.current?.focus() }}><ArrowUp size={16} /></button>
        <input ref={input} aria-label={t('Folder path')} role="combobox" aria-expanded="true" aria-controls="remote-directory-options" aria-autocomplete="list"
          value={typed} spellCheck={false} autoFocus placeholder="/home/user/project" onChange={event => { setTyped(event.target.value); setActive(0); setError('') }} onKeyDown={onKeyDown} />
      </div>
      <div id="remote-directory-options" className="remote-directory-list" role="listbox" aria-busy={loading}>
        {matches.map((name, index) => <button type="button" role="option" aria-selected={Boolean(filter) && index === active} key={name} disabled={loading}
          className={filter && index === active ? 'active' : ''} onMouseEnter={() => filter && setActive(index)} onClick={() => enter(name)}><Folder size={16} /><span>{name}</span></button>)}
        {listing && !matches.length && !loading && <p className="remote-directory-empty">{t(filter ? 'No matching folders' : 'No folders here')}</p>}
        {!listing && loading && <p className="remote-directory-empty">{t('Loading…')}</p>}
      </div>
      {error && <p className="conversation-workspace-error" role="alert">{t(error)}</p>}
      <footer>
        <button type="button" className="secondary-button" onClick={onCancel}>{t('Cancel')}</button>
        <button type="button" className="primary-button" disabled={loading || !choice} onClick={() => choice && onChoose(choice.parent, choice.name)}>{t('Use this folder')}</button>
      </footer>
    </div>
  </NativeDialog>
}
