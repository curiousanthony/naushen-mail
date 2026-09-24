import { create } from 'zustand'
import { HINT_DELAY_MS, tidyOptions, type HintOption } from './logic'

interface WhichKey {
  /** Shown only after the user has paused; null otherwise. */
  visible: { prefix: string[]; options: HintOption[] } | null
}

export const useWhichKey = create<WhichKey>(() => ({ visible: null }))

let timer: ReturnType<typeof setTimeout> | null = null

/**
 * A sequence prefix was typed. The hint only appears if nothing else happens for
 * HINT_DELAY_MS — experts complete the sequence before that and never see it. If it is already
 * visible (a 3-step sequence) it updates immediately.
 */
export function scheduleHint(prefix: string[], options: HintOption[]): void {
  const show = (): void => useWhichKey.setState({ visible: { prefix, options: tidyOptions(options) } })
  if (timer) { clearTimeout(timer); timer = null }
  if (useWhichKey.getState().visible) show()
  else timer = setTimeout(() => { timer = null; show() }, HINT_DELAY_MS)
}

/** Sequence completed, cancelled, timed out, or focus lost. */
export function clearHint(): void {
  if (timer) { clearTimeout(timer); timer = null }
  if (useWhichKey.getState().visible) useWhichKey.setState({ visible: null })
}
