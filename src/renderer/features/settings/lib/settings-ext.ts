import type { AppSettings } from '@shared/types'

/**
 * Settings fields owned by other branches that are not (yet) part of the shared `AppSettings`
 * contract. They are persisted through the normal `settings.set` path (the store keeps unknown
 * keys), and read back defensively here so a missing / malformed value falls back to a default.
 */
export type ThreadStyle = 'side' | 'center' | 'full'
export type AutoAdvance = 'next' | 'previous' | 'close'
export type Accent = 'blue' | 'violet' | 'pink' | 'orange' | 'green' | 'teal' | 'neutral'

export interface SettingsExt {
  threadStyle: ThreadStyle
  autoAdvance: AutoAdvance
  /** Append the signature to replies and forwards (not only new messages). */
  signatureInReplies: boolean
  /** Accent colour (design stream). Drives `data-accent` on <html>; see styles/accents.css. */
  accent: Accent
}

export const EXT_DEFAULTS: SettingsExt = { threadStyle: 'side', autoAdvance: 'next', signatureInReplies: true, accent: 'blue' }

export const THREAD_STYLES: readonly ThreadStyle[] = ['side', 'center', 'full']
export const ACCENT_VALUES: readonly Accent[] = ['blue', 'violet', 'pink', 'orange', 'green', 'teal', 'neutral']
export const AUTO_ADVANCE: readonly AutoAdvance[] = ['next', 'previous', 'close']

export function readExt(settings: AppSettings): SettingsExt {
  const raw = settings as unknown as Partial<Record<keyof SettingsExt, unknown>>
  return {
    threadStyle: THREAD_STYLES.includes(raw.threadStyle as ThreadStyle) ? (raw.threadStyle as ThreadStyle) : EXT_DEFAULTS.threadStyle,
    autoAdvance: AUTO_ADVANCE.includes(raw.autoAdvance as AutoAdvance) ? (raw.autoAdvance as AutoAdvance) : EXT_DEFAULTS.autoAdvance,
    signatureInReplies: typeof raw.signatureInReplies === 'boolean' ? raw.signatureInReplies : EXT_DEFAULTS.signatureInReplies,
    accent: ACCENT_VALUES.includes(raw.accent as Accent) ? (raw.accent as Accent) : EXT_DEFAULTS.accent
  }
}

/** Widen an extension patch to the store's `updateSettings` parameter type. */
export function extPatch(patch: Partial<SettingsExt>): Partial<AppSettings> {
  return patch as unknown as Partial<AppSettings>
}
