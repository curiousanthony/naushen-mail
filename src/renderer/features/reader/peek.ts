/**
 * Side-peek width: clamping and persistence.
 *
 * The width is a UI preference for this machine, not app data, so it lives in `localStorage`
 * rather than going through settings/IPC. Kept pure and separate so the clamping rules can be
 * unit-tested without a DOM.
 */

export const PEEK_STORAGE_KEY = 'mailroom.reader.peekWidth'

/** Narrow enough to sit beside a usable list, wide enough for a 600px newsletter. */
export const PEEK_MIN = 420
export const PEEK_DEFAULT = 620
/** The list must keep at least this much room, whatever the stored width says. */
export const LIST_MIN = 260

/**
 * Clamp a desired peek width to what the current window can actually accommodate.
 *
 * Clamping on *read* matters as much as on write: a width stored on a wide display would
 * otherwise strand the thread list off-screen when the same profile opens on a laptop.
 */
export function clampPeekWidth(desired: number, viewport: number): number {
  const max = Math.max(PEEK_MIN, viewport - LIST_MIN)
  if (!Number.isFinite(desired)) return Math.min(PEEK_DEFAULT, max)
  return Math.min(Math.max(Math.round(desired), PEEK_MIN), max)
}

/** Read the persisted width, clamped to this viewport. Never throws. */
export function loadPeekWidth(viewport: number): number {
  let stored = NaN
  try {
    const raw = localStorage.getItem(PEEK_STORAGE_KEY)
    if (raw !== null) stored = Number(raw)
  } catch {
    // Private mode / disabled storage: fall through to the default.
  }
  return clampPeekWidth(Number.isFinite(stored) ? stored : PEEK_DEFAULT, viewport)
}

/** Persist a width. Failures are not worth surfacing — the session still works. */
export function savePeekWidth(width: number): void {
  try {
    localStorage.setItem(PEEK_STORAGE_KEY, String(Math.round(width)))
  } catch {
    // ignore
  }
}
