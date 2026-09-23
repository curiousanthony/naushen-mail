import { create } from 'zustand'
import { useApp } from '@/lib/store'

interface ViewEditorState {
  /** Id of the view being edited, or null when creating a new one. */
  viewId: string | null
  open(viewId: string | null): void
  close(): void
}

/**
 * Which view the 'view-editor' overlay is editing. Kept beside the sidebar rather than in the
 * app store so the shared overlay contract (`setOverlay`) stays untouched.
 */
export const useViewEditor = create<ViewEditorState>((set) => ({
  viewId: null,
  open(viewId) { set({ viewId }); useApp.getState().setOverlay('view-editor') },
  close() {
    set({ viewId: null })
    if (useApp.getState().overlay === 'view-editor') useApp.getState().setOverlay(null)
  }
}))
