/**
 * Detecting the `/` (blocks) and `:` (emoji) triggers from the text before the caret.
 *
 * Kept out of the editor so the rules are testable: a trigger only fires at the start of a
 * block or after whitespace (so `and/or` and `http://x` never open the menu), and it closes
 * as soon as the query grows a space or a second trigger character.
 */

export interface TriggerMatch {
  /** The characters typed after the trigger, e.g. `head` for `/head`. */
  query: string
  /** Offset (in characters, from the end of `textBefore`) where the trigger char sits. */
  from: number
}

function detect(textBefore: string, char: string, maxQuery: number): TriggerMatch | null {
  const idx = textBefore.lastIndexOf(char)
  if (idx < 0) return null
  const before = idx === 0 ? '' : textBefore[idx - 1]
  // Start of block, or preceded by whitespace / an opening bracket.
  if (before && !/[\s(["']/.test(before)) return null
  const query = textBefore.slice(idx + 1)
  if (query.length > maxQuery) return null
  if (/[\s]/.test(query)) return null
  return { query, from: textBefore.length - idx }
}

/** `/heading` -> `{ query: 'heading' }`. Allows spaces to close the menu. */
export function detectSlashTrigger(textBefore: string): TriggerMatch | null {
  return detect(textBefore, '/', 30)
}

/**
 * `:smi` -> `{ query: 'smi' }`. Requires at least one character so a bare `:` (very common
 * in normal prose — "Hi:") does not pop a menu.
 */
export function detectEmojiTrigger(textBefore: string): TriggerMatch | null {
  const m = detect(textBefore, ':', 24)
  if (!m || m.query.length < 1) return null
  // Only letters/digits/underscore/+/- are valid in a shortcode.
  if (!/^[a-zA-Z0-9_+-]+$/.test(m.query)) return null
  return m
}

export interface EmojiEntry { name: string; emoji: string; shortcodes?: string[] }

/** Emoji whose name or shortcode starts with / contains the query, best match first. */
export function searchEmoji(list: EmojiEntry[], query: string, limit = 12): EmojiEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return list.slice(0, limit)
  const scored: { e: EmojiEntry; score: number }[] = []
  for (const e of list) {
    if (!e.emoji) continue
    const names = [e.name, ...(e.shortcodes ?? [])].map((n) => n.toLowerCase())
    let best = 0
    for (const n of names) {
      if (n === q) best = Math.max(best, 1000)
      else if (n.startsWith(q)) best = Math.max(best, 500 - n.length)
      else if (n.includes(q)) best = Math.max(best, 200 - n.length)
    }
    if (best > 0) scored.push({ e, score: best })
  }
  return scored.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name)).slice(0, limit).map((x) => x.e)
}
