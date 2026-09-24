import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useApp, type Toast } from '@/lib/store'
import { Keys } from './Keycaps'
import './commands.css'

const LEAVE_MS = 160
const MAX_VISIBLE = 4
/** How long a toast that expired while hovered lingers after the pointer leaves. */
const GRACE_MS = 1200

interface Item { toast: Toast; state: 'in' | 'leaving'; orphan: boolean; held: boolean }

/**
 * Bottom-centre toast stack (mounted once by App.tsx). Adds to the store's timers: the store
 * removes toasts on schedule, so a toast that expires under the pointer is held here until the
 * pointer leaves ("pause on hover"), and removals play an exit animation.
 */
export function Toaster(): JSX.Element {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  const [items, setItems] = useState<Item[]>([])
  const [hovered, setHovered] = useState(false)
  const hoveredRef = useRef(false)
  hoveredRef.current = hovered
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const remove = (id: number): void => {
    timers.current.delete(id)
    setItems((xs) => xs.filter((x) => x.toast.id !== id))
  }
  const leave = (id: number, delay = 0): void => {
    if (timers.current.has(id)) return
    const t = setTimeout(() => {
      setItems((xs) => xs.map((x) => (x.toast.id === id ? { ...x, state: 'leaving' } : x)))
      timers.current.set(id, setTimeout(() => remove(id), LEAVE_MS))
    }, delay)
    timers.current.set(id, t)
  }

  // Reconcile store -> local items. A toast the store dropped becomes an "orphan" we may still hold.
  useEffect(() => {
    setItems((prev) => {
      const live = new Set(toasts.map((t) => t.id))
      const next: Item[] = prev.map((x) => (live.has(x.toast.id) ? { ...x, orphan: false } : x.state === 'leaving' || x.orphan ? x : { ...x, orphan: true, held: hoveredRef.current }))
      for (const t of toasts) if (!next.some((x) => x.toast.id === t.id)) next.push({ toast: t, state: 'in', orphan: false, held: false })
      return next
    })
  }, [toasts])

  // Orphans leave now, or (if they expired under the pointer) shortly after the pointer leaves.
  useEffect(() => {
    if (hovered) return
    for (const x of items) if (x.orphan && x.state === 'in') leave(x.toast.id, x.held ? GRACE_MS : 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, hovered])

  useEffect(() => () => { for (const t of timers.current.values()) clearTimeout(t) }, [])

  const close = (t: Toast): void => {
    setItems((xs) => xs.map((x) => (x.toast.id === t.id ? { ...x, state: 'leaving' } : x)))
    dismiss(t.id)
    const prev = timers.current.get(t.id); if (prev) clearTimeout(prev)
    timers.current.set(t.id, setTimeout(() => remove(t.id), LEAVE_MS))
  }

  const visible = items.slice(-MAX_VISIBLE)
  const newestUndo = [...visible].reverse().find((x) => x.state === 'in' && x.toast.actionLabel === 'Undo')?.toast.id

  return (
    <>
      <div className="cmd-toasts" role="region" aria-label="Notifications" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        {visible.map(({ toast, state }) => (
          <div key={toast.id} className={`cmd-toast cmd-toast--${state}`} role="status" aria-live="polite">
            <span className="cmd-toast__msg">{toast.message}</span>
            {toast.actionLabel && (
              <button className="cmd-toast__action" onClick={() => { toast.onAction?.(); close(toast) }}>
                {toast.actionLabel}
                {toast.id === newestUndo && <Keys binding="z" />}
              </button>
            )}
            <button className="cmd-toast__close" aria-label="Dismiss" onClick={() => close(toast)}><X size={14} strokeWidth={1.75} /></button>
          </div>
        ))}
      </div>
    </>
  )
}
