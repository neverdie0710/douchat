import { Bot, Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { LocalAgent } from '../../../shared/types'
import { agentIcons } from '../agentIcons'
import { t } from '../preferences'

export function LocalAgentSelect({ agents, value, onChange }: { agents: LocalAgent[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const selected = agents.find((agent) => agent.id === value)
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent): void => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', dismiss)
    const option = root.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')
      ?? root.current?.querySelector<HTMLButtonElement>('[role="option"]')
    option?.focus()
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])
  const icon = (agent: LocalAgent) => <span className="agent-select-logo" data-agent={agent.id}>{agentIcons[agent.id] ? <img src={agentIcons[agent.id]} alt="" /> : <Bot size={18} />}</span>
  return <div className="agent-select" ref={root} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }} onKeyDown={(event) => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus() }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) { setOpen(true); return }
      const options = Array.from(root.current!.querySelectorAll<HTMLButtonElement>('[role="option"]'))
      const index = options.indexOf(document.activeElement as HTMLButtonElement)
      options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus()
    }
  }}>
    <button ref={trigger} type="button" className="agent-select-trigger" aria-label={t('Local proxy')} aria-haspopup="listbox" aria-expanded={open} disabled={!agents.length} onClick={() => setOpen(!open)}>
      {selected && icon(selected)}<span>{selected?.name || t('Select a local proxy')}</span><ChevronDown size={16} />
    </button>
    {open && <div className="agent-select-options" role="listbox" aria-label={t('Local proxy')}>
      {agents.map((agent) => <button type="button" role="option" aria-selected={agent.id === value} key={agent.id} onClick={() => { onChange(agent.id); setOpen(false); trigger.current?.focus() }}>
        {icon(agent)}<span>{agent.name}</span>{agent.id === value && <Check size={16} />}
      </button>)}
    </div>}
  </div>
}
