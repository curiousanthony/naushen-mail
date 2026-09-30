import { filterRank } from './filter'
import { bindingToText } from './keys'
import { SECTIONS, SHORTCUTS, sectionText, type ShortcutDef } from './shortcuts'

export interface SheetSection { section: string; items: ShortcutDef[] }

/** Words a shortcut can be found by: label, section, keywords, the keys themselves (`⌘K`, `shift+e`, `g then i`). */
export function shortcutSearchText(s: ShortcutDef): { label: string; keywords: string[] } {
  const keys = s.keys.flatMap((k) => [k, bindingToText(k), ...k.split(/[+\s]/)])
  return { label: s.label, keywords: [s.section, sectionText(s.section), ...(s.keywords ?? []), ...keys] }
}

/** Filter + group the table for the sheet, keeping the canonical section order. */
export function groupShortcuts(query: string, table: ShortcutDef[] = SHORTCUTS): SheetSection[] {
  const matched = new Set(filterRank(table, query, shortcutSearchText))
  return SECTIONS
    .map((section) => ({ section: sectionText(section), items: table.filter((s) => s.section === section && matched.has(s)) }))
    .filter((g) => g.items.length > 0)
}
