import { useEffect, useRef, type DragEvent } from 'react'
import { create } from 'zustand'
import type { Thread } from '@shared/types'
import i18n from '@/i18n'
import { useApp } from '@/lib/store'
import { moveThreads } from './move'
import { destKey, planMove, type Dest } from './plan'

/**
 * Drag & drop of conversations onto sidebar folders / labels.
 *
 * The payload lives in a store, not in `dataTransfer`: browsers hide `getData` until drop, but
 * a drop target has to know *during* dragover whether it may accept (and highlight). The
 * dataTransfer still carries a plain-text fallback so dragging out to other apps is harmless.
 */

export const DRAG_MIME = 'application/x-naushen-threads'

interface DragState {
  /** Threads being dragged, null when idle. */
  threads: Thread[] | null
  /** Key of the drop target under the cursor. */
  over: string | null
  begin(threads: Thread[]): void
  setOver(key: string | null): void
  end(): void
}

export const useDrag = create<DragState>((set) => ({
  threads: null,
  over: null,
  begin: (threads) => set({ threads, over: null }),
  setOver: (over) => set({ over }),
  end: () => set({ threads: null, over: null })
}))

/** What a drag starting on `row` carries: the whole selection when the row is part of it. */
export function dragPayload(row: Thread, selectedIds: string[], all: Thread[]): Thread[] {
  if (selectedIds.length > 1 && selectedIds.includes(row.id)) {
    const sel = new Set(selectedIds)
    return all.filter((t) => sel.has(t.id))
  }
  return [row]
}

const noun = (n: number): string => i18n.t('gestures:drag.conversations', { count: n })

/** Small pill shown under the cursor while dragging ("3 conversations"). */
function makeGhost(threads: Thread[]): HTMLElement {
  const el = document.createElement('div')
  el.className = 'dragghost'
  const first = threads[0]
  el.innerHTML = '<span class="dragghost__icon"></span><span class="dragghost__text"></span>'
  const text = el.querySelector('.dragghost__text')!
  text.textContent = threads.length === 1 ? (first.subject || i18n.t('common:noSubject')) : noun(threads.length)
  if (threads.length > 1) el.dataset.stack = String(Math.min(threads.length, 3))
  document.body.appendChild(el)
  return el
}

/** Call from a row's `dragstart`. Returns false if the drag was refused. */
export function startThreadDrag(e: DragEvent, threads: Thread[]): boolean {
  if (!threads.length) { e.preventDefault(); return false }
  const dt = e.dataTransfer
  dt.effectAllowed = 'move'
  dt.setData(DRAG_MIME, JSON.stringify(threads.map((t) => t.id)))
  dt.setData('text/plain', noun(threads.length))
  const ghost = makeGhost(threads)
  dt.setDragImage(ghost, 14, 16)
  // The browser snapshots the element synchronously; remove it next tick.
  setTimeout(() => ghost.remove(), 0)
  // Dim the dragged rows (imperative: rows are memoised and must not re-render per drag).
  for (const t of threads) document.getElementById(`trow-${t.id}`)?.setAttribute('data-dragging', 'true')
  useDrag.getState().begin(threads)
  return true
}

export function endThreadDrag(): void {
  document.querySelectorAll('[data-dragging="true"]').forEach((n) => n.removeAttribute('data-dragging'))
  useDrag.getState().end()
}

export type DropState = 'ready' | 'over' | 'refuse' | undefined

/** Hover time (ms) before a collapsed group opens itself under a dragged item. */
export const SPRING_LOAD_MS = 650

/**
 * Props to spread on a sidebar row to make it a drop target. `dest` null = not a target.
 * `state` is what to render: 'ready' (a drag is in flight and this row would accept),
 * 'over' (cursor on it and it would accept), 'refuse' (cursor on it, nothing to do here).
 */
export function useDropTarget(dest: Dest | null): { props: Record<string, unknown>; state: DropState } {
  const threads = useDrag((s) => s.threads)
  const over = useDrag((s) => s.over)
  const depth = useRef(0)
  const key = dest ? destKey(dest) : ''
  const plan = (): number => {
    if (!dest || !threads) return 0
    const s = useApp.getState()
    return planMove(threads, dest, s.labels, s.nav.kind === 'role' ? s.nav.role : null).apply.length
  }
  const can = !!dest && !!threads && plan() > 0
  const state: DropState = !dest || !threads ? undefined : over === key ? (can ? 'over' : 'refuse') : can ? 'ready' : undefined

  if (!dest) return { props: {}, state: undefined }

  const props = {
    onDragEnter: (e: DragEvent): void => {
      if (!useDrag.getState().threads) return
      e.preventDefault()
      depth.current++
      useDrag.getState().setOver(key)
    },
    onDragOver: (e: DragEvent): void => {
      const cur = useDrag.getState().threads
      if (!cur) return
      const s = useApp.getState()
      const ok = planMove(cur, dest, s.labels, s.nav.kind === 'role' ? s.nav.role : null).apply.length > 0
      // preventDefault marks the target droppable; without it the cursor shows "not allowed".
      if (ok) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } else e.dataTransfer.dropEffect = 'none'
      if (useDrag.getState().over !== key) useDrag.getState().setOver(key)
    },
    onDragLeave: (): void => {
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0 && useDrag.getState().over === key) useDrag.getState().setOver(null)
    },
    onDrop: (e: DragEvent): void => {
      const cur = useDrag.getState().threads
      depth.current = 0
      if (!cur) return
      e.preventDefault()
      endThreadDrag()
      void moveThreads(cur, dest)
    }
  }
  return { props, state }
}

/**
 * Spring-loaded sections: hold a dragged conversation over a collapsed section's header and it
 * opens (like Finder folders), so a label tucked under a collapsed "Labels" is still reachable.
 * Spread the returned props on the header; `dragging` is true while a drag is in flight.
 */
export function useSpringLoad(collapsed: boolean, open: () => void): { props: Record<string, unknown>; dragging: boolean } {
  const dragging = useDrag((s) => !!s.threads)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const opened = useRef(false) // this drag sprang the section open: close it again afterwards

  const clear = (): void => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  useEffect(() => clear, [])
  useEffect(() => {
    if (dragging) return undefined
    clear()
    if (!opened.current) return undefined
    opened.current = false
    const t = setTimeout(open, 400) // Finder-style: a spring-loaded folder closes again after the drop
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging])
  const props = {
    onDragEnter: (e: DragEvent): void => {
      if (!collapsed || !useDrag.getState().threads) return
      e.preventDefault()
      clear()

      timer.current = setTimeout(() => { timer.current = null; opened.current = true; open() }, SPRING_LOAD_MS)
    },
    onDragOver: (e: DragEvent): void => { if (collapsed && useDrag.getState().threads) e.preventDefault() },
    onDragLeave: clear
  }
  return { props, dragging }
}
