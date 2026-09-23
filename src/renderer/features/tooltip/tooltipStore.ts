import { create } from 'zustand'
import { isWarm, SHOW_DELAY_MS } from './position'

interface TooltipState {
  visible: boolean
  /** The live trigger element, not a snapshot rect — <TooltipHost/> re-measures it on show (and
   *  polls `.isConnected`), since a trigger like "Archive" or "Close" unmounts itself on click,
   *  after which mouseleave never fires. */
  anchorEl: Element | null
  label: string
  shortcut?: string
  /** When the tooltip system last hid something — drives the "warm" instant-show window. */
  lastHideAt: number | null
  scheduleShow(anchorEl: Element, label: string, shortcut?: string): void
  hide(): void
}

// Module-level, not store state: a pending timer isn't UI state and shouldn't trigger renders.
let showTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Single global tooltip store backing the one <TooltipHost/> DOM node mounted in App.tsx.
 * `<Tooltip/>` wrappers call `scheduleShow`/`hide` directly (via `getState()`) instead of each
 * owning their own timer/DOM node, so wrapping hundreds of icon buttons across the app stays
 * cheap — see docs/00-decisions.md-style rationale in tooltip/Tooltip.tsx.
 */
export const useTooltipStore = create<TooltipState>((set, get) => ({
  visible: false,
  anchorEl: null,
  label: '',
  shortcut: undefined,
  lastHideAt: null,

  scheduleShow(anchorEl, label, shortcut) {
    if (showTimer) { clearTimeout(showTimer); showTimer = null }
    const apply = (): void => set({ visible: true, anchorEl, label, shortcut })
    if (isWarm(get().lastHideAt, Date.now())) apply()
    else showTimer = setTimeout(apply, SHOW_DELAY_MS)
  },

  hide() {
    if (showTimer) { clearTimeout(showTimer); showTimer = null }
    // Only a tooltip that actually showed leaves the system "warm" — a hover that never made it
    // past the delay (or a scroll event firing hide() on every tick) shouldn't grant the next,
    // unrelated hover an instant show.
    set((s) => (s.visible ? { visible: false, anchorEl: null, shortcut: undefined, lastHideAt: Date.now() } : s))
  }
}))
