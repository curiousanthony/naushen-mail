import type { Message } from '@shared/types'
import { expandBundleTargets } from '../threadlist/bundleNav'

/** Pure list-cursor / selection maths (j/k, shift+arrows, target resolution). */

export interface CursorState {
  focusedId: string | null
  selectedIds: string[]
  openThreadId: string | null
}

/** Threads an action applies to: selection, else the open thread, else the keyboard cursor. */
export function targetIds(s: CursorState): string[] {
  // A collapsed inbox bundle (opt-in) stands for all of its members; otherwise this is the identity.
  if (s.selectedIds.length) return expandBundleTargets(s.selectedIds)
  if (s.openThreadId) return [s.openThreadId]
  return s.focusedId ? expandBundleTargets([s.focusedId]) : []
}

/** Move the cursor by `delta` rows (clamped). With no cursor, lands on the first/last row. */
export function moveFocus(ids: string[], focusedId: string | null, delta: number): string | null {
  if (!ids.length) return null
  const idx = focusedId ? ids.indexOf(focusedId) : -1
  if (idx === -1) return delta >= 0 ? ids[0] : ids[ids.length - 1]
  return ids[Math.max(0, Math.min(ids.length - 1, idx + delta))]
}

/**
 * shift+down / shift+up. Selection grows away from the anchor and shrinks when moving back
 * across already-selected rows (Finder / Gmail behaviour).
 */
export function extendSelection(ids: string[], focusedId: string | null, selectedIds: string[], delta: 1 | -1): { focusedId: string | null; selectedIds: string[] } {
  if (!ids.length) return { focusedId, selectedIds }
  const from = focusedId && ids.includes(focusedId) ? focusedId : ids[0]
  const next = moveFocus(ids, from, delta)!
  const sel = new Set(selectedIds)
  if (next === from) { sel.add(from); return { focusedId: from, selectedIds: [...sel] } }
  if (sel.has(from) && sel.has(next)) sel.delete(from) // moving back over the selection: shrink
  else { sel.add(from); sel.add(next) }
  // Keep list order for stable behaviour.
  return { focusedId: next, selectedIds: ids.filter((i) => sel.has(i)) }
}

/** The message a reply/forward/unsubscribe targets: the newest non-draft message. */
export function lastMessage(messages: Message[]): Message | undefined {
  const real = messages.filter((m) => !m.isDraft)
  const pool = real.length ? real : messages
  return pool.reduce<Message | undefined>((best, m) => (!best || m.date >= best.date ? m : best), undefined)
}

export type CheckState = 'on' | 'mixed' | 'off'

/** Whether all / some / none of the threads carry the label (label picker checkbox). */
export function checkState(threads: { labelIds: string[] }[], labelId: string): CheckState {
  if (!threads.length) return 'off'
  const n = threads.filter((t) => t.labelIds.includes(labelId)).length
  return n === 0 ? 'off' : n === threads.length ? 'on' : 'mixed'
}
