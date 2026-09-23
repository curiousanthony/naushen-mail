import { create } from 'zustand'
import { useApp } from '@/lib/store'

/** Ephemeral UI state owned by the commands feature (kept out of the shared app store). */
export interface KeyHint {
  prefix: string[]
  options: { keys: string; label: string }[]
}

interface CommandUi {
  paletteMode: 'commands' | 'search'
  paletteInitial: string
  /** Bumped on every open so the palette remounts with a clean query. */
  paletteSeq: number
  hint: KeyHint | null
  openPalette(mode?: 'commands' | 'search', initial?: string): void
  setHint(h: KeyHint | null): void
}

export const useCommandUi = create<CommandUi>((set) => ({
  paletteMode: 'commands', paletteInitial: '', paletteSeq: 0, hint: null,
  openPalette(mode = 'commands', initial = '') {
    set((s) => ({ paletteMode: mode, paletteInitial: initial, paletteSeq: s.paletteSeq + 1 }))
    useApp.getState().setOverlay('palette')
  },
  setHint(hint) { set({ hint }) }
}))
