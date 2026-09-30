import type { AppSettings } from '@shared/types'
import { useApp } from '@/lib/store'
import { readExt, type Accent } from './settings-ext'

/** Settings -> the `data-*` attributes on <html> that tokens.css / accents.css / density.css key off. */
export function appearanceAttrs(settings: AppSettings): { density: string; accent: string | null } {
  const accent = readExt(settings).accent
  return {
    density: settings.density === 'compact' ? 'compact' : 'comfortable',
    // Blue is the base palette in tokens.css, so it needs no attribute.
    accent: accent === 'blue' ? null : accent
  }
}

export function applyAppearance(settings: AppSettings, root: HTMLElement = document.documentElement): void {
  const { density, accent } = appearanceAttrs(settings)
  root.dataset.density = density
  if (accent) root.dataset.accent = accent
  else delete root.dataset.accent
}

/** Mirror the persisted appearance settings onto <html>, now and whenever they change. Call once at boot. */
export function initAppearance(): void {
  applyAppearance(useApp.getState().settings)
  let last = ''
  useApp.subscribe((s) => {
    const { density, accent } = appearanceAttrs(s.settings)
    const key = `${density}/${accent}`
    if (key === last) return
    last = key
    applyAppearance(s.settings)
  })
}

/**
 * Swatches shown in Settings > Appearance; the preview colours are the `--sw-<name>` tokens in accents.css.
 * Names are translated as `settings:appearance.accents.<value>`.
 */
export const ACCENTS: { value: Accent }[] = [
  { value: 'blue' }, { value: 'violet' }, { value: 'pink' }, { value: 'orange' }, { value: 'green' }, { value: 'teal' }, { value: 'neutral' }
]
