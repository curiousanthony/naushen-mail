import { useEffect } from 'react'
import { useApp } from '@/lib/store'
import { KeyMatcher, eventToCombo, isEditableElement, normalizeBinding } from './keys'
import { SHORTCUTS, activeBindings, isGlobalBinding } from './shortcuts'
import { MENU_COMMANDS, runCommand } from './runner'
import { useCommandUi } from './ui-store'

const isMac = (): boolean => (typeof navigator !== 'undefined' ? /mac/i.test(navigator.platform || navigator.userAgent) : true)

/** Overlays that must keep single-key shortcuts from leaking through. */
const PASS_THROUGH_WHEN_OVERLAY = new Set(['ui.palette', 'ui.help', 'nav.back'])

/**
 * Installs the app-wide keyboard handler (table-driven, see shortcuts.ts) and the native menu
 * command bridge. Mount once (App.tsx does).
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const matcher = new KeyMatcher(activeBindings())
    const mac = isMac()
    let hintTimer: ReturnType<typeof setTimeout> | null = null
    let lastHandled: { id: string; at: number } | null = null

    const clearHint = (): void => {
      if (hintTimer) { clearTimeout(hintTimer); hintTimer = null }
      matcher.reset()
      useCommandUi.getState().setHint(null)
    }
    const showHint = (prefix: string[]): void => {
      const labels = new Map(SHORTCUTS.map((s) => [s.id, s.label]))
      useCommandUi.getState().setHint({ prefix, options: matcher.continuations().map((c) => ({ keys: c.keys, label: labels.get(c.id) ?? c.id })) })
      if (hintTimer) clearTimeout(hintTimer)
      hintTimer = setTimeout(clearHint, 1500)
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) return
      const combo = eventToCombo(e, mac)
      if (!combo) return
      const overlay = useApp.getState().overlay
      const editable = isEditableElement(e.target as HTMLElement | null)

      if (editable) {
        // Typing surfaces own their keys. Only global modifier combos and "esc closes the overlay" pass.
        if (combo === 'esc' && overlay) { e.preventDefault(); useApp.getState().setOverlay(null); clearHint(); return }
        const id = matcherLookup(combo)
        if (id && isGlobalBinding(id) && !(overlay && !PASS_THROUGH_WHEN_OVERLAY.has(id))) {
          e.preventDefault(); lastHandled = { id, at: Date.now() }; runCommand(id, { combo })
        }
        return
      }

      const res = matcher.feed(combo, Date.now())
      if (res.kind === 'none') return
      if (res.kind === 'pending') {
        if (overlay) { clearHint(); return }
        e.preventDefault(); showHint(res.prefix); return
      }
      e.preventDefault()
      if (res.kind === 'cancel') { clearHint(); return }
      clearHint()
      if (overlay && !PASS_THROUGH_WHEN_OVERLAY.has(res.id) && !isGlobalBinding(res.id)) return
      lastHandled = { id: res.id, at: Date.now() }
      runCommand(res.id, { combo })
    }

    const lookup = new Map(activeBindings().map((b) => [normalizeBinding(b.binding), b.id]))
    function matcherLookup(combo: string): string | undefined { return lookup.get(combo) }

    window.addEventListener('keydown', onKeyDown)
    const offMenu = window.api.onMenuCommand((cmd) => {
      const id = MENU_COMMANDS[cmd]
      if (!id) return
      // A menu accelerator and the key handler can both see the same Cmd+K; run only once.
      if (lastHandled && lastHandled.id === id && Date.now() - lastHandled.at < 250) return
      runCommand(id)
    })
    const onBlur = (): void => clearHint()
    window.addEventListener('blur', onBlur)
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('blur', onBlur); offMenu(); clearHint() }
  }, [])
}
