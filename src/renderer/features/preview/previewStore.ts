import { create } from 'zustand'
import { SHOW_DELAY_MS } from './position'

interface PreviewState {
  visible: boolean
  /** The thread currently hovered/previewed. Set as soon as the hover starts (before the show
   *  delay elapses), so the pending timer always shows the right thread at the right cursor
   *  position even if the mouse kept moving during the delay. */
  threadId: string | null
  x: number
  /** Set once, from the row's own bounding rect, when the hover starts — and never touched by
   *  `updateCursor`. The card tracks the cursor left/right only, the way Notion Mail's did; it
   *  never bobs up and down as the mouse moves within a row (see Row.tsx's onRowMouseEnter). */
  y: number
  /** Hover a thread row: (re)arms the show timer for it and records the starting position. Safe
   *  to call repeatedly from mouseenter — a hover on a different row cancels any pending one first. */
  scheduleShow(threadId: string, x: number, y: number): void
  /** Cursor moved horizontally while still hovering `threadId` — updates x only (and, once
   *  visible, makes the card track the cursor left/right). A stale call for a row that's no
   *  longer the active hover is a no-op, which matters once a row can keep sending events after
   *  it stopped being "current". */
  updateCursor(threadId: string, x: number): void
  /** Hides the preview. With a `threadId`, only hides if that thread is the one currently shown
   *  or pending — used from a row's unmount/mouseleave so a stale event can't clobber a preview
   *  that has already moved on to a different row. */
  hide(threadId?: string): void
}

// Module-level, not store state: a pending timer isn't UI state and shouldn't trigger renders.
let showTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Single global store backing the one <PreviewHost/> DOM node mounted at the app root. Thread
 * rows call `scheduleShow`/`updateCursor`/`hide` directly (via `getState()`) instead of each
 * owning a timer or DOM node — same "one floating UI singleton driven by many triggers" pattern
 * as the tooltip system (see features/tooltip/tooltipStore.ts), but this is its own store: the
 * preview tracks the live cursor position rather than anchoring to a fixed trigger rect.
 *
 * Deliberately holds only `threadId`, not a snapshot of the thread — <PreviewHost/> looks the
 * thread up live from the thread-list store, so the card always reflects current data (e.g. a
 * star toggled while the preview is open) without this store needing to know about threads.
 */
export const usePreviewStore = create<PreviewState>((set, get) => ({
  visible: false,
  threadId: null,
  x: 0,
  y: 0,

  scheduleShow(threadId, x, y) {
    if (showTimer) { clearTimeout(showTimer); showTimer = null }
    set({ visible: false, threadId, x, y })
    showTimer = setTimeout(() => {
      showTimer = null
      // Only show if this row is still the one being hovered — a fast pass across several rows
      // shouldn't pop a preview for one the cursor already left.
      if (get().threadId === threadId) set({ visible: true })
    }, SHOW_DELAY_MS)
  },

  updateCursor(threadId, x) {
    if (get().threadId !== threadId) return
    set({ x })
  },

  hide(threadId) {
    if (threadId !== undefined && get().threadId !== threadId) return
    if (showTimer) { clearTimeout(showTimer); showTimer = null }
    set((s) => (s.visible || s.threadId ? { visible: false, threadId: null } : s))
  }
}))
