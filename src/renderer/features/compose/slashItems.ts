/**
 * The `/` menu catalogue. Pure data + filtering so the ordering rules can be tested
 * without mounting an editor; `SlashMenu` maps `action` to an editor command.
 */

import { fuzzyScore } from './snippets'

export type SlashAction =
  | 'text' | 'h1' | 'h2' | 'h3'
  | 'bulletList' | 'orderedList' | 'taskList' | 'toggle'
  | 'quote' | 'divider' | 'callout' | 'code' | 'table' | 'image'
  | 'textColor' | 'backgroundColor' | 'emoji' | 'snippet' | 'link'

export type SlashGroup = 'Basic blocks' | 'Media' | 'Advanced' | 'Snippets'

export interface SlashItem {
  action: SlashAction
  title: string
  description: string
  /** lucide-react icon name rendered by the menu. */
  icon: string
  group: SlashGroup
  /** Extra search terms (the `/aliases` from the spec). */
  keywords: string[]
  /** Shown right-aligned, e.g. the markdown shortcut. */
  hint?: string
  /** Opens a submenu instead of inserting. */
  submenu?: 'color'
  /** Snippet id, for items generated from the local snippet store. */
  snippetId?: string
}

export const SLASH_ITEMS: SlashItem[] = [
  { action: 'text', title: 'Text', description: 'Just start writing with plain text.', icon: 'Type', group: 'Basic blocks', keywords: ['text', 'p', 'paragraph', 'plain'] },
  { action: 'h1', title: 'Heading 1', description: 'Big section heading.', icon: 'Heading1', group: 'Basic blocks', keywords: ['h1', 'heading', 'title', 'large'], hint: '#' },
  { action: 'h2', title: 'Heading 2', description: 'Medium section heading.', icon: 'Heading2', group: 'Basic blocks', keywords: ['h2', 'heading', 'subtitle', 'medium'], hint: '##' },
  { action: 'h3', title: 'Heading 3', description: 'Small section heading.', icon: 'Heading3', group: 'Basic blocks', keywords: ['h3', 'heading', 'small'], hint: '###' },
  { action: 'bulletList', title: 'Bulleted list', description: 'Create a simple bulleted list.', icon: 'List', group: 'Basic blocks', keywords: ['bullet', 'ul', 'unordered', 'list'], hint: '-' },
  { action: 'orderedList', title: 'Numbered list', description: 'Create a list with numbering.', icon: 'ListOrdered', group: 'Basic blocks', keywords: ['numbered', 'ol', 'ordered', 'list'], hint: '1.' },
  { action: 'taskList', title: 'To-do list', description: 'Track tasks with a checklist.', icon: 'ListTodo', group: 'Basic blocks', keywords: ['todo', 'checkbox', 'task', 'check', '[]'], hint: '[]' },
  { action: 'toggle', title: 'Toggle list', description: 'Hide detail inside a collapsible.', icon: 'ChevronRight', group: 'Basic blocks', keywords: ['toggle', 'collapse', 'details', 'fold'] },
  { action: 'quote', title: 'Quote', description: 'Capture a quotation.', icon: 'Quote', group: 'Basic blocks', keywords: ['quote', 'blockquote', 'citation'], hint: '"' },
  { action: 'divider', title: 'Divider', description: 'Visually divide blocks.', icon: 'Minus', group: 'Basic blocks', keywords: ['divider', 'separator', 'hr', 'line', '---'], hint: '---' },
  { action: 'callout', title: 'Callout', description: 'Make writing stand out.', icon: 'Info', group: 'Basic blocks', keywords: ['callout', 'note', 'panel', 'highlight', 'info'] },
  { action: 'code', title: 'Code', description: 'Capture a snippet of code.', icon: 'Code', group: 'Advanced', keywords: ['code', 'snippet', 'pre', 'monospace'], hint: '```' },
  { action: 'table', title: 'Table', description: 'Add a simple table.', icon: 'Table', group: 'Advanced', keywords: ['table', 'grid', 'rows', 'columns'] },
  { action: 'image', title: 'Image', description: 'Upload or drop in a picture.', icon: 'Image', group: 'Media', keywords: ['image', 'picture', 'photo', 'upload', 'img'] },
  { action: 'link', title: 'Link', description: 'Link to a page on the web.', icon: 'Link', group: 'Media', keywords: ['link', 'url', 'href', 'anchor'], hint: '⌘K' },
  { action: 'emoji', title: 'Emoji', description: 'Search and insert an emoji.', icon: 'Smile', group: 'Media', keywords: ['emoji', 'emoticon', 'smiley', 'icon'], hint: ':' },
  { action: 'textColor', title: 'Text colour', description: 'Colour the selected text.', icon: 'Baseline', group: 'Advanced', keywords: ['colour', 'color', 'text colour', 'red', 'blue', 'green'], submenu: 'color' },
  { action: 'backgroundColor', title: 'Background colour', description: 'Highlight the selected text.', icon: 'PaintBucket', group: 'Advanced', keywords: ['background', 'highlight', 'colour', 'color', 'marker'], submenu: 'color' }
]

/** Notion's palette, mapped to literal hex because email HTML cannot use CSS variables. */
export interface ColorChoice { name: string; value: string }

export const TEXT_COLORS: ColorChoice[] = [
  { name: 'Default', value: '' },
  { name: 'Gray', value: '#787774' },
  { name: 'Brown', value: '#9f6b53' },
  { name: 'Orange', value: '#d9730d' },
  { name: 'Yellow', value: '#cb912f' },
  { name: 'Green', value: '#448361' },
  { name: 'Blue', value: '#337ea9' },
  { name: 'Purple', value: '#9065b0' },
  { name: 'Pink', value: '#c14c8a' },
  { name: 'Red', value: '#d44c47' }
]

export const BACKGROUND_COLORS: ColorChoice[] = [
  { name: 'Default', value: '' },
  { name: 'Gray', value: '#f1f1ef' },
  { name: 'Brown', value: '#f4eeee' },
  { name: 'Orange', value: '#fbecdd' },
  { name: 'Yellow', value: '#fbf3db' },
  { name: 'Green', value: '#edf3ec' },
  { name: 'Blue', value: '#e7f3f8' },
  { name: 'Purple', value: '#f6f3f9' },
  { name: 'Pink', value: '#faf1f5' },
  { name: 'Red', value: '#fdebec' }
]

/** Emoji offered by the callout block and the `:` suggestion fallback. */
export const CALLOUT_EMOJI = ['💡', '📌', '✅', '⚠️', '🔥', '📝', '🎯', '🚀', '❤️', '🙏', '👀', '🎉']

export interface SnippetItemSource { id: string; name: string }

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
    description: 'Insert snippet',
    icon: 'Braces',
    group: 'Snippets' as const,
    keywords: ['snippet', s.name.toLowerCase()],
    snippetId: s.id
  }))
  const all = [...SLASH_ITEMS, ...snippetItems]
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
