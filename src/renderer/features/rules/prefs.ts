/**
 * Preferences owned by this feature, persisted through the normal settings path (`settings.set`
 * keeps unknown keys) and read back defensively — same pattern as settings/lib/settings-ext.ts.
 *
 *   bundles            opt-in inbox bundles (default none, so nothing surprising happens)
 *   showAccountMarker  tiny account-colour dot on rows when viewing All accounts (default on)
 */
import type { AppSettings } from '@shared/types'
import { bundleId, type BundleDef } from '../threadlist/bundles'

export function readBundles(settings: AppSettings): BundleDef[] {
  const raw = (settings as unknown as { bundles?: unknown }).bundles
  if (!Array.isArray(raw)) return []
  const out: BundleDef[] = []
  for (const b of raw as Partial<BundleDef>[]) {
    if (!b || (b.kind !== 'label' && b.kind !== 'sender') || typeof b.match !== 'string' || !b.match.trim()) continue
    const match = b.match.trim().toLowerCase()
    const id = bundleId(b.kind, match)
    if (out.some((x) => x.id === id)) continue
    out.push({ id, kind: b.kind, match, name: typeof b.name === 'string' && b.name.trim() ? b.name.trim() : match })
  }
  return out
}

export function readAccountMarker(settings: AppSettings): boolean {
  const v = (settings as unknown as { showAccountMarker?: unknown }).showAccountMarker
  return typeof v === 'boolean' ? v : true
}

export const bundlesPatch = (bundles: BundleDef[]): Partial<AppSettings> => ({ bundles } as unknown as Partial<AppSettings>)
export const accountMarkerPatch = (on: boolean): Partial<AppSettings> => ({ showAccountMarker: on } as unknown as Partial<AppSettings>)

/** Add the bundle when absent, remove it when present. Pure. */
export function toggleBundle(defs: BundleDef[], kind: BundleDef['kind'], match: string, name: string): BundleDef[] {
  const id = bundleId(kind, match)
  return defs.some((d) => d.id === id)
    ? defs.filter((d) => d.id !== id)
    : [...defs, { id, kind, match: match.trim().toLowerCase(), name }]
}

export const isBundled = (defs: BundleDef[], kind: BundleDef['kind'], match: string): boolean =>
  defs.some((d) => d.id === bundleId(kind, match))
