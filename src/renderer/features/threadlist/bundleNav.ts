/**
 * The seam between the bundled list and the keyboard. ThreadList publishes what it is showing
 * (`publishBundleNav`); the commands feature reads it so j/k stop on a collapsed bundle instead of
 * on hidden members, `e` on a collapsed bundle acts on every member, Enter expands it and Esc folds
 * it back. With no bundles published every function is the identity, so nothing changes.
 *
 * No React and no store imports: `commands/selection.ts` (pure, unit-tested) calls into here.
 */
import { create } from 'zustand'
import type { BundleNavState } from './bundles'

/** Which bundles are open. Session-only on purpose: a fresh launch is calm and collapsed. */
export const useBundleUi = create<{
  expanded: Record<string, boolean>
  toggle(id: string, open?: boolean): void
}>((set) => ({
  expanded: {},
  toggle: (id, open) => set((s) => ({ expanded: { ...s.expanded, [id]: open ?? !s.expanded[id] } }))
}))

let state: BundleNavState | null = null

export function publishBundleNav(next: BundleNavState | null): void { state = next }

/**
 * j/k: the list of stops and the cursor to move from — one stop per collapsed bundle (the cursor
 * may sit on any member of it). Pass the result to `moveFocus`.
 */
export function bundleStops(ids: string[], focusedId: string | null): { ids: string[]; focusedId: string | null } {
  if (!state) return { ids, focusedId }
  return { ids: state.order, focusedId: focusedId ? (state.rep.get(focusedId) ?? focusedId) : null }
}

/** Targets of an action: a member of a collapsed bundle stands for the whole bundle. */
export function expandBundleTargets(ids: string[]): string[] {
  if (!state || state.collapsed.size === 0) return ids
  const out: string[] = []
  for (const id of ids) for (const m of state.collapsed.get(id) ?? [id]) if (!out.includes(m)) out.push(m)
  return out
}

/** Enter on a collapsed bundle opens it. True when that is what happened (so Enter is consumed). */
export function expandBundleAt(id: string | null): boolean {
  if (!state || !id || !state.collapsed.has(id)) return false
  const key = state.keyOf.get(id)
  if (!key) return false
  useBundleUi.getState().toggle(key, true)
  return true
}

/** Esc inside an open bundle folds it. True when a bundle was folded. */
export function collapseBundleAt(id: string | null): boolean {
  if (!state || !id) return false
  const key = state.keyOf.get(id)
  if (!key || !useBundleUi.getState().expanded[key]) return false
  useBundleUi.getState().toggle(key, false)
  return true
}
