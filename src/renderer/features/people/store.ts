import { create } from 'zustand'
import { getPersonInfo } from './data'

export interface AnchorRect { left: number; top: number; right: number; bottom: number }

export interface CardState {
  email: string
  name?: string
  rect: AnchorRect
  /** 'key' = opened with `i` (shows key hints, ignores mouse-out); 'hover' = pointer opened. */
  via: 'hover' | 'key'
}

interface PeopleUi {
  card: CardState | null
  open(c: CardState): void
  close(): void
}

export const usePeopleUi = create<PeopleUi>((set) => ({
  card: null,
  open: (card) => set({ card }),
  close: () => set({ card: null })
}))

/** Hover intent: long enough that sweeping the pointer over names never flashes a card. */
export const OPEN_DELAY_MS = 280
/** Grace between leaving the name and entering the card. */
export const CLOSE_DELAY_MS = 180

let openTimer: ReturnType<typeof setTimeout> | null = null
let closeTimer: ReturnType<typeof setTimeout> | null = null

export function cancelClose(): void { if (closeTimer) { clearTimeout(closeTimer); closeTimer = null } }
export function cancelOpen(): void { if (openTimer) { clearTimeout(openTimer); openTimer = null } }

/** Pointer entered a sender name: prefetch now, open after the intent delay. */
export function hoverEnter(el: HTMLElement, email: string, name?: string): void {
  cancelClose()
  void getPersonInfo(email).catch(() => undefined)
  const cur = usePeopleUi.getState().card
  if (cur && cur.email.toLowerCase() === email.toLowerCase()) return
  cancelOpen()
  openTimer = setTimeout(() => {
    openTimer = null
    if (!el.isConnected) return
    const r = el.getBoundingClientRect()
    usePeopleUi.getState().open({ email, name, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, via: 'hover' })
  }, cur ? 80 : OPEN_DELAY_MS)
}

/** Pointer left the name or the card: close shortly, unless it comes back / card was opened by key. */
export function hoverLeave(): void {
  cancelOpen()
  cancelClose()
  closeTimer = setTimeout(() => {
    closeTimer = null
    if (usePeopleUi.getState().card?.via === 'hover') usePeopleUi.getState().close()
  }, CLOSE_DELAY_MS)
}
