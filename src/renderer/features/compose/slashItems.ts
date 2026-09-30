/**
 * The `/` menu catalogue. Pure data + filtering so the ordering rules can be tested
 * without mounting an editor; `SlashMenu` maps `action` to an editor command.
 */

import i18n from '@/i18n'
import { fuzzyScore } from './snippets'

const t = (key: string): string => i18n.t(key, { ns: 'compose' })

export type SlashAction =
  | 'text' | 'h1' | 'h2' | 'h3'
  | 'bulletList' | 'orderedList' | 'taskList' | 'toggle'
  | 'quote' | 'divider' | 'callout' | 'code' | 'table' | 'image'
  | 'textColor' | 'backgroundColor' | 'emoji' | 'snippet' | 'link'

export type SlashGroup = 'basic' | 'media' | 'advanced' | 'snippets'

export interface SlashItem {
  action: SlashAction
  title: string
  description: string
  /** lucide-react icon name rendered by the menu. */
  icon: string
  group: SlashGroup
  /** Localised heading for `group`. */
  groupLabel: string
  /** Extra search terms (the `/aliases` from the spec). */
  keywords: string[]
  /** Shown right-aligned, e.g. the markdown shortcut. */
  hint?: string
  /** Opens a submenu instead of inserting. */
  submenu?: 'color'
  /** Snippet id, for items generated from the local snippet store. */
  snippetId?: string
}

/** The `/` menu catalogue, in the UI language. A function (not a constant) so it follows language changes. */
export function slashItems(): SlashItem[] {
  return [
    { action: 'text', title: t('slash.items.text.title'), description: t('slash.items.text.description'), icon: 'Type', group: 'basic', groupLabel: t('slash.groups.basic'), keywords: ['text', 'p', 'paragraph', 'plain'] },
    { action: 'h1', title: t('slash.items.h1.title'), description: t('slash.items.h1.description'), icon: 'Heading1', group: 'basic', groupLabel: t('slash.groups.basic'), keywords: ['h1', 'heading', 'title', 'large'], hint: '#' },
    { action: 'h2', title: t('slash.items.h2.title'), description: t('slash.items.h2.description'), icon: 'Heading2', group: 'basic', groupLabel: t('slash.groups.basic'), keywords: ['h2', 'heading', 'subtitle', 'medium'], hint: '##' },
    { action: 'h3', title: t('slash.items.h3.title'), description: t('slash.items.h3.description'), icon: 'Heading3', group: 'basic', groupLabel: t('slash.groups.basic'), keywords: ['h3', 'heading', 'small'], hint: '###' },
    { action: 'bulletList', title: t('slash.items.bulletList.title'), description: t('slash.items.bulletList.description'), icon: 'List', group: 'basic', groupLabel: t('slash.groups.basic'), keywords: ['bullet', 'ul', 'unordered', 'list'], hint: '-' },
    { action: 'orderedList', title: t('slash.items.orderedList.title'), description: t('slash.items.orderedList.description'), icon: 'ListOrdered', group: 'basic', groupLabel: t('slash.groups.basic'), keywords: ['numbered', 'ol', 'ordered', 'list'], hint: '1.' },
    { action: 'taskList', title: t('slash.items.taskList.title'), description: t('slash.items.taskList.description'), icon: 'ListTodo', group: 'basic', groupLabel: t('slash.groups.basic'), keywords: ['todo', 'checkbox', 'task', 'check', '[]'], hint: '[]' },
    { action: 'toggle', title: t('slash.items.toggle.title'), description: t('slash.items.toggle.description'), icon: 'ChevronRight', group: 'basic', groupLabel: t('slash.groups.basic'), keywords: ['toggle', 'collapse', 'details', 'fold'] },
    { action: 'quote', title: t('slash.items.quote.title'), description: t('slash.items.quote.description'), icon: 'Quote', group: 'basic', groupLabel: t('slash.groups.basic'), keywords: ['quote', 'blockquote', 'citation'], hint: '"' },
    { action: 'divider', title: t('slash.items.divider.title'), description: t('slash.items.divider.description'), icon: 'Minus', group: 'basic', groupLabel: t('slash.groups.basic'), keywords: ['divider', 'separator', 'hr', 'line', '---'], hint: '---' },
    { action: 'callout', title: t('slash.items.callout.title'), description: t('slash.items.callout.description'), icon: 'Info', group: 'basic', groupLabel: t('slash.groups.basic'), keywords: ['callout', 'note', 'panel', 'highlight', 'info'] },
    { action: 'code', title: t('slash.items.code.title'), description: t('slash.items.code.description'), icon: 'Code', group: 'advanced', groupLabel: t('slash.groups.advanced'), keywords: ['code', 'snippet', 'pre', 'monospace'], hint: '```' },
    { action: 'table', title: t('slash.items.table.title'), description: t('slash.items.table.description'), icon: 'Table', group: 'advanced', groupLabel: t('slash.groups.advanced'), keywords: ['table', 'grid', 'rows', 'columns'] },
    { action: 'image', title: t('slash.items.image.title'), description: t('slash.items.image.description'), icon: 'Image', group: 'media', groupLabel: t('slash.groups.media'), keywords: ['image', 'picture', 'photo', 'upload', 'img'] },
    { action: 'link', title: t('slash.items.link.title'), description: t('slash.items.link.description'), icon: 'Link', group: 'media', groupLabel: t('slash.groups.media'), keywords: ['link', 'url', 'href', 'anchor'], hint: '⌘K' },
    { action: 'emoji', title: t('slash.items.emoji.title'), description: t('slash.items.emoji.description'), icon: 'Smile', group: 'media', groupLabel: t('slash.groups.media'), keywords: ['emoji', 'emoticon', 'smiley', 'icon'], hint: ':' },
    { action: 'textColor', title: t('slash.items.textColor.title'), description: t('slash.items.textColor.description'), icon: 'Baseline', group: 'advanced', groupLabel: t('slash.groups.advanced'), keywords: ['colour', 'color', 'text colour', 'red', 'blue', 'green'], submenu: 'color' },
    { action: 'backgroundColor', title: t('slash.items.backgroundColor.title'), description: t('slash.items.backgroundColor.description'), icon: 'PaintBucket', group: 'advanced', groupLabel: t('slash.groups.advanced'), keywords: ['background', 'highlight', 'colour', 'color', 'marker'], submenu: 'color' }
  ]
}

/** Notion's palette, mapped to literal hex because email HTML cannot use CSS variables. */
export interface ColorChoice { name: string; value: string }

/** Text colours, named in the UI language (values are literal hex: see above). */
export function textColors(): ColorChoice[] {
  return [
    { name: t('slash.colors.default'), value: '' },
    { name: t('slash.colors.gray'), value: '#787774' },
    { name: t('slash.colors.brown'), value: '#9f6b53' },
    { name: t('slash.colors.orange'), value: '#d9730d' },
    { name: t('slash.colors.yellow'), value: '#cb912f' },
    { name: t('slash.colors.green'), value: '#448361' },
    { name: t('slash.colors.blue'), value: '#337ea9' },
    { name: t('slash.colors.purple'), value: '#9065b0' },
    { name: t('slash.colors.pink'), value: '#c14c8a' },
    { name: t('slash.colors.red'), value: '#d44c47' }
  ]
}

/** Highlight colours, named in the UI language. */
export function backgroundColors(): ColorChoice[] {
  return [
    { name: t('slash.colors.default'), value: '' },
    { name: t('slash.colors.gray'), value: '#f1f1ef' },
    { name: t('slash.colors.brown'), value: '#f4eeee' },
    { name: t('slash.colors.orange'), value: '#fbecdd' },
    { name: t('slash.colors.yellow'), value: '#fbf3db' },
    { name: t('slash.colors.green'), value: '#edf3ec' },
    { name: t('slash.colors.blue'), value: '#e7f3f8' },
    { name: t('slash.colors.purple'), value: '#f6f3f9' },
    { name: t('slash.colors.pink'), value: '#faf1f5' },
    { name: t('slash.colors.red'), value: '#fdebec' }
  ]
}

/** Emoji offered by the callout block and the `:` suggestion fallback. */
export const CALLOUT_EMOJI = ['💡', '📌', '✅', '⚠️', '🔥', '📝', '🎯', '🚀', '❤️', '🙏', '👀', '🎉']

export interface SnippetItemSource { id: string; name: string; shortcut?: string }

/**
 * Filter the catalogue for a `/` query. Snippets are appended as their own group so
 * `/<snippet name>` works exactly like the spec describes.
 *
 * Ranking: the catalogue keeps its curated order for an empty query; once the user types,
 * results sort by best keyword match so `/h2` and `/todo` land first.
 */
export function filterSlashItems(query: string, snippets: SnippetItemSource[] = []): SlashItem[] {
  const snippetItems: SlashItem[] = snippets.map((s) => ({
    action: 'snippet' as const,
    title: s.name,
    description: t('slash.insertSnippet'),
    icon: 'Braces',
    group: 'snippets' as const,
    groupLabel: t('slash.groups.snippets'),
    keywords: ['snippet', s.name.toLowerCase(), ...(s.shortcut ? [s.shortcut.toLowerCase()] : [])],
    ...(s.shortcut ? { hint: `;${s.shortcut}` } : {}),
    snippetId: s.id
  }))
  const all = [...slashItems(), ...snippetItems]
  const q = query.trim().toLowerCase()
  if (!q) return all

  return all
    .map((item) => ({ item, score: scoreItem(item, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item)
}

function scoreItem(item: SlashItem, query: string): number {
  const title = item.title.toLowerCase()
  // The title is the primary handle; keywords are worth a little less so that typing
  // "code" prefers the Code block over a block that merely mentions code.
  const scores = [fuzzyScore(title, query), ...item.keywords.map((k) => fuzzyScore(k, query) * 0.9)]
  return Math.max(...scores)
}

/** cmd+alt+<n> block shortcuts, per the Notion shortcut table in the spec. */
export const BLOCK_SHORTCUTS: Record<string, SlashAction> = {
  '0': 'text', '1': 'h1', '2': 'h2', '3': 'h3',
  '4': 'taskList', '5': 'bulletList', '6': 'orderedList', '7': 'toggle'
}
