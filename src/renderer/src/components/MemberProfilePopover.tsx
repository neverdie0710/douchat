import { useLayoutEffect, useRef, useState, type ReactNode, type ReactElement } from 'react'
import { t } from '../preferences'

export type ProfileAnchor = { left: number; right: number; top: number }

export function MemberProfilePopover({ anchor, onClose, children }: {
  anchor: ProfileAnchor
  onClose: () => void
  children: ReactNode
}): ReactElement {
  const panel = useRef<HTMLElement>(null)
  const [position, setPosition] = useState({ left: 12, top: 12 })
  useLayoutEffect(() => {
    const place = (): void => {
      if (!panel.current) return
      const { width, height } = panel.current.getBoundingClientRect()
      const leftSide = anchor.left - width - 12
      const preferredLeft = leftSide >= 12 ? leftSide : anchor.right + 12
      setPosition({
        left: Math.max(12, Math.min(preferredLeft, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(anchor.top, window.innerHeight - height - 12))
      })
    }
    place()
    const observer = new ResizeObserver(place)
    if (panel.current) observer.observe(panel.current)
    window.addEventListener('resize', place)
    return () => { observer.disconnect(); window.removeEventListener('resize', place) }
  }, [anchor])
  return <div className="modal-backdrop member-profile-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={panel} style={position} className="agent-modal member-profile-modal" role="dialog" aria-modal="true" aria-label={t('Contact details')}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      {children}
    </section>
  </div>
}
