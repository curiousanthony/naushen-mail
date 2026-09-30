import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  AlarmClock, Archive, BellOff, FolderInput, Inbox, Mail, MailOpen, ShieldAlert, Star, Tag, Trash2, type LucideIcon
} from 'lucide-react'
import type { RowMenuItem } from './menuItems'

const ICONS: Record<string, LucideIcon> = {
  archive: Archive, inbox: Inbox, mail: Mail, 'mail-open': MailOpen, star: Star, clock: AlarmClock,
  tag: Tag, folder: FolderInput, 'bell-off': BellOff, spam: ShieldAlert, trash: Trash2
}

export interface RowMenuProps {
  x: number
  y: number
  items: RowMenuItem[]
  label: string
  onPick(item: RowMenuItem): void
  onClose(): void
}

/**
 * Right-click menu for a conversation row. Keyboard: Up/Down/Home/End move, Enter/Space run,
 * Esc / Tab / outside click / scroll close. It only reports the pick; the list runs the command.
 */
export function RowMenu({ x, y, items, label, onPick, onClose }: RowMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [active, setActive] = useState(0)

  // Keep the menu inside the window (flip up / left when it would overflow).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8))
    })
    el.focus()
  }, [x, y])

  useEffect(() => {
    const down = (e: PointerEvent): void => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const away = (): void => onClose()
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('blur', away)
    window.addEventListener('resize', away)
    window.addEventListener('wheel', away, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('blur', away)
      window.removeEventListener('resize', away)
      window.removeEventListener('wheel', away)
    }
  }, [onClose])

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const n = items.length
    const stop = (): void => { e.preventDefault(); e.stopPropagation() }
    switch (e.key) {
      case 'ArrowDown': stop(); setActive((i) => (i + 1) % n); break
      case 'ArrowUp': stop(); setActive((i) => (i - 1 + n) % n); break
      case 'Home': stop(); setActive(0); break
      case 'End': stop(); setActive(n - 1); break
      case 'Enter': case ' ': stop(); onPick(items[active]); break
      case 'Escape': case 'Tab': stop(); onClose(); break
      default: stop() // swallow single-key shortcuts while the menu is up
    }
  }

  return (
    <div
      ref={ref} className="rmenu" role="menu" aria-label={label} tabIndex={-1}
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}
      aria-activedescendant={`rmenu-${items[active]?.id}`}
    >
      {items.map((it, i) => {
        const Icon = ICONS[it.icon] ?? Archive
        return (
          <div key={it.id}>
            {it.sep && <div className="rmenu__sep" role="separator" />}
            <button
              id={`rmenu-${it.id}`} data-i={i} role="menuitem" tabIndex={-1}
              className="rmenu__item" data-active={i === active} data-danger={it.danger || undefined}
              onMouseEnter={() => setActive(i)} onClick={() => onPick(it)}
            >
              <Icon size={15} className="rmenu__icon" />
              <span className="rmenu__label">{it.label}</span>
              {it.shortcut && <kbd className="rmenu__kbd" aria-hidden>{it.shortcut}</kbd>}
            </button>
          </div>
        )
      })}
    </div>
  )
}
