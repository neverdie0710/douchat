import { ChevronLeft, Copy, ExternalLink, Folder, FolderOpen, Server, Terminal } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { AgentConfig, Conversation, ConversationWorkspaceView, MemberWorkspaceView, RemoteDirectoryListing } from '../../../shared/types'
import { t } from '../preferences'
import { agentDisplayName } from './common'

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
  // Reload when the chat or its members change; agents may be edited elsewhere too.
  useEffect(() => { setView(undefined); setBrowsing(undefined); void load() }, [load, conversation.revision, agents])
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

/** Browses one level at a time. Only a parent path from the server and a child
 * name are sent back; main joins and validates them on the server. */
export function RemoteDirectoryPicker({ conversationId, agentId, host, initial, onChoose, onCancel }: {
  conversationId: string
  agentId: string
  host?: string
  initial?: string
  onChoose: (path: string) => void
  onCancel: () => void
}): ReactElement {
  const [listing, setListing] = useState<RemoteDirectoryListing>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const open = useCallback(async (parent?: string, name?: string): Promise<void> => {
    setLoading(true); setError('')
    try { setListing(await window.douchat.listRemoteAgentDirectories(conversationId, agentId, parent, name)) }
    catch (cause) {
      setError(errorText(cause))
      // A saved folder may be gone; fall back to the server's home folder once.
      if (parent !== undefined && name === undefined && !listing) await window.douchat.listRemoteAgentDirectories(conversationId, agentId).then(setListing, () => {})
    } finally { setLoading(false) }
  }, [conversationId, agentId, listing])
  useEffect(() => { void open(initial) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const up = listing && listing.path !== '/' ? listing.path.slice(0, listing.path.lastIndexOf('/')) || '/' : undefined
  return <div className="remote-directory-picker" role="dialog" aria-label={t('Choose server folder')}>
    <p className="remote-directory-host"><Server size={14} /> {host ?? t('Server')}</p>
    <p className="remote-directory-current" title={listing?.path}>{listing?.path ?? '…'}</p>
    <div className="remote-directory-list">
      {up !== undefined && <button type="button" disabled={loading} onClick={() => void open(up)}><ChevronLeft size={14} /> ..</button>}
      {listing?.directories.map(name => <button type="button" key={name} disabled={loading} onClick={() => void open(listing.path, name)}><Folder size={14} /> {name}</button>)}
      {listing && !listing.directories.length && !loading && <p className="conversation-workspace-note">{t('No folders here')}</p>}
    </div>
    {error && <p className="conversation-workspace-error" role="alert">{t(error)}</p>}
    <div className="conversation-workspace-actions">
      <button type="button" disabled={loading || !listing} onClick={() => listing && onChoose(listing.path)}>{t('Use this folder')}</button>
      <button type="button" onClick={onCancel}>{t('Cancel')}</button>
    </div>
  </div>
}
