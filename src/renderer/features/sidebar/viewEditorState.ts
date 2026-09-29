import { create } from 'zustand'
import type { SystemRole } from '@shared/types'
import { useApp } from '@/lib/store'

/** Prefills a brand-new view from wherever it was started -- currently only "Save as view" from
 *  the thread list's filter chips (see threadlist/FilterBar.tsx). Ignored when editing an
 *  existing view (its own saved filter always wins). */
export interface ViewSeed {
  accountId?: string
  role?: SystemRole | 'any'
  labelIds?: string[]
  from?: string
  unread?: boolean
  attachment?: boolean
}

interface ViewEditorState {
  /** Id of the view being edited, or null when creating a new one. */
  viewId: string | null
  seed: ViewSeed | null
  open(viewId: string | null, seed?: ViewSeed): void
  close(): void
}

/**
 * Which view the 'view-editor' overlay is editing. Kept beside the sidebar rather than in the
 * app store so the shared overlay contract (`setOverlay`) stays untouched.
 */
export const useViewEditor = create<ViewEditorState>((set) => ({
  viewId: null,
  seed: null,
  open(viewId, seed) { set({ viewId, seed: seed ?? null }); useApp.getState().setOverlay('view-editor') },
  close() {
    set({ viewId: null, seed: null })
    if (useApp.getState().overlay === 'view-editor') useApp.getState().setOverlay(null)
  }
}))
