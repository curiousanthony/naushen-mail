/**
 * The link popover: ⌘⇧L (or ⌘K, or a click on an existing link) opens a one-line editor
 * anchored to the caret. Enter applies, Esc dismisses, and on an existing link there are
 * Open and Remove buttons. With nothing selected, applying inserts the URL as linked text.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Check, ExternalLink, Trash2 } from 'lucide-react'
import { Tooltip } from '@/features/tooltip'
import './smart.css'

export interface LinkAnchor { left: number; top: number; bottom: number }

interface Props {
  editor: Editor
  anchor: LinkAnchor
  onClose: () => void
}

/** `example.com` -> `https://example.com`; leaves any explicit scheme (mailto:, tel:) alone. */
export function normaliseHref(raw: string): string {
  const v = raw.trim()
  if (!v) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`
  return `https://${v}`
}

export function LinkPopover({ editor, anchor, onClose }: Props): JSX.Element {
  const existing = editor.isActive('link')
  const [href, setHref] = useState<string>(() => (editor.getAttributes('link').href as string | undefined) ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<React.CSSProperties>({ left: anchor.left, top: anchor.bottom + 8, visibility: 'hidden' })

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // Keep it on screen: clamp horizontally, flip above the caret near the window bottom.
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const left = Math.max(8, Math.min(anchor.left - 12, window.innerWidth - w - 8))
    const flip = anchor.bottom + 8 + h > window.innerHeight - 8 && anchor.top - 8 - h > 8
    setPos({ left, top: flip ? anchor.top - 8 - h : anchor.bottom + 8 })
  }, [anchor])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return
      onClose()
    }
    // Typing in the document dismisses it, like any transient popover.
    const onUpdate = (): void => onClose()
    document.addEventListener('mousedown', onDown, true)
    editor.on('update', onUpdate)
    return () => { document.removeEventListener('mousedown', onDown, true); editor.off('update', onUpdate) }
  }, [editor, onClose])

  const finish = (): void => { onClose(); editor.commands.focus() }

  const apply = (): void => {
    const url = normaliseHref(href)
    const chain = editor.chain().focus()
    if (!url) {
      if (existing) chain.extendMarkRange('link').unsetLink().run()
    } else if (editor.state.selection.empty && !existing) {
      // Nothing selected: the link text is the URL itself.
      chain.insertContent({ type: 'text', text: url.replace(/^(https?:\/\/|mailto:)/i, ''), marks: [{ type: 'link', attrs: { href: url } }] }).run()
    } else {
      chain.extendMarkRange('link').setLink({ href: url }).run()
    }
    onClose()
  }

  return (
    <div ref={rootRef} className="cmpx-link" style={pos} role="dialog" aria-label="Edit link">
      <input
        ref={inputRef}
        className="cmpx-link__input"
        placeholder="Paste or type a link"
        aria-label="Link URL"
        spellCheck={false}
        value={href}
        onChange={(e) => setHref(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') { e.preventDefault(); apply() }
          else if (e.key === 'Escape') { e.preventDefault(); finish() }
        }}
      />
      <Tooltip label="Apply" shortcut="↵">
        <button type="button" className="cmp-iconbtn" aria-label="Apply link" onMouseDown={(e) => { e.preventDefault(); apply() }}>
          <Check size={14} />
        </button>
      </Tooltip>
      {existing && (
        <>
          <Tooltip label="Open link">
            <button type="button" className="cmp-iconbtn" aria-label="Open link" onMouseDown={(e) => { e.preventDefault(); void window.api.invoke('app.openExternal', normaliseHref(href)) }}>
              <ExternalLink size={14} />
            </button>
          </Tooltip>
          <Tooltip label="Remove link">
            <button
              type="button"
              className="cmp-iconbtn"
              aria-label="Remove link"
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().extendMarkRange('link').unsetLink().run(); onClose() }}
            >
              <Trash2 size={14} />
            </button>
          </Tooltip>
        </>
      )}
    </div>
  )
}
