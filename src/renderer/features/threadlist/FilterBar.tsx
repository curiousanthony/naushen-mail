import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlarmClock, BookmarkPlus, Calendar, CalendarDays, Check, Inbox, LayoutList, ListFilter, MailOpen,
  MessagesSquare, Newspaper, Paperclip, Plus, Reply, Star, Tag, Type, User, Users, X, type LucideIcon
} from 'lucide-react'
import {
  ATTACHMENT_KINDS, DATE_PRESETS, ENUM_VALUES, PROPS, PROP_GROUPS, PROP_ORDER, activeCount, compileConditions,
  describeCondition, isActive, newCondition, type FilterCondition, type FilterProp
} from '@shared/filters'
import type { AttachmentKind, Contact, Label, ThreadFilter } from '@shared/types'
import { useApp } from '@/lib/store'
import { useViewEditor } from '@/features/sidebar/viewEditorState'
import { accountTags, ambiguousLabelNames } from '@/features/sidebar/lib'
import { useFilters, setConditions } from './filterState'

export interface FilterBarProps {
  labels: Label[]
  /** Hide the Date/No-groups toggle -- the Categories nav has its own fixed grouping. */
  showGroupToggle?: boolean
}

const ICONS: Record<FilterProp, LucideIcon> = {
  read: MailOpen, starred: Star, reminder: AlarmClock, reply: Reply, label: Tag, account: Inbox,
  from: User, recipient: Users, newsletter: Newspaper, subject: Type, attachment: Paperclip,
  invite: CalendarDays, size: MessagesSquare, date: Calendar
}

/** Properties that make sense at most once; the others (date bounds, from, subject, label) stack. */
const STACKABLE: FilterProp[] = ['date', 'from', 'subject', 'label']

let refreshTimer: ReturnType<typeof setTimeout> | null = null
/** Coalesce rapid edits (typing in a text box) into one SQLite query. */
function refreshSoon(): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => { refreshTimer = null; void useApp.getState().refreshThreads() }, 140)
}

/**
 * Notion-database-style filters. The Filter button opens a grouped property picker; choosing one
 * adds a chip (property · operator · value) under the title and opens its editor; chips edit in
 * place, remove with the x, and all AND together. The conditions compile to a `ThreadFilter`
 * (`@shared/filters`) that the store layers onto the nav's own query, so they are evaluated in
 * SQLite over the whole mailbox -- not just the rows on screen.
 */
export function FilterBar({ labels, showGroupToggle = true }: FilterBarProps): JSX.Element {
  const settings = useApp((s) => s.settings)
  const accounts = useApp((s) => s.accounts)
  const nav = useApp((s) => s.nav)
  const accountId = useApp((s) => s.accountId)
  const updateSettings = useApp((s) => s.updateSettings)
  const openEditor = useViewEditor((s) => s.open)
  const conds = useFilters((s) => s.conditions)
  const [picker, setPicker] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const n = activeCount(conds)

  const ambiguous = useMemo(() => ambiguousLabelNames(labels), [labels])
  const tags = useMemo(() => accountTags(accounts), [accounts])
  const labelName = (id: string): string => {
    const l = labels.find((x) => x.id === id)
    if (!l) return 'Label'
    return ambiguous.has(l.name) && tags[l.accountId] ? `${l.name} (${tags[l.accountId]})` : l.name
  }
  const accountName = (id: string): string => accounts.find((a) => a.id === id)?.email ?? 'Account'
  const ctx = { labelName, accountName }

  const commit = (next: FilterCondition[]): void => { setConditions(next); refreshSoon() }
  const update = (id: string, patch: Partial<FilterCondition>): void =>
    commit(conds.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const remove = (id: string): void => { commit(conds.filter((c) => c.id !== id)); if (editing === id) setEditing(null) }
  const add = (prop: FilterProp): void => {
    const c = newCondition(prop, crypto.randomUUID())
    commit([...conds, c])
    setPicker(false)
    setEditing(c.id)
  }
  // Closing an editor on a condition that never got a value discards it (an empty "From is …" chip is noise).
  const closeEditor = (id: string): void => {
    setEditing(null)
    const c = useFilters.getState().conditions.find((x) => x.id === id)
    if (c && !isActive(c)) commit(useFilters.getState().conditions.filter((x) => x.id !== id))
  }

  const available = PROP_ORDER.filter((p) =>
    (p !== 'account' || (accounts.length > 1 && accountId === 'all')) &&
    (STACKABLE.includes(p) || !conds.some((c) => c.prop === p)))

  const saveAsView = (): void => {
    const compiled: ThreadFilter = compileConditions(conds)
    const role = nav.kind === 'role' ? nav.role : 'any'
    const labelIds = nav.kind === 'label' ? [nav.labelId] : []
    // The view editor owns these fields; everything else rides along in `extra`.
    const { from, unread, hasAttachment, accountIds, ...extra } = compiled
    if (from && from.length > 1) (extra as ThreadFilter).from = from
    if (unread === false) (extra as ThreadFilter).unread = false
    if (hasAttachment === false || compiled.attachmentKinds || compiled.minAttachmentSize) (extra as ThreadFilter).hasAttachment = hasAttachment
    openEditor(null, {
      accountId: accountIds?.length === 1 ? accountIds[0] : accountId, role, labelIds,
      from: from?.length === 1 ? from[0] : '', unread: unread === true,
      attachment: hasAttachment === true && !compiled.attachmentKinds && !compiled.minAttachmentSize, extra
    })
  }

  return (
    <>
      <div className="tl__tools">
        <span className="tl__anchor">
          <button
            className="tl__tool" data-on={n > 0 || picker} aria-haspopup="dialog" aria-expanded={picker}
            onClick={() => { setEditing(null); setPicker((v) => !v) }}
          >
            <ListFilter size={14} /> Filter{n > 0 ? ` · ${n}` : ''}
          </button>
          {picker && <PropertyPicker props={available} onPick={add} onClose={() => setPicker(false)} />}
        </span>
        {showGroupToggle && (
          <button className="tl__tool" onClick={() => void updateSettings({ groupByDate: !settings.groupByDate })} title="Group conversations by date">
            <LayoutList size={14} /> {settings.groupByDate ? 'Date' : 'No groups'}
          </button>
        )}
      </div>

      {conds.length > 0 && (
        <div className="tl__chiprow" role="group" aria-label="Active filters">
          {conds.map((c) => {
            const Icon = ICONS[c.prop]
            const [prop, op, value] = describeCondition(c, ctx)
            return (
              <span key={c.id} className="tl__anchor">
                <span className="tl__fchip" data-open={editing === c.id} data-pending={!isActive(c)}>
                  <button
                    className="tl__fchip-main" aria-haspopup="dialog" aria-expanded={editing === c.id}
                    onClick={() => { setPicker(false); if (editing === c.id) closeEditor(c.id); else setEditing(c.id) }}
                  >
                    <Icon size={12} className="tl__fchip-icon" />
                    <span className="tl__fchip-prop">{prop}</span>
                    <span className="tl__fchip-op">{op}</span>
                    {value && <span className="tl__fchip-val">{value}</span>}
                  </button>
                  <button className="tl__fchip-x" onClick={() => remove(c.id)} aria-label={`Remove ${prop} filter`}><X size={11} /></button>
                </span>
                {editing === c.id && (
                  <ConditionEditor
                    cond={c} labels={labels} accounts={accounts} owner={(l) => (ambiguous.has(l.name) ? tags[l.accountId] : undefined)}
                    onChange={(patch) => update(c.id, patch)} onClose={() => closeEditor(c.id)}
                  />
                )}
              </span>
            )
          })}
          <button className="tl__fadd" onClick={() => { setEditing(null); setPicker(true) }} aria-label="Add a filter"><Plus size={12} /> Add</button>
          {conds.length > 1 && <button className="tl__clear" onClick={() => { commit([]); setEditing(null) }}>Clear all</button>}
          {n > 0 && (
            <button className="tl__clear tl__fsave" onClick={saveAsView}><BookmarkPlus size={12} /> Save as view…</button>
          )}
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- popover

/** Anchored dropdown: closes on outside mousedown or Escape (capture, so it never reaches global shortcuts). */
function Popover({ onClose, label, children, wide }: { onClose(): void; label: string; children: ReactNode; wide?: boolean }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const anchor = ref.current?.parentElement
    const onDown = (e: MouseEvent): void => { if (anchor && !anchor.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation(); e.preventDefault()
      onClose()
      anchor?.querySelector<HTMLElement>('button')?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true) }
  }, [onClose])
  return <div ref={ref} className="tl__pop" data-wide={wide} role="dialog" aria-label={label}>{children}</div>
}

// ---------------------------------------------------------------- property picker

function PropertyPicker({ props, onPick, onClose }: { props: FilterProp[]; onPick(p: FilterProp): void; onClose(): void }): JSX.Element {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])

  const shown = props.filter((p) => {
    const d = PROPS[p]
    return !q.trim() || `${d.label} ${d.hint}`.toLowerCase().includes(q.trim().toLowerCase())
  })
  useEffect(() => setActive(0), [q])
  useEffect(() => { document.getElementById(`fprop-${shown[active]}`)?.scrollIntoView({ block: 'nearest' }) }, [active, shown])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(shown.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter' && shown[active]) { e.preventDefault(); onPick(shown[active]) }
  }

  return (
    <Popover onClose={onClose} label="Add a filter">
      <input
        ref={inputRef} className="tl__pop-search" placeholder="Filter by…" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown} role="combobox" aria-expanded aria-controls="fprop-list" aria-activedescendant={shown[active] ? `fprop-${shown[active]}` : undefined}
      />
      <div id="fprop-list" className="tl__pop-list" role="listbox">
        {PROP_GROUPS.map((g) => {
          const items = shown.filter((p) => PROPS[p].group === g)
          if (!items.length) return null
          return (
            <div key={g} role="group" aria-label={g}>
              <div className="tl__pop-group">{g}</div>
              {items.map((p) => {
                const Icon = ICONS[p]
                return (
                  <button
                    key={p} id={`fprop-${p}`} role="option" aria-selected={shown[active] === p} tabIndex={-1}
                    className="tl__pop-item" data-active={shown[active] === p}
                    onMouseEnter={() => setActive(shown.indexOf(p))} onClick={() => onPick(p)}
                  >
                    <Icon size={14} className="tl__pop-icon" />
                    <span className="tl__pop-name">{PROPS[p].label}</span>
                    <span className="tl__pop-hint">{PROPS[p].hint}</span>
                  </button>
                )
              })}
            </div>
          )
        })}
        {!shown.length && <div className="tl__pop-empty">No matching property</div>}
      </div>
    </Popover>
  )
}

// ---------------------------------------------------------------- condition editor

interface EditorProps {
  cond: FilterCondition
  labels: Label[]
  accounts: { id: string; email: string; name: string }[]
  owner(l: Label): string | undefined
  onChange(patch: Partial<FilterCondition>): void
  onClose(): void
}

function ConditionEditor({ cond, labels, accounts, owner, onChange, onClose }: EditorProps): JSX.Element {
  const def = PROPS[cond.prop]
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bodyRef.current?.querySelector<HTMLElement>('input:not([type=checkbox]), [role=radio][aria-checked=true], [role=radio], [role=checkbox]')?.focus()
  }, [cond.op === 'type' || cond.op === 'larger' ? cond.op : cond.prop])

  const toggle = (list: string[] | undefined, v: string): string[] => {
    const cur = list ?? []
    return cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]
  }
  const enums = ENUM_VALUES[cond.prop]

  let body: ReactNode = null
  if (enums) {
    body = <RadioList options={enums} value={cond.value} onPick={(v) => { onChange({ value: v }) }} />
  } else if (cond.prop === 'from') {
    body = <SenderInput value={cond.value ?? ''} domain={cond.op === 'domain'} onChange={(value) => onChange({ value })} onDone={onClose} />
  } else if (cond.prop === 'subject') {
    body = (
      <input
        className="tl__pop-input" placeholder="Word or phrase in the subject" value={cond.value ?? ''}
        onChange={(e) => onChange({ value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') onClose() }}
      />
    )
  } else if (cond.prop === 'label') {
    body = labels.length ? (
      <CheckList
        items={labels.map((l) => ({ key: l.id, label: l.name, sub: owner(l), dot: `var(--chip-${l.color ?? 'gray'}-fg)` }))}
        selected={cond.values ?? []} onToggle={(k) => onChange({ values: toggle(cond.values, k) })}
      />
    ) : <div className="tl__pop-empty">No labels yet</div>
  } else if (cond.prop === 'account') {
    body = <CheckList items={accounts.map((a) => ({ key: a.id, label: a.email }))} selected={cond.values ?? []} onToggle={(k) => onChange({ values: toggle(cond.values, k) })} />
  } else if (cond.prop === 'attachment') {
    if (cond.op === 'type') {
      body = <CheckList items={ATTACHMENT_KINDS.map((k) => ({ key: k.key, label: k.label }))} selected={cond.values ?? []} onToggle={(k) => onChange({ values: toggle(cond.values, k) as AttachmentKind[] })} />
    } else if (cond.op === 'larger') {
      body = <NumberField value={cond.n ?? 1} unit="MB" presets={[1, 5, 10, 25]} onChange={(n) => onChange({ n })} />
    }
  } else if (cond.prop === 'size') {
    if (cond.op === 'atleast') body = <NumberField value={cond.n ?? 2} unit="messages" presets={[3, 5, 10]} min={2} onChange={(n) => onChange({ n })} />
  } else if (cond.prop === 'date') {
    if (cond.op === 'within') {
      body = <RadioList options={DATE_PRESETS} value={cond.value} onPick={(v) => onChange({ value: v })} />
    } else {
      body = (
        <div className="tl__pop-dates">
          {cond.op !== 'before' && (
            <label>{cond.op === 'between' ? 'From' : 'Date'}<input type="date" value={cond.from ?? ''} max={cond.to || undefined} onChange={(e) => onChange({ from: e.target.value })} /></label>
          )}
          {cond.op !== 'after' && (
            <label>{cond.op === 'between' ? 'To' : 'Date'}<input type="date" value={cond.to ?? ''} min={cond.from || undefined} onChange={(e) => onChange({ to: e.target.value })} /></label>
          )}
        </div>
      )
    }
  }

  const setOp = (op: string): void => {
    const patch: Partial<FilterCondition> = { op }
    if (cond.prop === 'date' && op === 'within' && !cond.value) patch.value = '7d'
    if (cond.prop === 'attachment' && op === 'type' && !cond.values) patch.values = []
    onChange(patch)
  }

  return (
    <Popover onClose={onClose} label={`Edit ${def.label} filter`} wide={cond.prop === 'label' || cond.prop === 'reply' || cond.prop === 'newsletter'}>
      <div className="tl__pop-head">
        <span className="tl__pop-title">{def.label}</span>
        {def.ops.length > 1 && (
          <select className="tl__pop-select" value={cond.op} onChange={(e) => setOp(e.target.value)} aria-label="Operator">
            {def.ops.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        )}
      </div>
      {body && <div ref={bodyRef} className="tl__pop-body">{body}</div>}
    </Popover>
  )
}

function RadioList({ options, value, onPick }: { options: { key: string; label: string }[]; value?: string; onPick(v: string): void }): JSX.Element {
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const btns = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role=radio]'))
    const i = btns.indexOf(document.activeElement as HTMLElement)
    const next = btns[(i + (e.key === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length]
    next?.focus()
    next?.click()
  }
  return (
    <div role="radiogroup" className="tl__pop-radios" onKeyDown={onKey}>
      {options.map((o) => (
        <button key={o.key} role="radio" aria-checked={value === o.key} tabIndex={value === o.key || (!value && o === options[0]) ? 0 : -1} className="tl__pop-item" data-on={value === o.key} onClick={() => onPick(o.key)}>
          <span className="tl__pop-check">{value === o.key && <Check size={13} />}</span>
          <span className="tl__pop-name">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

function CheckList({ items, selected, onToggle }: {
  items: { key: string; label: string; sub?: string; dot?: string }[]; selected: string[]; onToggle(k: string): void
}): JSX.Element {
  return (
    <div className="tl__pop-radios tl__pop-scroll" role="group">
      {items.map((it) => {
        const on = selected.includes(it.key)
        return (
          <button key={it.key} role="checkbox" aria-checked={on} className="tl__pop-item" data-on={on} onClick={() => onToggle(it.key)}>
            <span className="tl__pop-check">{on ? <Check size={13} /> : it.dot ? <span className="tl__pop-dot" style={{ background: it.dot }} /> : null}</span>
            <span className="tl__pop-name">{it.label}</span>
            {it.sub && <span className="tl__pop-hint">{it.sub}</span>}
          </button>
        )
      })}
    </div>
  )
}

function NumberField({ value, unit, presets, min = 1, onChange }: { value: number; unit: string; presets: number[]; min?: number; onChange(n: number): void }): JSX.Element {
  return (
    <div className="tl__pop-num">
      <input type="number" min={min} value={value} onChange={(e) => onChange(Math.max(min, Math.floor(+e.target.value || min)))} aria-label={unit} />
      <span>{unit}</span>
      {presets.map((p) => <button key={p} className="tl__pop-preset" data-on={value === p} onClick={() => onChange(p)}>{p}</button>)}
    </div>
  )
}

/**
 * Sender box with autocomplete from the address book (`contacts.suggest`, the same source the
 * composer uses). In "domain" mode the suggestions collapse to distinct domains.
 */
function SenderInput({ value, domain, onChange, onDone }: { value: string; domain: boolean; onChange(v: string): void; onDone(): void }): JSX.Element {
  const [list, setList] = useState<Contact[]>([])
  const [active, setActive] = useState(-1)
  useEffect(() => {
    const q = value.trim().replace(/^@/, '')
    if (q.length < 1) { setList([]); return }
    let cancelled = false
    const t = setTimeout(() => {
      void window.api.invoke('contacts.suggest', q, 12).then((r) => { if (!cancelled) { setList(r); setActive(-1) } })
    }, 100)
    return () => { cancelled = true; clearTimeout(t) }
  }, [value])

  const options = useMemo(() => {
    if (!domain) return list.slice(0, 6).map((c) => ({ key: c.email, label: c.name || c.email, sub: c.name ? c.email : undefined }))
    const seen = new Set<string>()
    const out: { key: string; label: string; sub?: string }[] = []
    for (const c of list) {
      const d = c.email.split('@')[1]
      if (d && !seen.has(d)) { seen.add(d); out.push({ key: d, label: d }) }
    }
    return out.slice(0, 6)
  }, [list, domain])

  const pick = (key: string): void => { onChange(key); setList([]); setActive(-1) }
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' && options.length) { e.preventDefault(); setActive((i) => (i + 1) % options.length) }
    else if (e.key === 'ArrowUp' && options.length) { e.preventDefault(); setActive((i) => (i <= 0 ? options.length - 1 : i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0 && options[active]) pick(options[active].key); else onDone() }
  }
  return (
    <div className="tl__pop-sender">
      <input
        className="tl__pop-input" value={value} placeholder={domain ? 'example.com' : 'Name or address'}
        onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} role="combobox" aria-expanded={options.length > 0} aria-autocomplete="list"
      />
      {options.length > 0 && !options.some((o) => o.key === value.trim()) && (
        <div className="tl__pop-radios" role="listbox">
          {options.map((o, i) => (
            <button key={o.key} role="option" aria-selected={i === active} tabIndex={-1} className="tl__pop-item" data-active={i === active} onClick={() => pick(o.key)}>
              <span className="tl__pop-name">{o.label}</span>
              {o.sub && <span className="tl__pop-hint">{o.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
