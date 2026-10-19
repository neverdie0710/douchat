import { Bot, Check, Laptop, Package, Server } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { LocalAgent } from '../../../shared/types'
import { agentIcons } from '../agentIcons'
import { t } from '../preferences'
import douchatLogo from '../../../../resources/icons/douchat.png'
import { PickerPopover } from './PickerPopover'
import { agentServer } from './RemoteMark'

export const CLOUD_PLACE = 'cloud'
export const LOCAL_PLACE = 'local'

/** Where an agent runs: Douchat's cloud, this computer, or one server connection (by id). */
export interface HarnessPlace { id: string; name: string; agents: LocalAgent[] }

const connectionOf = (agent: LocalAgent): string | undefined => agent.connectionId ?? agent.remoteAgent?.connectionId ?? agent.daemon?.connectionId

export function placeOf(agent: LocalAgent): string {
  return connectionOf(agent) ?? LOCAL_PLACE
}

/**
 * Built-in first, then this computer, then each server that has an agent ready
 * to run. The web app lists only the desktop app's own agents: its server
 * connections are managed in the desktop app, like in Settings.
 */
export function harnessPlaces(localAgents: LocalAgent[]): HarnessPlace[] {
  const web = typeof window !== 'undefined' && window.douchat?.platform === 'web'
  const ready = localAgents.filter(agent => agent.installed && (!web || !connectionOf(agent)))
  const servers = new Map<string, HarnessPlace>()
  for (const agent of ready) {
    const id = connectionOf(agent)
    if (!id) continue
    const place = servers.get(id) ?? { id, name: agentServer(agent) || t('Server'), agents: [] }
    place.agents.push(agent)
    servers.set(id, place)
  }
  return [
    // Douchat's own harness: on the desktop it runs on this computer too, so it is "built-in", not "cloud".
    { id: CLOUD_PLACE, name: t('Built-in'), agents: [] },
    // From the web app, "this computer" is the one running the desktop app.
    { id: LOCAL_PLACE, name: t(web ? 'Desktop app' : 'This computer'), agents: ready.filter(agent => !connectionOf(agent)) },
    ...servers.values()
  ]
}

const placeIcon = (id: string) => id === CLOUD_PLACE ? <Package size={16} /> : id === LOCAL_PLACE ? <Laptop size={16} /> : <Server size={16} />

function agentLogo(agent: LocalAgent): ReactElement {
  const art = agent.avatar || agentIcons[agent.remote?.adapter ?? agent.remoteAgent?.adapter ?? agent.id]
  return <span className="agent-select-logo" data-agent={agent.id}>{art ? <img src={art} alt="" /> : <Bot size={18} />}</span>
}

/**
 * Step one of creating an agent: a one-line selector that opens where it runs
 * (left) and which agent harness runs it there (right). Browsing places
 * changes nothing; choosing a harness does. The cloud has one harness,
 * Douchat's own, which runs on a model chosen next.
 */
export function AgentHarnessPicker({ places, place, agentId, disabled, onChoose, onSettings }: {
  places: HarnessPlace[]
  place: string
  agentId: string
  disabled?: boolean
  onChoose: (place: string, agentId: string) => void
  onSettings: () => void
}): ReactElement {
  const chosenPlace = places.find(item => item.id === place) ?? places[0]
  const chosen = chosenPlace.agents.find(item => item.id === agentId)
  const [viewing, setViewing] = useState<string>()
  const current = places.find(item => item.id === (viewing ?? chosenPlace.id)) ?? chosenPlace
  const douchat = <span className="agent-select-logo"><img src={douchatLogo} alt="" /></span>
  const trigger = chosenPlace.id === CLOUD_PLACE
    ? <>{douchat}<span>Douchat</span><small className="agent-select-host">{t('Built-in')}</small></>
    : chosen ? <>{agentLogo(chosen)}<span>{chosen.name}</span><small className="agent-select-host">{chosenPlace.name}</small></> : <span>{t('Select an agent')}</span>
  return <PickerPopover label={t('Agent Harness')} trigger={trigger} disabled={disabled}>{close => <div className="harness-picker">
    <div className="harness-places" role="listbox" aria-label={t('Runs on')}>
      {places.map(item => <button type="button" role="option" key={item.id} aria-selected={item.id === current.id} className={item.id === current.id ? 'selected' : ''} onClick={() => setViewing(item.id)}>
        {placeIcon(item.id)}<span>{item.name}</span>{item.id !== CLOUD_PLACE && <small>{item.agents.length}</small>}
      </button>)}
    </div>
    <div className="harness-agents" role="listbox" aria-label={t('Agent')}>
      {current.id === CLOUD_PLACE
        ? <button type="button" role="option" aria-selected={chosenPlace.id === CLOUD_PLACE} className={chosenPlace.id === CLOUD_PLACE ? 'selected' : ''} onClick={() => { onChoose(CLOUD_PLACE, ''); close() }}>
          {douchat}<span className="harness-agent-copy"><strong>Douchat</strong><small>{t("Douchat's built-in agent harness")}</small></span>{chosenPlace.id === CLOUD_PLACE && <Check size={16} />}
        </button>
        : current.agents.map(agent => {
          const selected = chosenPlace.id === current.id && agent.id === agentId
          return <button type="button" role="option" key={agent.id} aria-selected={selected} className={selected ? 'selected' : ''} onClick={() => { onChoose(current.id, agent.id); close() }}>
            {agentLogo(agent)}<span className="harness-agent-copy"><strong>{agent.name}</strong>{agent.version && <small>{agent.version}</small>}</span>{selected && <Check size={16} />}
          </button>
        })}
      {current.id !== CLOUD_PLACE && !current.agents.length && <p className="settings-note">{t('No available agents')} <button type="button" className="local-settings-link" onClick={onSettings}>{t('Settings')}</button></p>}
    </div>
  </div>}</PickerPopover>
}
