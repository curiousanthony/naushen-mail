/**
 * Floating toolbar over a text selection: Turn into, bold/italic/underline/strike/code,
 * link popover and the colour menu — Notion's inline bar, trimmed to what email supports.
 */

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import {
  Bold, Check, ChevronDown, Code, ExternalLink, Italic, Link2, Palette,
  Strikethrough, Trash2, Underline
} from 'lucide-react'
import { Tooltip, splitShortcutHint } from '@/features/tooltip'
import { BACKGROUND_COLORS, TEXT_COLORS, type SlashAction } from './slashItems'
import { applyBlockAction } from './SlashMenu'

const TURN_INTO: { action: SlashAction; label: string }[] = [
  { action: 'text', label: 'Text' },
  { action: 'h1', label: 'Heading 1' },
  { action: 'h2', label: 'Heading 2' },
  { action: 'h3', label: 'Heading 3' },
  { action: 'bulletList', label: 'Bulleted list' },
  { action: 'orderedList', label: 'Numbered list' },
  { action: 'taskList', label: 'To-do list' },
  { action: 'toggle', label: 'Toggle list' },
  { action: 'quote', label: 'Quote' },
  { action: 'callout', label: 'Callout' },
  { action: 'code', label: 'Code' }
]

interface Props {
  editor: Editor
  /** Viewport rect of the selection. */
  rect: { left: number; top: number; bottom: number; width: number }
  onRequestImage: () => void
}

export function SelectionToolbar({ editor, rect, onRequestImage }: Props): JSX.Element {
  const [panel, setPanel] = useState<null | 'turn' | 'link' | 'color'>(null)
  const [href, setHref] = useState('')
  const linkInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (panel === 'link') {
      setHref((editor.getAttributes('link').href as string) ?? '')
      requestAnimationFrame(() => linkInput.current?.select())
    }
  }, [panel, editor])

  const mark = (fn: () => void) => (e: React.MouseEvent): void => { e.preventDefault(); fn() }

  const applyLink = (): void => {
    const url = href.trim()
    const chain = editor.chain().focus().extendMarkRange('link')
    if (!url) chain.unsetLink().run()
    else chain.setLink({ href: /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}` }).run()
    setPanel(null)
  }

  const style: React.CSSProperties = {
    left: Math.max(12, Math.min(rect.left + rect.width / 2, window.innerWidth - 180)),
    top: rect.top - 8
  }

  return (
    <div className="cmp-seltoolbar" style={style} onMouseDown={(e) => e.stopPropagation()}>
      <div className="cmp-seltoolbar__bar">
        <button type="button" className="cmp-seltoolbar__btn cmp-seltoolbar__btn--wide" onMouseDown={mark(() => setPanel(panel === 'turn' ? null : 'turn'))}>
          Turn into <ChevronDown size={12} />
        </button>
        <span className="cmp-seltoolbar__sep" />
        <ToolButton active={editor.isActive('bold')} label="Bold (⌘B)" onClick={mark(() => editor.chain().focus().toggleBold().run())}><Bold size={14} /></ToolButton>
        <ToolButton active={editor.isActive('italic')} label="Italic (⌘I)" onClick={mark(() => editor.chain().focus().toggleItalic().run())}><Italic size={14} /></ToolButton>
        <ToolButton active={editor.isActive('underline')} label="Underline (⌘U)" onClick={mark(() => editor.chain().focus().toggleUnderline().run())}><Underline size={14} /></ToolButton>
        <ToolButton active={editor.isActive('strike')} label="Strikethrough (⌘⇧S)" onClick={mark(() => editor.chain().focus().toggleStrike().run())}><Strikethrough size={14} /></ToolButton>
        <ToolButton active={editor.isActive('code')} label="Code (⌘E)" onClick={mark(() => editor.chain().focus().toggleCode().run())}><Code size={14} /></ToolButton>
        <ToolButton active={editor.isActive('link')} label="Link (⌘K)" onClick={mark(() => setPanel(panel === 'link' ? null : 'link'))}><Link2 size={14} /></ToolButton>
        <ToolButton active={panel === 'color'} label="Colour" onClick={mark(() => setPanel(panel === 'color' ? null : 'color'))}><Palette size={14} /></ToolButton>
      </div>

      {panel === 'turn' && (
        <div className="cmp-seltoolbar__panel">
          {TURN_INTO.map((t) => (
            <button
              key={t.action}
              type="button"
              className="cmp-menu__row"
              onMouseDown={(e) => { e.preventDefault(); applyBlockAction(editor, t.action, { snippets: [], onRequestImage, onRequestLink: () => setPanel('link') }); setPanel(null) }}
            >
              <span className="cmp-menu__title">{t.label}</span>
            </button>
          ))}
        </div>
      )}

      {panel === 'link' && (
        <div className="cmp-seltoolbar__panel cmp-seltoolbar__panel--link" onMouseDown={(e) => e.stopPropagation()}>
          <input
            ref={linkInput}
            className="cmp-input cmp-input--link"
            placeholder="Paste a link…"
            value={href}
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') { e.preventDefault(); applyLink() }
              if (e.key === 'Escape') { e.preventDefault(); setPanel(null); editor.commands.focus() }
            }}
          />
          <Tooltip label="Apply">
            <button type="button" className="cmp-iconbtn" aria-label="Apply" onMouseDown={(e) => { e.preventDefault(); applyLink() }}><Check size={14} /></button>
          </Tooltip>
          {editor.isActive('link') && (
            <>
              <Tooltip label="Open link">
                <button type="button" className="cmp-iconbtn" aria-label="Open link" onMouseDown={(e) => { e.preventDefault(); void window.api.invoke('app.openExternal', href) }}><ExternalLink size={14} /></button>
              </Tooltip>
              <Tooltip label="Remove link">
                <button type="button" className="cmp-iconbtn" aria-label="Remove link" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().extendMarkRange('link').unsetLink().run(); setPanel(null) }}><Trash2 size={14} /></button>
              </Tooltip>
            </>
          )}
        </div>
      )}

      {panel === 'color' && (
        <div className="cmp-seltoolbar__panel cmp-seltoolbar__panel--color">
          <div className="cmp-menu__group">Text</div>
          <div className="cmp-swatches">
            {TEXT_COLORS.map((c) => (
              <Tooltip key={`t-${c.name}`} label={c.name}>
                <button
                  type="button"
                  className="cmp-swatch"
                  aria-label={c.name}
                  style={{ color: c.value || 'inherit' }}
                  onMouseDown={(e) => { e.preventDefault(); c.value ? editor.chain().focus().setColor(c.value).run() : editor.chain().focus().unsetColor().run(); setPanel(null) }}
                >A</button>
              </Tooltip>
            ))}
          </div>
          <div className="cmp-menu__group">Background</div>
          <div className="cmp-swatches">
            {BACKGROUND_COLORS.map((c) => (
              <Tooltip key={`b-${c.name}`} label={c.name}>
                <button
                  type="button"
                  className="cmp-swatch cmp-swatch--bg"
                  aria-label={c.name}
                  style={{ background: c.value || 'transparent' }}
                  onMouseDown={(e) => { e.preventDefault(); c.value ? editor.chain().focus().setBackgroundColor(c.value).run() : editor.chain().focus().unsetBackgroundColor().run(); setPanel(null) }}
                >A</button>
              </Tooltip>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ToolButton({ active, label, onClick, children }: {
  active?: boolean
  label: string
  onClick: (e: React.MouseEvent) => void
  children: React.ReactNode
}): JSX.Element {
  const { text, shortcut } = splitShortcutHint(label)
  return (
    <Tooltip label={text} shortcut={shortcut}>
      <button type="button" aria-label={label} aria-pressed={active} className={`cmp-seltoolbar__btn${active ? ' is-active' : ''}`} onMouseDown={onClick}>
        {children}
      </button>
    </Tooltip>
  )
}
