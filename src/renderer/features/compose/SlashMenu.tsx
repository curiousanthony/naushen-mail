/**
 * The Notion-style `/` menu: icons, descriptions, fuzzy filter, arrow/enter, esc.
 * Filtering is pure (`slashItems.ts`); this file owns the floating UI and maps an action
 * onto an editor command.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import * as icons from 'lucide-react'
import {
  BACKGROUND_COLORS, TEXT_COLORS, filterSlashItems,
  type ColorChoice, type SlashAction, type SlashItem
} from './slashItems'
import type { Snippet } from './snippets'

export interface MenuAnchor { x: number; y: number; bottom: number }

interface Props {
  editor: Editor
  query: string
  anchor: MenuAnchor
  snippets: Snippet[]
  onClose: () => void
  /** Remove the `/query` text before inserting. */
  onConsume: () => void
  onRequestImage: () => void
  onRequestLink: () => void
}

const Icon = ({ name, size = 16 }: { name: string; size?: number }): JSX.Element => {
  const Cmp = (icons as unknown as Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>>)[name]
  return Cmp ? <Cmp size={size} strokeWidth={1.75} /> : <icons.Square size={size} strokeWidth={1.75} />
}

export function SlashMenu(props: Props): JSX.Element | null {
  const { editor, query, anchor, snippets, onClose, onConsume, onRequestImage, onRequestLink } = props
  const [active, setActive] = useState(0)
  const [submenu, setSubmenu] = useState<null | { kind: 'color'; action: SlashAction }>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const items = filterSlashItems(query, snippets.map((s) => ({ id: s.id, name: s.name })))
  const colors = submenu?.action === 'backgroundColor' ? BACKGROUND_COLORS : TEXT_COLORS

  useEffect(() => { setActive(0); setSubmenu(null) }, [query])

  // Keep the highlighted row in view as the user arrows down a long list.
  useLayoutEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [active, submenu])

  const run = (item: SlashItem): void => {
    if (item.submenu === 'color') { setSubmenu({ kind: 'color', action: item.action }); return }
    onConsume()
    applySlashAction(editor, item, { snippets, onRequestImage, onRequestLink })
    onClose()
  }

  const runColor = (choice: ColorChoice): void => {
    onConsume()
    const chain = editor.chain().focus()
    if (submenu?.action === 'backgroundColor') {
      choice.value ? chain.setBackgroundColor(choice.value).run() : chain.unsetBackgroundColor().run()
    } else {
      choice.value ? chain.setColor(choice.value).run() : chain.unsetColor().run()
    }
    onClose()
  }

  // Arrow / enter / escape are handled by the editor wrapper (capture phase) and routed here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const len = submenu ? colors.length : items.length
      if (!len) { if (e.key === 'Escape') onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setActive((i) => (i + 1) % len) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setActive((i) => (i - 1 + len) % len) }
      else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation()
        submenu ? runColor(colors[active]) : run(items[active])
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation()
        submenu ? setSubmenu(null) : onClose()
      }
    }
    // Capture on window so ProseMirror never sees these keys first.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  if (!items.length && !submenu) {
    return (
      <div className="cmp-menu" style={positionStyle(anchor)} role="listbox">
        <div className="cmp-menu__empty">No blocks match</div>
      </div>
    )
  }

  if (submenu) {
    return (
      <div className="cmp-menu cmp-menu--colors" style={positionStyle(anchor)} role="listbox" ref={listRef}>
        <div className="cmp-menu__group">{submenu.action === 'backgroundColor' ? 'Background' : 'Colour'}</div>
        {colors.map((c, i) => (
          <button
            key={c.name}
            type="button"
            className={`cmp-menu__row${i === active ? ' is-active' : ''}`}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => { e.preventDefault(); runColor(c) }}
          >
            <span
              className="cmp-menu__swatch"
              style={submenu.action === 'backgroundColor'
                ? { background: c.value || 'transparent' }
                : { color: c.value || 'inherit' }}
            >
              A
            </span>
            <span className="cmp-menu__title">{c.name}</span>
          </button>
        ))}
      </div>
    )
  }

  // Filtered results are ranked by score, so groups would interleave: headers are only
  // meaningful for the unfiltered, curated list.
  const showGroups = !query.trim()
  let lastGroup = ''
  return (
    <div className="cmp-menu" style={positionStyle(anchor)} role="listbox" ref={listRef}>
      {items.map((item, i) => {
        const header = showGroups && item.group !== lastGroup ? item.group : null
        lastGroup = item.group
        return (
          <div key={`${item.action}-${item.snippetId ?? item.title}`}>
            {header && <div className="cmp-menu__group">{header}</div>}
            <button
              type="button"
              className={`cmp-menu__row${i === active ? ' is-active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); run(item) }}
            >
              <span className="cmp-menu__icon"><Icon name={item.icon} /></span>
              <span className="cmp-menu__text">
                <span className="cmp-menu__title">{item.title}</span>
                <span className="cmp-menu__desc">{item.description}</span>
              </span>
              {item.hint && <kbd className="cmp-menu__hint">{item.hint}</kbd>}
              {item.submenu && <icons.ChevronRight size={14} className="cmp-menu__chev" />}
            </button>
          </div>
        )
      })}
    </div>
  )
}

/** Flip above the caret when the menu would fall off the bottom of the window. */
function positionStyle(anchor: MenuAnchor): React.CSSProperties {
  const MENU_H = 320
  const below = window.innerHeight - anchor.bottom
  const flip = below < MENU_H && anchor.y > MENU_H
  return {
    left: Math.min(anchor.x, window.innerWidth - 300),
    ...(flip ? { bottom: window.innerHeight - anchor.y + 6 } : { top: anchor.bottom + 6 })
  }
}

export interface ApplyContext {
  snippets: Snippet[]
  onRequestImage: () => void
  onRequestLink: () => void
}

/** Map a menu item to the editor command that inserts it. */
export function applySlashAction(editor: Editor, item: SlashItem, ctx: ApplyContext): void {
  const chain = editor.chain().focus()
  switch (item.action) {
    case 'text': chain.setParagraph().run(); break
    case 'h1': chain.setNode('heading', { level: 1 }).run(); break
    case 'h2': chain.setNode('heading', { level: 2 }).run(); break
    case 'h3': chain.setNode('heading', { level: 3 }).run(); break
    case 'bulletList': chain.toggleBulletList().run(); break
    case 'orderedList': chain.toggleOrderedList().run(); break
    case 'taskList': chain.toggleTaskList().run(); break
    case 'toggle': chain.setDetails().run(); break
    case 'quote': chain.toggleBlockquote().run(); break
    case 'divider': chain.setHorizontalRule().run(); break
    case 'callout': chain.setCallout().run(); break
    case 'code': chain.toggleCodeBlock().run(); break
    case 'table': chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); break
    case 'image': ctx.onRequestImage(); break
    case 'link': ctx.onRequestLink(); break
    case 'emoji': chain.insertContent(':').run(); break
    case 'snippet': {
      const snippet = ctx.snippets.find((s) => s.id === item.snippetId)
      if (snippet) chain.insertContent(snippet.doc.content ?? snippet.doc).run()
      break
    }
    default: break
  }
}

/** cmd+alt+<n> and the Turn-into menu share this. */
export function applyBlockAction(editor: Editor, action: SlashAction, ctx: ApplyContext): void {
  const item = { action, title: '', description: '', icon: '', group: 'Basic blocks', keywords: [] } as SlashItem
  applySlashAction(editor, item, ctx)
}
