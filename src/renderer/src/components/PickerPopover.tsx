import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'

/**
 * A one-line selector that opens a larger picker below it, such as the
 * two-column harness and model pickers. `children` gets `close` to call once
 * a choice is final. Escape and a click outside close it too.
 */
export function PickerPopover({ label, trigger, disabled, children }: {
  label: string
  trigger: ReactNode
  disabled?: boolean
  children: (close: () => void) => ReactNode
}): ReactElement {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const close = (): void => { setOpen(false); button.current?.focus({ preventScroll: true }) }
  useEffect(() => {
    if (!open) return
    const doc = root.current!.ownerDocument
    const dismiss = (event: PointerEvent): void => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    doc.addEventListener('pointerdown', dismiss)
    return () => doc.removeEventListener('pointerdown', dismiss)
  }, [open])
  return <div className="agent-select picker-popover" ref={root} onKeyDown={(event) => {
    // Escape closes only the picker, not the dialog around it.
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close() }
  }}>
    <button ref={button} type="button" className="agent-select-trigger" aria-label={label} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen(value => !value)}>
      {trigger}<ChevronDown size={16} />
    </button>
    {open && <div className="picker-popover-panel" role="dialog" aria-label={label}>{children(close)}</div>}
  </div>
}
