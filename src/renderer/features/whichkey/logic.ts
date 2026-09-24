/** Pure helpers for the which-key overlay. */

/** How long a sequence prefix must sit before the hint appears; experts finish before this. */
export const HINT_DELAY_MS = 350

export interface HintOption { keys: string; label: string }

/**
 * Tidy continuation labels for a compact list: when every option starts with the same verb
 * ("Go to Inbox", "Go to Sent" …) drop it, so `g` shows "Inbox / Sent / Drafts / All Mail".
 * Order is the shortcut table's (i, t, d, a for `g`), i.e. how the keys are documented.
 */
export function tidyOptions(options: HintOption[]): HintOption[] {
  const lead = (l: string): string => l.split(' ').slice(0, 2).join(' ')
  const same = options.length > 1 && options.every((o) => lead(o.label) === lead(options[0].label) && o.label.split(' ').length > 2)
  return options.map((o) => ({ keys: o.keys, label: same ? o.label.split(' ').slice(2).join(' ') : o.label }))
}
