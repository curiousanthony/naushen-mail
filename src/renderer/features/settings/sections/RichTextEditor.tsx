import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Bold, Check, Eraser, Italic, Link as LinkIcon, Underline, Unlink, X } from 'lucide-react'
import { IconButton, TextInput } from '../ui'
import { sanitizeRich } from '../lib/sanitize'
import { normalizeUrl } from '../lib/links'

type Cmd = 'bold' | 'italic' | 'underline'

/**
 * Small contentEditable editor (bold / italic / underline / link) used for signatures and snippets.
 * Uncontrolled: `initialHtml` is applied on mount and whenever `resetKey` changes.
 */
export function RichTextEditor({ initialHtml, resetKey, onChange, placeholder, label, minHeight = 120 }: {
  initialHtml: string; resetKey: string; onChange: (html: string) => void; placeholder: string; label: string; minHeight?: number
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const savedRange = useRef<Range | null>(null)
  const [active, setActive] = useState<Record<Cmd, boolean>>({ bold: false, italic: false, underline: false })
  const [empty, setEmpty] = useState(!initialHtml)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkText, setLinkText] = useState('')
  const [linkBad, setLinkBad] = useState(false)

  useEffect(() => {
    if (ref.current) { ref.current.innerHTML = sanitizeRich(initialHtml); setEmpty(!ref.current.textContent) }
    setLinkOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  const emit = useCallback(() => {
    const el = ref.current
    if (!el) return
    setEmpty(!el.textContent)
    onChange(sanitizeRich(el.innerHTML))
  }, [onChange])

  const refreshActive = useCallback(() => {
    const el = ref.current
    const sel = document.getSelection()
    if (!el || !sel || !sel.anchorNode || !el.contains(sel.anchorNode)) return
    setActive({ bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'), underline: document.queryCommandState('underline') })
  }, [])

  useEffect(() => {
    document.addEventListener('selectionchange', refreshActive)
    return () => document.removeEventListener('selectionchange', refreshActive)
  }, [refreshActive])

  const exec = (cmd: Cmd | 'removeFormat' | 'unlink'): void => {
    ref.current?.focus()
    document.execCommand(cmd)
    emit(); refreshActive()
  }

  const openLink = (): void => {
    const sel = document.getSelection()
    savedRange.current = sel && sel.rangeCount && ref.current?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null
    setLinkText(''); setLinkBad(false); setLinkOpen(true)
  }
  const applyLink = (): void => {
    const href = normalizeUrl(linkText)
    if (!href) { setLinkBad(true); return }
    const el = ref.current
    if (!el) return
    el.focus()
    const sel = document.getSelection()
    if (savedRange.current && sel) { sel.removeAllRanges(); sel.addRange(savedRange.current) }
    if (sel && sel.isCollapsed) document.execCommand('insertHTML', false, `<a href="${href.replace(/"/g, '&quot;')}">${href.replace(/^mailto:/, '').replace(/</g, '&lt;')}</a>`)
    else document.execCommand('createLink', false, href)
    setLinkOpen(false); emit()
  }

  const onPaste = (e: React.ClipboardEvent): void => {
    e.preventDefault()
    const html = e.clipboardData.getData('text/html')
    if (html) document.execCommand('insertHTML', false, sanitizeRich(html))
    else document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
    emit()
  }

  const keepFocus = (e: React.MouseEvent): void => e.preventDefault()

  return (
    <div className="st-rte">
      <div className="st-rte__bar" role="toolbar" aria-label={`${label} formatting`}>
        <IconButton label="Bold (⌘B)" className={clsx(active.bold && 'is-active')} onMouseDown={keepFocus} onClick={() => exec('bold')}><Bold size={15} strokeWidth={1.75} /></IconButton>
        <IconButton label="Italic (⌘I)" className={clsx(active.italic && 'is-active')} onMouseDown={keepFocus} onClick={() => exec('italic')}><Italic size={15} strokeWidth={1.75} /></IconButton>
        <IconButton label="Underline (⌘U)" className={clsx(active.underline && 'is-active')} onMouseDown={keepFocus} onClick={() => exec('underline')}><Underline size={15} strokeWidth={1.75} /></IconButton>
        <span className="st-rte__sep" />
        <IconButton label="Add link" className={clsx(linkOpen && 'is-active')} onMouseDown={keepFocus} onClick={linkOpen ? () => setLinkOpen(false) : openLink}><LinkIcon size={15} strokeWidth={1.75} /></IconButton>
        <IconButton label="Remove link" onMouseDown={keepFocus} onClick={() => exec('unlink')}><Unlink size={15} strokeWidth={1.75} /></IconButton>
        <span className="st-rte__sep" />
        <IconButton label="Clear formatting" onMouseDown={keepFocus} onClick={() => exec('removeFormat')}><Eraser size={15} strokeWidth={1.75} /></IconButton>
      </div>
      {linkOpen && (
        <div className="st-rte__link">
          <TextInput autoFocus placeholder="Paste a link, e.g. example.com" value={linkText} invalid={linkBad} aria-label="Link address"
            onChange={(e) => { setLinkText(e.target.value); setLinkBad(false) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); applyLink() }
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setLinkOpen(false); ref.current?.focus() }
            }} />
          <IconButton label="Apply link" onClick={applyLink}><Check size={15} strokeWidth={1.75} /></IconButton>
          <IconButton label="Cancel" onClick={() => setLinkOpen(false)}><X size={15} strokeWidth={1.75} /></IconButton>
        </div>
      )}
      <div className="st-rte__wrap" style={{ minHeight }}>
        <div ref={ref} className="st-rte__area selectable" contentEditable suppressContentEditableWarning role="textbox" aria-multiline aria-label={label}
          spellCheck onInput={emit} onPaste={onPaste} onKeyUp={refreshActive} onMouseUp={refreshActive} />
        {empty && <div className="st-rte__placeholder" aria-hidden>{placeholder}</div>}
      </div>
    </div>
  )
}
