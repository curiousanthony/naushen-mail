/**
 * To / Cc / Bcc: a row of chips plus an inline autocomplete over `contacts.suggest`, ranked
 * by frecency (`frecency.ts`). Parsing lives in `recipients.ts`; this only decides *when*
 * text becomes a chip.
 *
 * Interactions worth knowing: paste any list ("a@x, b@x; Ada <ada@x>" or one per line);
 * Backspace on an empty field turns the last chip back into editable text; chips can be
 * dragged between To / Cc / Bcc; ArrowDown on an empty field lists your most-used contacts.
 */

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Address, Contact } from '@shared/types'
import { avatarHue, rankContacts } from './frecency'
import { chipLabel, dedupeAddresses, isValidEmail, parseAddress, parseAddressList } from './recipients'
import './smart.css'

export type RecipientKind = 'to' | 'cc' | 'bcc'
/** MIME type carried by a dragged chip. */
export const RECIPIENT_DRAG_TYPE = 'application/x-naushen-recipient'

interface Props {
  label: string
  /** Which field this is; a dragged chip remembers where it came from. */
  kind: RecipientKind
  value: Address[]
  onChange: (next: Address[]) => void
  /** Rendered at the right of the row (the Cc / Bcc reveal links). */
  trailing?: React.ReactNode
  autoFocus?: boolean
  /** Called when the user tabs/enters out of an empty field (moves to the next field). */
  onCommitBlur?: () => void
  /** A chip from another field was dropped here. */
  onDropAddress?: (address: Address, from: RecipientKind, to: RecipientKind) => void
  /** Chip drag started / ended anywhere (lets the composer reveal Cc / Bcc as drop targets). */
  onDragActive?: (active: boolean) => void
  /** Lower-cased addresses to flag as "check this" (domain typos). */
  suspects?: ReadonlySet<string>
}

/** Imperative escape hatch so the composer can force any pending, uncommitted text into a
 *  chip right before send — a mouse-click Send gets this for free via the input's blur, but
 *  a keyboard shortcut (⌘Enter) can fire while text is still sitting uncommitted in the field.
 *  Returns the parsed address (or null) rather than relying on `onChange`/state, since the
 *  caller needs it synchronously in the same tick — a `setState` from here wouldn't be visible
 *  yet to code reading `value` right after calling this. */
export interface RecipientFieldHandle {
  commitPending(): Address | null
  focus(): void
}

const SUGGEST_LIMIT = 6

export const RecipientField = forwardRef<RecipientFieldHandle, Props>(function RecipientField(
  { label, kind, value, onChange, trailing, autoFocus, onCommitBlur, onDropAddress, onDragActive, suspects }, ref
) {
  const [text, setText] = useState('')
  const [suggestions, setSuggestions] = useState<Contact[]>([])
  const [active, setActive] = useState(0)
  const [focused, setFocused] = useState(false)
  /** ArrowDown on an empty field asks for the frequent-contacts list. */
  const [browsing, setBrowsing] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const query = text.trim()
  const listOpen = focused && suggestions.length > 0 && (query.length > 0 || browsing)

  // Debounced lookup; ignores out-of-order responses. Over-fetch, then rank on the client so
  // recency (which SQL `ORDER BY use_count` ignores) decides among the matches.
  useEffect(() => {
    if (!query && !browsing) { setSuggestions([]); return }
    let cancelled = false
    const t = setTimeout(() => {
      void window.api.invoke('contacts.suggest', query, 30).then((list) => {
        if (cancelled) return
        setSuggestions(rankContacts(list, query, { limit: SUGGEST_LIMIT, exclude: value.map((a) => a.email) }))
        setActive(0)
      }).catch(() => undefined)
    }, query ? 100 : 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, browsing, value])

  const addAddresses = useCallback((list: Address[]) => {
    if (!list.length) return
    onChange(dedupeAddresses([...value, ...list]))
    setText('')
    setSuggestions([])
    setBrowsing(false)
  }, [onChange, value])

  /** Commit whatever is typed. Returns false when there was nothing to commit. */
  const commitText = useCallback((): boolean => {
    const raw = text.trim()
    if (!raw) return false
    const parsed = parseAddress(raw)
    if (parsed) addAddresses([parsed])
    return true
  }, [text, addAddresses])

  useImperativeHandle(ref, () => ({
    commitPending: () => {
      const raw = text.trim()
      if (!raw) return null
      const parsed = parseAddress(raw)
      if (parsed) addAddresses([parsed]) // still updates chip UI, even though the caller won't wait for that state flip
      return parsed
    },
    focus: () => inputRef.current?.focus()
  }), [text, addAddresses])

  const pick = (c: Contact): void => addAddresses([{ email: c.email, ...(c.name ? { name: c.name } : {}) }])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' && !text && !listOpen) {
      e.preventDefault(); setBrowsing(true); return
    }
    if (e.key === 'ArrowDown' && listOpen) {
      e.preventDefault(); setActive((i) => (i + 1) % suggestions.length); return
    }
    if (e.key === 'ArrowUp' && listOpen) {
      e.preventDefault(); setActive((i) => (i - 1 + suggestions.length) % suggestions.length); return
    }
    if (e.key === 'Escape' && (listOpen || browsing)) {
      e.preventDefault(); e.stopPropagation(); setSuggestions([]); setBrowsing(false); return
    }
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',' || e.key === ';') {
      if (listOpen && (e.key === 'Enter' || e.key === 'Tab')) {
        e.preventDefault()
        pick(suggestions[active])
        return
      }
      const committed = commitText()
      // Enter/comma always stay in the field; Tab only when it had something to commit.
      if (e.key === ',' || e.key === ';' || (committed && e.key !== 'Tab')) e.preventDefault()
      else if (committed && e.key === 'Tab') e.preventDefault()
      else if (e.key === 'Enter') { e.preventDefault(); onCommitBlur?.() }
      return
    }
    if (e.key === 'Backspace' && !text && value.length) {
      // Pop the last chip back into the input so a typo is one keystroke from fixed,
      // instead of deleting the whole recipient.
      e.preventDefault()
      const last = value[value.length - 1]
      onChange(value.slice(0, -1))
      setText(last.email)
    }
  }

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>): void => {
    const pasted = e.clipboardData.getData('text')
    // A list, or a single `Name <email>`; a lone bare address just pastes as text.
    if (!pasted || !/[,;\n<]/.test(pasted)) return
    e.preventDefault()
    addAddresses(parseAddressList(`${text}${pasted}`))
  }

  const remove = (email: string): void =>
    onChange(value.filter((a) => a.email !== email))

  // ------------------------------------------------------------ drag chips between fields

  const accepts = (e: React.DragEvent): boolean => Array.from(e.dataTransfer.types).includes(RECIPIENT_DRAG_TYPE)

  return (
    <div className="cmp-field">
      <span className="cmp-field__label">{label}</span>
      <div
        className={`cmp-chips${focused ? ' is-focused' : ''}${dropping ? ' is-drop-target' : ''}`}
        onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); inputRef.current?.focus() } }}
        onDragOver={(e) => { if (!accepts(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropping(true) }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false) }}
        onDrop={(e) => {
          if (!accepts(e)) return
          e.preventDefault(); e.stopPropagation(); setDropping(false)
          try {
            const { address, from } = JSON.parse(e.dataTransfer.getData(RECIPIENT_DRAG_TYPE)) as { address: Address; from: RecipientKind }
            if (address?.email && from !== kind) onDropAddress?.(address, from, kind)
          } catch { /* not ours */ }
        }}
      >
        {value.map((a) => {
          const suspect = suspects?.has(a.email.toLowerCase())
          return (
            <span
              key={a.email}
              className={`cmp-chip${isValidEmail(a.email) ? '' : ' is-invalid'}${suspect ? ' is-suspect' : ''}${dragging === a.email ? ' is-dragging' : ''}`}
              title={a.name ? `${a.name} <${a.email}>` : a.email}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData(RECIPIENT_DRAG_TYPE, JSON.stringify({ address: a, from: kind }))
                e.dataTransfer.setData('text/plain', a.name ? `${a.name} <${a.email}>` : a.email)
                setDragging(a.email)
                onDragActive?.(true)
              }}
              onDragEnd={() => { setDragging(null); onDragActive?.(false) }}
            >
              {chipLabel(a)}
              <button type="button" tabIndex={-1} className="cmp-chip__x" aria-label={`Remove ${a.email}`} onClick={() => remove(a.email)}>
                <X size={11} strokeWidth={2.5} />
              </button>
            </span>
          )
        })}
        <input
          ref={inputRef}
          className="cmp-chips__input"
          value={text}
          autoFocus={autoFocus}
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={listOpen}
          aria-controls={listId}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => { setText(e.target.value); setBrowsing(false) }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); commitText(); setSuggestions([]); setBrowsing(false) }}
        />
        {listOpen && (
          <ul className="cmp-suggest" id={listId} role="listbox">
            {!query && <li className="cmp-suggest__head" aria-hidden>Frequent</li>}
            {suggestions.map((c, i) => (
              <li key={c.email} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  tabIndex={-1}
                  className={`cmp-suggest__row${i === active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); pick(c) }}
                >
                  <span
                    className="cmp-suggest__avatar cmpx-avatar"
                    style={{ ['--hue' as string]: avatarHue(c.email) }}
                    aria-hidden
                  >{(c.name || c.email).charAt(0).toUpperCase()}</span>
                  <span className="cmp-suggest__text">
                    {c.name && <span className="cmp-suggest__name">{c.name}</span>}
                    <span className="cmp-suggest__email">{c.email}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {trailing && <div className="cmp-field__trailing">{trailing}</div>}
    </div>
  )
})
