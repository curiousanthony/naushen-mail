import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Modal shell shared by the palette and the pickers: scrim, centred panel, click-outside to
 * close, focus restore. Esc is handled globally (useGlobalShortcuts) so it also works while an
 * input has focus.
 */
export function Overlay({ onClose, children, width, top = '14vh', label, className = '' }: {
  onClose: () => void
  children: ReactNode
  width: number
  top?: string
  label: string
  className?: string
}): JSX.Element {
  const prev = useRef<Element | null>(null)
  useEffect(() => {
    prev.current = document.activeElement
    return () => {
      const el = prev.current as HTMLElement | null
      if (el && document.contains(el) && typeof el.focus === 'function') el.focus({ preventScroll: true })
    }
  }, [])
  return (
    <div className="cmd-scrim no-drag" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`cmd-panel ${className}`} style={{ width, marginTop: top, maxHeight: `calc(100vh - ${top} - 24px)` }} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  )
}
