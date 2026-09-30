import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])'
].join(', ')

/** Focusable descendants of `container`, in DOM (tab) order, skipping hidden ones. */
export function focusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true')
}

/**
 * Where a Tab/Shift+Tab press should send focus to keep it inside `container`: wraps from the
 * last focusable element back to the first (and vice versa for Shift+Tab), and pulls focus back
 * in if it has somehow landed outside the container. Returns null when the browser's default
 * Tab handling already keeps focus inside (an interior element, or nothing focusable at all) —
 * the caller should only `preventDefault()` when this returns an element.
 */
export function handleTrapTab(container: HTMLElement, shiftKey: boolean, active: Element | null): HTMLElement | null {
  const els = focusables(container)
  if (!els.length) return null
  const first = els[0]
  const last = els[els.length - 1]
  const inside = active instanceof Node && container.contains(active)
  if (shiftKey) return (!inside || active === first) ? last : null
  return (!inside || active === last) ? first : null
}

/**
 * Traps Tab/Shift+Tab within `containerRef` for as long as the component using it is mounted:
 * focuses the first focusable element (or the container itself) on mount, keeps Tab cycling
 * inside the container, and restores focus to whatever was focused before mounting when it
 * unmounts. Pass `onEscape` to close on Esc regardless of where focus is. Mount/unmount the caller with the dialog's own open state (as `SettingsDialog`
 * already does) rather than passing a changing `active` flag.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, onEscape?: () => void): void {
  const escRef = useRef(onEscape)
  escRef.current = onEscape
  useEffect(() => {
    const container = containerRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null
    const first = container ? focusables(container)[0] : undefined
    ;(first ?? container)?.focus({ preventScroll: true })

    const onKeyDown = (e: KeyboardEvent): void => {
      // Esc closes the dialog wherever focus is (even if it drifted to <body> after a click on plain
      // text); captured on the document so the global "esc backs out" handler never sees it.
      if (e.key === 'Escape' && escRef.current && !e.defaultPrevented) {
        e.preventDefault(); e.stopPropagation(); escRef.current(); return
      }
      if (e.key !== 'Tab' || !container) return
      const target = handleTrapTab(container, e.shiftKey, document.activeElement)
      if (target) { e.preventDefault(); target.focus() }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (previouslyFocused && document.contains(previouslyFocused) && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus({ preventScroll: true })
      }
    }
  }, [containerRef])
}
