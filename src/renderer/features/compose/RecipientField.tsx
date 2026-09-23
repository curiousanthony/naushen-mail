/**
 * To / Cc / Bcc: a row of chips plus an inline autocomplete over `contacts.suggest`.
 * Parsing lives in `recipients.ts`; this only decides *when* text becomes a chip.
 */

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Address, Contact } from '@shared/types'
import { chipLabel, dedupeAddresses, isValidEmail, parseAddress, parseAddressList } from './recipients'

interface Props {
  label: string
  value: Address[]
  onChange: (next: Address[]) => void
  /** Rendered at the right of the row (the Cc / Bcc reveal links). */
  trailing?: React.ReactNode
  autoFocus?: boolean
  /** Called when the user tabs/enters out of an empty field (moves to the next field). */
  onCommitBlur?: () => void
}

/** Imperative escape hatch so the composer can force any pending, uncommitted text into a
 *  chip right before send — a mouse-click Send gets this for free via the input's blur, but
 *  a keyboard shortcut (⌘Enter) can fire while text is still sitting uncommitted in the field.
 *  Returns the parsed address (or null) rather than relying on `onChange`/state, since the
 *  caller needs it synchronously in the same tick — a `setState` from here wouldn't be visible
 *  yet to code reading `value` right after calling this. */
export interface RecipientFieldHandle {
  commitPending(): Address | null
}

export const RecipientField = forwardRef<RecipientFieldHandle, Props>(function RecipientField(
  { label, value, onChange, trailing, autoFocus, onCommitBlur }, ref
) {
  const [text, setText] = useState('')
  const [suggestions, setSuggestions] = useState<Contact[]>([])
  const [active, setActive] = useState(0)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  // Debounced suggestion lookup; ignores out-of-order responses.
  useEffect(() => {
    const q = text.trim()
    if (!q) { setSuggestions([]); return }
    let cancelled = false
    const t = setTimeout(() => {
      void window.api.invoke('contacts.suggest', q).then((list) => {
        if (cancelled) return
        const taken = new Set(value.map((a) => a.email.toLowerCase()))
        setSuggestions(list.filter((c) => !taken.has(c.email.toLowerCase())).slice(0, 6))
        setActive(0)
      }).catch(() => undefined)
    }, 120)
    return () => { cancelled = true; clearTimeout(t) }
  }, [text, value])

  const addAddresses = useCallback((list: Address[]) => {
    if (!list.length) return
    onChange(dedupeAddresses([...value, ...list]))
    setText('')
    setSuggestions([])
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
    }
  }), [text, addAddresses])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    const hasSuggestion = suggestions.length > 0 && text.trim().length > 0

    if (e.key === 'ArrowDown' && hasSuggestion) {
      e.preventDefault(); setActive((i) => (i + 1) % suggestions.length); return
    }
    if (e.key === 'ArrowUp' && hasSuggestion) {
      e.preventDefault(); setActive((i) => (i - 1 + suggestions.length) % suggestions.length); return
    }
    if (e.key === 'Escape' && hasSuggestion) {
      e.preventDefault(); e.stopPropagation(); setSuggestions([]); return
    }
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',' || e.key === ';') {
      if (hasSuggestion && (e.key === 'Enter' || e.key === 'Tab')) {
        e.preventDefault()
        const c = suggestions[active]
        addAddresses([{ email: c.email, ...(c.name ? { name: c.name } : {}) }])
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
      e.preventDefault()
      onChange(value.slice(0, -1))
    }
  }

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>): void => {
    const pasted = e.clipboardData.getData('text')
    if (!pasted || !/[,;\n]/.test(pasted)) return
    e.preventDefault()
    addAddresses(parseAddressList(`${text}${pasted}`))
  }

  const remove = (email: string): void =>
    onChange(value.filter((a) => a.email !== email))

  return (
    <div className="cmp-field">
      <span className="cmp-field__label">{label}</span>
      <div
        className={`cmp-chips${focused ? ' is-focused' : ''}`}
        onMouseDown={(e) => { if (e.target === e.currentTarget) inputRef.current?.focus() }}
      >
        {value.map((a) => (
          <span
            key={a.email}
            className={`cmp-chip${isValidEmail(a.email) ? '' : ' is-invalid'}`}
            title={a.name ? `${a.name} <${a.email}>` : a.email}
          >
            {chipLabel(a)}
            <button type="button" className="cmp-chip__x" aria-label={`Remove ${a.email}`} onClick={() => remove(a.email)}>
              <X size={11} strokeWidth={2.5} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="cmp-chips__input"
          value={text}
          autoFocus={autoFocus}
          aria-label={label}
          aria-autocomplete="list"
          aria-controls={listId}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); commitText(); setSuggestions([]) }}
        />
        {suggestions.length > 0 && focused && text.trim() && (
          <ul className="cmp-suggest" id={listId} role="listbox">
            {suggestions.map((c, i) => (
              <li key={c.email} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  className={`cmp-suggest__row${i === active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); addAddresses([{ email: c.email, ...(c.name ? { name: c.name } : {}) }]) }}
                >
                  <span className="cmp-suggest__avatar" aria-hidden>{(c.name || c.email).charAt(0).toUpperCase()}</span>
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
