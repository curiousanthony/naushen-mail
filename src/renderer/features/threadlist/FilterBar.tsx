import { Check, LayoutList, ListFilter, Paperclip, X } from 'lucide-react'
import type { Label } from '@shared/types'
import { useApp } from '@/lib/store'
import { Popover, useAnchor } from '@/features/sidebar/Popover'
import { accountTags, ambiguousLabelNames } from '@/features/sidebar/lib'
import { chipStyle } from '@/lib/labels'
import { EMPTY_CHIPS, chipCount, type Chips } from './lib'

export interface FilterBarProps {
  chips: Chips
  onChange(next: Chips): void
  labels: Label[]
}

/** Filter popover (Unread / Attachments / labels / From) plus the group-by toggle. */
export function FilterBar({ chips, onChange, labels }: FilterBarProps): JSX.Element {
  const settings = useApp((s) => s.settings)
  const accounts = useApp((s) => s.accounts)
  const updateSettings = useApp((s) => s.updateSettings)
  const [anchor, toggle, close] = useAnchor()
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

  return (
    <div className="tl__tools">
      {chips.unread && <ActiveChip label="Unread" onClear={() => set({ unread: false })} />}
      {chips.attachments && <ActiveChip label="Attachments" onClear={() => set({ attachments: false })} />}
      {chips.labelIds.map((id) => (
        <ActiveChip key={id} label={byName(id)} onClear={() => set({ labelIds: chips.labelIds.filter((x) => x !== id) })} />
      ))}
      {chips.from.trim() && <ActiveChip label={`From: ${chips.from.trim()}`} onClear={() => set({ from: '' })} />}
      {n > 1 && <button className="tl__clear" onClick={() => onChange(EMPTY_CHIPS)}>Clear all</button>}

      <button className="tl__tool" data-on={n > 0} onClick={toggle} aria-haspopup="menu" aria-expanded={!!anchor}>
        <ListFilter size={14} /> Filter{n > 0 ? ` · ${n}` : ''}
      </button>

      <button
        className="tl__tool" title="Group conversations by date"
        onClick={() => void updateSettings({ groupByDate: !settings.groupByDate })}
      >
        <LayoutList size={14} /> {settings.groupByDate ? 'Date' : 'No groups'}
      </button>

      {anchor && (
        <Popover anchor={anchor} onClose={close} align="end" width={252} label="Filter conversations">
          <button className="menu__item" data-menuitem data-on={chips.unread} onClick={() => set({ unread: !chips.unread })} role="menuitemcheckbox" aria-checked={chips.unread}>
            <span className="menu__icon">{chips.unread ? <Check size={14} /> : <span className="menu__bullet" />}</span>
            <span className="menu__label"><span className="menu__title">Unread</span></span>
          </button>
          <button className="menu__item" data-menuitem data-on={chips.attachments} onClick={() => set({ attachments: !chips.attachments })} role="menuitemcheckbox" aria-checked={chips.attachments}>
            <span className="menu__icon">{chips.attachments ? <Check size={14} /> : <Paperclip size={13} />}</span>
            <span className="menu__label"><span className="menu__title">Has attachment</span></span>
          </button>

          <div className="menu__sep" />
          <div className="menu__field">
            <label htmlFor="tl-from">From</label>
            <input
              id="tl-from" value={chips.from} placeholder="name or address"
              onChange={(e) => set({ from: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') close() }}
            />
          </div>

          {labels.length > 0 && (
            <>
              <div className="menu__sep" />
              <div className="menu__grouplabel">Labels</div>
              {labels.map((l) => {
                const on = chips.labelIds.includes(l.id)
                return (
                  <button
                    key={l.id} className="menu__item" data-menuitem data-on={on} role="menuitemcheckbox" aria-checked={on}
                    onClick={() => set({ labelIds: on ? chips.labelIds.filter((x) => x !== l.id) : [...chips.labelIds, l.id] })}
                  >
                    <span className="menu__icon">{on ? <Check size={14} /> : <span className="dot" style={{ background: `var(--chip-${l.color ?? 'gray'}-fg)` }} />}</span>
                    <span className="menu__label">
                      <span className="menu__title">{l.name}</span>
                      {owner(l) && <span className="menu__sub">{owner(l)}</span>}
                    </span>
                    <span className="trow__chip" style={chipStyle(l.color)}>{l.name}</span>
                  </button>
                )
              })}
            </>
          )}
        </Popover>
      )}
    </div>
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
