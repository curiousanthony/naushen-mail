import type { Address } from '@shared/types'
import { useApp } from '@/lib/store'

/** Compose a new message to one person (in the current account, or the first one under "All"). */
export function composeTo(a: Address): void {
  const s = useApp.getState()
  if (s.overlay) s.setOverlay(null)
  s.openComposer({ mode: 'new', init: { to: [{ email: a.email, name: a.name }] } })
}

/** Every conversation with this address: the regular search, `from:` operator. */
export function allMailFrom(email: string): void {
  const s = useApp.getState()
  if (s.overlay) s.setOverlay(null)
  s.setNav({ kind: 'search', text: `from:${email}` })
}

export async function copyAddress(email: string): Promise<void> {
  try { await navigator.clipboard.writeText(email) } catch { /* clipboard blocked: still confirm nothing false */ return }
  useApp.getState().toast({ message: 'Address copied', duration: 1800 })
}
