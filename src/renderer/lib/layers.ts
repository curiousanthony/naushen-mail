import { create } from 'zustand'

/**
 * Which floating surface was touched last: the centred reader (`'reader'`) or a composer window
 * (its id). Whatever the user clicked sits on top; clicking the other brings it back above.
 */
export const useLayers = create<{ top: string | null; raise(id: string): void }>((set) => ({
  top: null,
  raise: (id) => set((s) => (s.top === id ? s : { top: id }))
}))
