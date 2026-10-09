import { ArrowUp, Copy, ExternalLink, Folder, FolderOpen, Server, Terminal, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
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
      onChoose={parent => { const agentId = browsing; setBrowsing(undefined); void run(() => window.douchat.chooseRemoteAgentWorkspace(conversation.id, agentId, parent)) }} />}
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

/** Browses one level at a time, in its own dialog. A path can be typed, but
 * main resolves it on the server; only a parent from the server and a child
 * name are sent while browsing. */
export function RemoteDirectoryPicker({ conversationId, agentId, host, initial, onChoose, onCancel }: {
  conversationId: string
  agentId: string
  host?: string
  initial?: string
  onChoose: (path: string) => void
  onCancel: () => void
}): ReactElement {
  const [listing, setListing] = useState<RemoteDirectoryListing>()
  const [typed, setTyped] = useState(initial ?? '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const request = useRef(0)
  const open = useCallback(async (parent?: string, name?: string, fallback = false): Promise<void> => {
    const id = ++request.current
    setLoading(true); setError('')
    try {
      const next = await window.douchat.listRemoteAgentDirectories(conversationId, agentId, parent, name)
      if (id !== request.current) return
      setListing(next); setTyped(next.path)
    } catch (cause) {
      if (id !== request.current) return
      setError(errorText(cause))
      // A saved folder may be gone; show the server's home folder instead.
      if (fallback) {
        const home = await window.douchat.listRemoteAgentDirectories(conversationId, agentId).catch(() => undefined)
        if (home && id === request.current) { setListing(home); setTyped(home.path) }
      }
    } finally { if (id === request.current) setLoading(false) }
  }, [conversationId, agentId])
  useEffect(() => { void open(initial, undefined, initial !== undefined) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const up = listing && listing.path !== '/' ? listing.path.slice(0, listing.path.lastIndexOf('/')) || '/' : undefined
  const go = (): void => { const path = typed.trim(); if (path && path !== listing?.path) void open(path) }
  return <NativeDialog className="modal-backdrop" onClose={onCancel} width={560} height={560}>
    <form className="remote-directory-dialog" role="dialog" aria-modal="true" aria-labelledby="remote-directory-title" onSubmit={event => { event.preventDefault(); go() }}>
      <header>
        <div><h2 id="remote-directory-title">{t('Choose server folder')}</h2>{host && <p><Server size={13} /> {host}</p>}</div>
        <button type="button" className="icon-button" aria-label={t('Close')} onClick={onCancel}><X size={18} /></button>
      </header>
      <div className="remote-directory-address">
        <button type="button" className="icon-button" aria-label={t('Parent folder')} title={t('Parent folder')} disabled={loading || up === undefined} onClick={() => up !== undefined && void open(up)}><ArrowUp size={16} /></button>
        <input aria-label={t('Folder path')} value={typed} spellCheck={false} autoFocus placeholder="/home/user/project" onChange={event => setTyped(event.target.value)} onBlur={go} />
      </div>
      <div className="remote-directory-list" aria-busy={loading}>
        {listing?.directories.map(name => <button type="button" key={name} disabled={loading} onClick={() => void open(listing.path, name)}><Folder size={16} /><span>{name}</span></button>)}
        {listing && !listing.directories.length && !loading && <p className="remote-directory-empty">{t('No folders here')}</p>}
        {!listing && loading && <p className="remote-directory-empty">{t('Loading…')}</p>}
      </div>
      {error && <p className="conversation-workspace-error" role="alert">{t(error)}</p>}
      <footer>
        <button type="button" className="secondary-button" onClick={onCancel}>{t('Cancel')}</button>
        <button type="button" className="primary-button" disabled={loading || !listing} onClick={() => listing && onChoose(listing.path)}>{t('Use this folder')}</button>
      </footer>
    </form>
  </NativeDialog>
}
