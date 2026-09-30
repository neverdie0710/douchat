import { Bot, Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { LocalAgent } from '../../../shared/types'
import { agentIcons } from '../agentIcons'
import { t } from '../preferences'
import { RemoteMark } from './RemoteMark'

export function LocalAgentSelect({ agents, value, onChange }: { agents: LocalAgent[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const selected = agents.find((agent) => agent.id === value)
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent): void => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const doc = root.current!.ownerDocument
    doc.addEventListener('pointerdown', dismiss)
    const option = root.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')
      ?? root.current?.querySelector<HTMLButtonElement>('[role="option"]')
    option?.focus({ preventScroll: true })
    return () => doc.removeEventListener('pointerdown', dismiss)
  }, [open])
  const icon = (agent: LocalAgent) => { const art = agent.avatar || agentIcons[agent.remote?.adapter ?? agent.id]; return <span className="agent-select-logo" data-agent={agent.id}>{art ? <img src={art} alt="" /> : <Bot size={18} />}{agent.remote && <RemoteMark host={agent.remote.host} />}</span> }
  return <div className="agent-select" ref={root} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }} onKeyDown={(event) => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus({ preventScroll: true }) }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) { setOpen(true); return }
      const options = Array.from(root.current!.querySelectorAll<HTMLButtonElement>('[role="option"]'))
      const index = options.indexOf(root.current!.ownerDocument.activeElement as HTMLButtonElement)
      const next = options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]
      next?.focus({ preventScroll: true })
      const list = next?.parentElement
      if (next && list) {
        if (next.offsetTop < list.scrollTop) list.scrollTop = next.offsetTop
        else if (next.offsetTop + next.offsetHeight > list.scrollTop + list.clientHeight) {
          list.scrollTop = next.offsetTop + next.offsetHeight - list.clientHeight
        }
      }
    }
  }}>
    <button ref={trigger} type="button" className="agent-select-trigger" aria-label={t('Agent')} aria-haspopup="listbox" aria-expanded={open} disabled={!agents.length} onClick={() => setOpen(!open)}>
      {selected && icon(selected)}<span>{selected?.name || t('Select an agent')}</span>{selected?.remote && <small className="agent-select-host">{selected.remote.host}</small>}<ChevronDown size={16} />
    </button>
    {open && <div className="agent-select-options" role="listbox" aria-label={t('Agent')}>
      {agents.map((agent) => <button type="button" role="option" aria-selected={agent.id === value} key={agent.id} onClick={() => { onChange(agent.id); setOpen(false); trigger.current?.focus({ preventScroll: true }) }}>
        {icon(agent)}<span>{agent.name}</span>{agent.remote && <small className="agent-select-host">{t('Remote')} · {agent.remote.host}</small>}{agent.id === value && <Check size={16} />}
      </button>)}
    </div>}
  </div>
}
