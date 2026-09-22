import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlarmClock, ChevronDown, ChevronsUpDown, FileText, Layers, MoreHorizontal, PencilLine,
  Plus, Search, Send, Settings as SettingsIcon, ShieldAlert, Trash2, X
} from 'lucide-react'
import type { Account, Counts, View } from '@shared/types'
import { useApp, type Nav } from '@/lib/store'
import { initials } from '@/lib/format'
import { Popover, useAnchor } from './Popover'
import { ViewEditor } from './ViewEditor'
import { useViewEditor } from './viewEditorState'
import {
  MAIL_ITEMS, accountLabel, accountTags, ambiguousLabelNames, loadCollapsed, mailNav, navEquals,
  saveCollapsed, sidebarLabels, sidebarViews, unreadFor
} from './lib'
import './sidebar.css'

const MAIL_ICON: Record<string, ReactNode> = {
  all: <Layers size={16} />, sent: <Send size={16} />, drafts: <FileText size={16} />,
  snoozed: <AlarmClock size={16} />, trash: <Trash2 size={16} />, spam: <ShieldAlert size={16} />
}

/** Left navigation: accounts, compose, search, Views, Mail, Labels, Settings. */
export function Sidebar(): JSX.Element {
  const accounts = useApp((s) => s.accounts)
  const labels = useApp((s) => s.labels)
  const views = useApp((s) => s.views)
  const counts = useApp((s) => s.counts)
  const accountId = useApp((s) => s.accountId)
  const nav = useApp((s) => s.nav)
  const setNav = useApp((s) => s.setNav)
  const setOverlay = useApp((s) => s.setOverlay)
  const openComposer = useApp((s) => s.openComposer)
  const collapsedRail = useApp((s) => s.sidebarCollapsed)
  const openEditor = useViewEditor((s) => s.open)

  const [sections, setSections] = useState<Record<string, boolean>>(loadCollapsed)
  const toggleSection = useCallback((id: string) => {
    setSections((s) => { const next = { ...s, [id]: !s[id] }; saveCollapsed(next); return next })
  }, [])

  const aux = useAuxCounts(views, accountId, counts)
  const userLabels = useMemo(() => sidebarLabels(labels, accountId), [labels, accountId])
  const ambiguous = useMemo(() => ambiguousLabelNames(userLabels), [userLabels])
  const tags = useMemo(() => accountTags(accounts), [accounts])
  const shownViews = useMemo(() => sidebarViews(views), [views])
  const go = useCallback((n: Nav) => setNav(n), [setNav])

  return (
    <>
      <aside className="sidebar" data-collapsed={collapsedRail} aria-label="Mailboxes" aria-hidden={collapsedRail}>
        <div className="sidebar__drag drag" />
        <div className="sidebar__top no-drag">
          <AccountSwitcher accounts={accounts} accountId={accountId} counts={counts} />
          <button
            className="sidebar__icon" title="New message" aria-label="New message"
            onClick={() => openComposer()}
          >
            <PencilLine size={16} />
          </button>
        </div>

        <SearchRow />

        <nav className="sidebar__scroll no-drag">
          <Section
            id="views" title="Views" collapsed={!!sections.views} onToggle={toggleSection}
            action={{ icon: <Plus size={14} />, label: 'New view', onClick: () => openEditor(null) }}
          >
            <Row
              emoji="📥" label="Inbox" count={unreadFor(counts, accountId, 'inbox')}
              active={navEquals(nav, { kind: 'role', role: 'inbox' })}
              onClick={() => go({ kind: 'role', role: 'inbox' })}
            />
            {shownViews.map((v) => (
              <ViewRow
                key={v.id} view={v} count={aux.views[v.id] ?? 0}
                active={navEquals(nav, { kind: 'view', viewId: v.id })}
                onClick={() => go({ kind: 'view', viewId: v.id })}
              />
            ))}
          </Section>

          <Section id="mail" title="Mail" collapsed={!!sections.mail} onToggle={toggleSection}>
            {MAIL_ITEMS.filter((m) => !m.snoozed || aux.hasSnoozed).map((m) => (
              <Row
                key={m.id} icon={MAIL_ICON[m.id]} label={m.name}
                count={m.role ? unreadFor(counts, accountId, m.role) : 0}
                active={navEquals(nav, mailNav(m))} onClick={() => go(mailNav(m))}
              />
            ))}
          </Section>

          {userLabels.length > 0 && (
            <Section id="labels" title="Labels" collapsed={!!sections.labels} onToggle={toggleSection}>
              {userLabels.map((l) => {
                const owner = accounts.find((a) => a.id === l.accountId)
                // Two accounts can both have a "Receipts"; name the owner only when they do.
                const dup = ambiguous.has(l.name)
                return (
                  <Row
                    key={l.id} label={l.name} count={unreadFor(counts, accountId, l.id)}
                    dot={`var(--chip-${l.color ?? 'gray'}-fg)`}
                    suffix={dup ? tags[l.accountId] : undefined}
                    active={navEquals(nav, { kind: 'label', labelId: l.id })}
                    onClick={() => go({ kind: 'label', labelId: l.id })}
                    trailing={dup
                      ? <span className="sidebar__acctdot" style={{ background: owner?.color }} />
                      : undefined}
                    title={`${l.name} · ${owner?.email ?? ''}`}
                  />
                )
              })}
            </Section>
          )}
        </nav>

        <div className="sidebar__foot no-drag">
          <Row icon={<SettingsIcon size={16} />} label="Settings" onClick={() => setOverlay('settings')} />
        </div>
      </aside>
      <ViewEditor />
    </>
  )
}

// ---------------------------------------------------------------- account switcher

function AccountSwitcher({ accounts, accountId, counts }: {
  accounts: Account[]; accountId: string; counts: Counts
}): JSX.Element {
  const setAccount = useApp((s) => s.setAccount)
  const setOverlay = useApp((s) => s.setOverlay)
  const [anchor, toggle, close] = useAnchor()
  const active = accounts.find((a) => a.id === accountId) ?? null
  const name = active ? accountLabel(active.name, active.email) : 'All accounts'
  const sub = active ? active.email : `${accounts.length} account${accounts.length === 1 ? '' : 's'}`

  const pick = (id: string): void => { setAccount(id); close() }

  return (
    <>
      <button className="acct" onClick={toggle} aria-haspopup="menu" aria-expanded={!!anchor} title={sub}>
        <span className="acct__avatar" style={{ background: active?.color ?? 'var(--c-text-3)' }}>
          {active ? initials({ name: active.name, email: active.email }) : <Layers size={12} strokeWidth={2.5} />}
        </span>
        <span className="acct__text">
          <span className="acct__name">{name}</span>
          <span className="acct__sub">{sub}</span>
        </span>
        <ChevronsUpDown size={13} className="acct__chev" />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={close} width={258} label="Switch account">
          <button className="menu__item" data-menuitem data-on={accountId === 'all'} onClick={() => pick('all')}>
            <span className="acct__avatar acct__avatar--sm" style={{ background: 'var(--c-text-3)' }}><Layers size={11} strokeWidth={2.5} /></span>
            <span className="menu__label"><span className="menu__title">All accounts</span></span>
            <Badge n={unreadFor(counts, 'all', 'inbox')} />
          </button>
          {accounts.map((a) => (
            <button key={a.id} className="menu__item" data-menuitem data-on={accountId === a.id} onClick={() => pick(a.id)}>
              <span className="acct__avatar acct__avatar--sm" style={{ background: a.color }}>{initials({ name: a.name, email: a.email })}</span>
              <span className="menu__label">
                <span className="menu__title">{accountLabel(a.name, a.email)}</span>
                <span className="menu__sub">{a.email}</span>
              </span>
              <Badge n={unreadFor(counts, a.id, 'inbox')} />
            </button>
          ))}
          <div className="menu__sep" />
          <button className="menu__item" data-menuitem onClick={() => { close(); setOverlay('settings') }}>
            <span className="menu__icon"><Plus size={14} /></span>
            <span className="menu__label"><span className="menu__title">Add account</span></span>
          </button>
        </Popover>
      )}
    </>
  )
}

// ---------------------------------------------------------------- search

/** Inline search field. Typing navigates to `{kind:'search'}`; clearing restores the last view. */
function SearchRow(): JSX.Element {
  const nav = useApp((s) => s.nav)
  const setNav = useApp((s) => s.setNav)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const prev = useRef<Nav>({ kind: 'role', role: 'inbox' })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const start = (): void => {
    if (nav.kind !== 'search') prev.current = nav
    setOpen(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }
  const exit = (): void => {
    setOpen(false); setQ('')
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (useApp.getState().nav.kind === 'search') setNav(prev.current)
  }
  const change = (text: string): void => {
    setQ(text)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      if (text.trim()) setNav({ kind: 'search', text: text.trim() })
      else if (useApp.getState().nav.kind === 'search') setNav(prev.current)
    }, 220)
  }

  if (!open) {
    return (
      <div className="sidebar__searchwrap no-drag">
        <button className="search" onClick={start}>
          <Search size={15} /><span>Search</span><kbd>/</kbd>
        </button>
      </div>
    )
  }
  return (
    <div className="sidebar__searchwrap no-drag">
      <div className="search search--open">
        <Search size={15} />
        <input
          ref={inputRef} value={q} placeholder="Search mail" aria-label="Search mail"
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); exit() } }}
          onBlur={() => { if (!q.trim()) exit() }}
        />
        {q && <button className="search__clear" onMouseDown={(e) => e.preventDefault()} onClick={exit} aria-label="Clear search"><X size={13} /></button>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- sections & rows

function Section({ id, title, collapsed, onToggle, action, children }: {
  id: string; title: string; collapsed: boolean; onToggle(id: string): void
  action?: { icon: ReactNode; label: string; onClick(): void }; children: ReactNode
}): JSX.Element {
  return (
    <section className="sec" data-collapsed={collapsed}>
      <div className="sec__head">
        <button className="sec__title" onClick={() => onToggle(id)} aria-expanded={!collapsed}>
          <ChevronDown size={12} className="sec__chev" />
          <span>{title}</span>
        </button>
        {action && (
          <button className="sec__action" title={action.label} aria-label={action.label} onClick={action.onClick}>
            {action.icon}
          </button>
        )}
      </div>
      {!collapsed && <div className="sec__body">{children}</div>}
    </section>
  )
}

function Badge({ n }: { n: number }): JSX.Element | null {
  if (!n) return null
  return <span className="badge">{n > 999 ? '999+' : n}</span>
}

function Row({ icon, emoji, dot, label, suffix, count, active, onClick, trailing, title }: {
  icon?: ReactNode; emoji?: string; dot?: string; label: string; suffix?: string; count?: number
  active?: boolean; onClick(): void; trailing?: ReactNode; title?: string
}): JSX.Element {
  return (
    <button className="row" data-active={!!active} onClick={onClick} title={title ?? label}>
      <span className="row__lead">
        {emoji ? <span className="row__emoji">{emoji}</span>
          : dot ? <span className="row__dot" style={{ background: dot }} />
            : icon}
      </span>
      <span className="row__label">
        {label}
        {suffix && <span className="row__suffix">{suffix}</span>}
      </span>
      {trailing}
      <Badge n={count ?? 0} />
    </button>
  )
}

function ViewRow({ view, count, active, onClick }: {
  view: View; count: number; active: boolean; onClick(): void
}): JSX.Element {
  const [anchor, toggle, close] = useAnchor()
  const openEditor = useViewEditor((s) => s.open)
  const dotColor = view.color ? `var(--chip-${view.color}-fg)` : undefined

  return (
    <div className="row__wrap">
      <button
        className="row" data-active={active} onClick={onClick} title={view.name}
        onContextMenu={(e) => { e.preventDefault(); toggle(e) }}
      >
        <span className="row__lead">
          {view.emoji ? <span className="row__emoji">{view.emoji}</span>
            : <span className="row__dot" style={{ background: dotColor ?? 'var(--c-text-3)' }} />}
        </span>
        <span className="row__label">{view.name}</span>
        <Badge n={count} />
      </button>
      <button
        className="row__more" aria-label={`Options for ${view.name}`} title="Options"
        onClick={(e) => { e.stopPropagation(); toggle(e) }}
      >
        <MoreHorizontal size={14} />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={close} width={180} label={`${view.name} options`}>
          <button className="menu__item" data-menuitem onClick={() => { close(); openEditor(view.id) }}>
            <span className="menu__icon"><SettingsIcon size={14} /></span>
            <span className="menu__label"><span className="menu__title">Edit view</span></span>
          </button>
          <button className="menu__item" data-menuitem onClick={() => { close(); openEditor(null) }}>
            <span className="menu__icon"><Plus size={14} /></span>
            <span className="menu__label"><span className="menu__title">New view</span></span>
          </button>
        </Popover>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- derived counts

interface Aux { views: Record<string, number>; hasSnoozed: boolean }

/**
 * Unread counts per saved View, and whether any reminder exists. `Repo.counts()` only aggregates
 * by label/role, so these come from `threads.list` with `limit: 1` — the result's `total` is a
 * separate COUNT(*), so a single row crosses IPC per view. Recomputed whenever the store's counts
 * object changes, which happens on every sync event.
 */
function useAuxCounts(views: View[], accountId: string, counts: Counts): Aux {
  const [aux, setAux] = useState<Aux>({ views: {}, hasSnoozed: false })
  useEffect(() => {
    let cancelled = false
    const scope = accountId === 'all' ? {} : { accountIds: [accountId] }
    void (async () => {
      const results = await Promise.all(views.map(async (v) =>
        [v.id, (await window.api.invoke('threads.list', { filter: { ...v.filter, ...scope, unread: true }, limit: 1 })).total] as const))
      const snoozed = await window.api.invoke('threads.list', { filter: { ...scope, onlySnoozed: true }, limit: 1 })
      if (cancelled) return
      setAux({ views: Object.fromEntries(results), hasSnoozed: snoozed.total > 0 })
    })()
    return () => { cancelled = true }
  }, [views, accountId, counts])
  return aux
}
