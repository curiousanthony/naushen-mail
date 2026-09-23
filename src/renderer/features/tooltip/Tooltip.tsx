import { cloneElement, isValidElement, type FocusEvent, type MouseEvent, type ReactElement } from 'react'
import { useTooltipStore } from './tooltipStore'

export interface TooltipProps {
  /** Tooltip text. Falsy renders `children` untouched, so call sites can pass a conditional
   *  label (e.g. only when a value is truncated) without an extra branch. */
  label?: string
  /** Optional shortcut hint, rendered as a small key chip — see the ⌘/⇧/⌥ vocabulary already
   *  used for hints in compose/Composer.tsx (`cmp-help__row`), e.g. "⌘⇧D". */
  shortcut?: string
  children: ReactElement
}

/**
 * Wraps a single interactive element (almost always an icon-only button) with the app's custom
 * tooltip, replacing native `title="…"`. A single global <TooltipHost/> (mounted once in
 * App.tsx) does the actual rendering/positioning, so this wrapper only forwards hover/focus
 * events into the shared store — no per-instance DOM node or timer.
 *
 * Doesn't touch `aria-label`: screen readers still need it, a tooltip is a visual affordance.
 */
export function Tooltip({ label, shortcut, children }: TooltipProps): ReactElement {
  if (!label || !isValidElement(children)) return children

  const child = children as ReactElement<Record<string, unknown>>
  const props = child.props as {
    onMouseEnter?: (e: MouseEvent) => void
    onMouseLeave?: (e: MouseEvent) => void
    onMouseDown?: (e: MouseEvent) => void
    onFocus?: (e: FocusEvent) => void
    onBlur?: (e: FocusEvent) => void
  }

  const show = (e: MouseEvent | FocusEvent): void => {
    useTooltipStore.getState().scheduleShow(e.currentTarget as Element, label, shortcut)
  }
  const hide = (): void => useTooltipStore.getState().hide()

  return cloneElement(child, {
    onMouseEnter: (e: MouseEvent) => { props.onMouseEnter?.(e); show(e) },
    onMouseLeave: (e: MouseEvent) => { props.onMouseLeave?.(e); hide() },
    onMouseDown: (e: MouseEvent) => { props.onMouseDown?.(e); hide() },
    // A mouse click focuses the button too; only a *keyboard* focus should trigger the
    // tooltip there, or clicking Archive/Close/etc. would show it again right as (or after)
    // the element unmounts.
    onFocus: (e: FocusEvent) => {
      props.onFocus?.(e)
      if ((e.currentTarget as Element).matches(':focus-visible')) show(e)
    },
    onBlur: (e: FocusEvent) => { props.onBlur?.(e); hide() }
  })
}
