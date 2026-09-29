import { useEffect, useRef, useState } from 'react'
import { BookmarkPlus, Check, LayoutList, ListFilter, Paperclip, X } from 'lucide-react'
import type { Contact, Label } from '@shared/types'
import { useApp } from '@/lib/store'
import { useViewEditor } from '@/features/sidebar/viewEditorState'
import { accountTags, ambiguousLabelNames } from '@/features/sidebar/lib'
import { chipStyle } from '@/lib/labels'
import { EMPTY_CHIPS, chipCount, type Chips } from './lib'

export interface FilterBarProps {
  chips: Chips
  onChange(next: Chips): void
  labels: Label[]
  /** Hide the Date/No-groups toggle -- the Categories nav has its own fixed grouping, not a
   *  user-togglable one (see threadlist/index.tsx). Defaults on everywhere else. */
  showGroupToggle?: boolean
}

/**
 * Filter chips: a Notion-database-style refinement on the *current* view, not a second search
 * engine — it only ever narrows the threads already loaded for this mailbox (see lib.ts's
 * `applyChips`), the same way a database filter only ever narrows the rows already in that view.
 * The sidebar's search box is the one that reaches everywhere.
 *
 * Deliberately an inline panel under the header (`position: relative` on .tl__bar, `absolute`
 * here), not a portalled popover with a document-level outside-click listener: simpler state
 * (one boolean), nothing to race.
 */
export function FilterBar({ chips, onChange, labels, showGroupToggle = true }: FilterBarProps): JSX.Element {
  const settings = useApp((s) => s.settings)
  const accounts = useApp((s) => s.accounts)
  const nav = useApp((s) => s.nav)
  const accountId = useApp((s) => s.accountId)
  const updateSettings = useApp((s) => s.updateSettings)
  const openEditor = useViewEditor((s) => s.open)
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<Contact[]>([])
  const panelRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const n = chipCount(chips)

  // Two accounts can both have a "Receipts"; name the owner only on the rows that collide.
  const ambiguous = ambiguousLabelNames(labels)
  const tags = accountTags(accounts)
  const owner = (l: Label): string | undefined => (ambiguous.has(l.name) ? tags[l.accountId] : undefined)
  const byName = (id: string): string => {
    const l = labels.find((x) => x.id === id)
    if (!l) return 'Label'
    const tag = owner(l)
    return tag ? `${l.name} (${tag})` : l.name
  }

  const set = (patch: Partial<Chips>): void => onChange({ ...chips, ...patch })

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!panelRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  // Contact suggestions for "From" -- the same lookup the sidebar's own search box uses, so a
  // sender who doesn't turn anything up here is genuinely absent from *this* view, not just
  // unmatched by a weaker search.
  useEffect(() => {
    const q = chips.from.trim()
    if (!open || q.length < 2) { setSuggestions([]); return }
    let cancelled = false
    const t = setTimeout(() => {
      void window.api.invoke('contacts.suggest', q, 5).then((list) => { if (!cancelled) setSuggestions(list) })
    }, 120)
    return () => { cancelled = true; clearTimeout(t) }
  }, [open, chips.from])

  const saveAsView = (): void => {
    setOpen(false)
    const role = nav.kind === 'role' ? nav.role : 'any'
    const labelIds = nav.kind === 'label' ? [...new Set([...chips.labelIds, nav.labelId])] : chips.labelIds
    openEditor(null, { accountId, role, labelIds, from: chips.from, unread: chips.unread, attachment: chips.attachments })
  }

  return (
    <div className="tl__tools">
      {chips.unread && <ActiveChip label="Unread" onClear={() => set({ unread: false })} />}
      {chips.attachments && <ActiveChip label="Attachments" onClear={() => set({ attachments: false })} />}
      {chips.labelIds.map((id) => (
        <ActiveChip key={id} label={byName(id)} onClear={() => set({ labelIds: chips.labelIds.filter((x) => x !== id) })} />
      ))}
      {chips.from.trim() && <ActiveChip label={`From: ${chips.from.trim()}`} onClear={() => set({ from: '' })} />}
      {n > 1 && <button className="tl__clear" onClick={() => onChange(EMPTY_CHIPS)}>Clear all</button>}

      <button ref={btnRef} className="tl__tool" data-on={n > 0 || open} onClick={() => setOpen((v) => !v)} aria-haspopup="true" aria-expanded={open}>
        <ListFilter size={14} /> Filter{n > 0 ? ` · ${n}` : ''}
      </button>

      {showGroupToggle && (
        <button className="tl__tool" onClick={() => void updateSettings({ groupByDate: !settings.groupByDate })} title="Group conversations by date">
          <LayoutList size={14} /> {settings.groupByDate ? 'Date' : 'No groups'}
        </button>
      )}

      {open && (
        <div ref={panelRef} className="tl__filterpanel" role="dialog" aria-label="Filter conversations">
          <div className="tl__filterrow">
            <FilterPill on={chips.unread} onClick={() => set({ unread: !chips.unread })}>Unread</FilterPill>
            <FilterPill on={chips.attachments} onClick={() => set({ attachments: !chips.attachments })} icon={<Paperclip size={11} />}>
              Has attachment
            </FilterPill>
          </div>

          <div className="tl__filterfrom">
            <input
              value={chips.from} placeholder="From: name or address"
              onChange={(e) => set({ from: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') setOpen(false) }}
            />
            {suggestions.length > 0 && (
              <div className="tl__filtersuggest">
                {suggestions.map((c) => (
                  <button key={c.email} onClick={() => { set({ from: c.email }); setSuggestions([]) }}>
                    <span className="tl__filtersuggest-name">{c.name || c.email}</span>
                    {c.name && <span className="tl__filtersuggest-email">{c.email}</span>}
                  </button>
                ))}
              </div>
            )}
            <p className="tl__filterhint">Narrows conversations already in this view — not a full-mailbox search.</p>
          </div>

          {labels.length > 0 && (
            <div className="tl__filterlabels">
              {labels.map((l) => {
                const on = chips.labelIds.includes(l.id)
                return (
                  <button
                    key={l.id} className="tl__filterlabel" data-on={on}
                    onClick={() => set({ labelIds: on ? chips.labelIds.filter((x) => x !== l.id) : [...chips.labelIds, l.id] })}
                  >
                    <span className="tl__filterlabel-check">{on ? <Check size={12} /> : <span className="dot" style={{ background: `var(--chip-${l.color ?? 'gray'}-fg)` }} />}</span>
                    <span className="tl__filterlabel-name">{l.name}</span>
                    {owner(l) && <span className="menu__sub">{owner(l)}</span>}
                  </button>
                )
              })}
            </div>
          )}

          {n > 0 && (
            <button className="tl__filtersave" onClick={saveAsView}>
              <BookmarkPlus size={13} /> Save as view…
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function FilterPill({ on, onClick, icon, children }: { on: boolean; onClick(): void; icon?: React.ReactNode; children: React.ReactNode }): JSX.Element {
  return (
    <button className="tl__filterpill" data-on={on} onClick={onClick} role="checkbox" aria-checked={on}>
      <span className="tl__filterpill-check">{on ? <Check size={11} /> : icon ?? <span className="tl__filterpill-neutral" />}</span>
      {children}
    </button>
  )
}

function ActiveChip({ label, onClear }: { label: string; onClear(): void }): JSX.Element {
  return (
    <span className="tl__activechip">
      {label}
      <button onClick={onClear} aria-label={`Remove ${label} filter`}><X size={11} /></button>
    </span>
  )
}
