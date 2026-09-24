import { Fragment, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { Command } from 'cmdk'
import {
  Archive, Clock, CornerDownLeft, FileText, Forward, History, Inbox, Keyboard, Layers, Mail, MailOpen, MailX, Monitor, Moon, PanelLeft,
  RefreshCw, Reply, ReplyAll, Search, Send, Settings, ShieldAlert, SquarePen, Star, StarOff, Sun, Tag, Trash2, Undo2, User, UserPlus, Users, X
} from 'lucide-react'
import type { PersonHit, Thread } from '@shared/types'
import { useApp } from '@/lib/store'
import { displayName, listTime } from '@/lib/format'
import { filterRank, highlightSegments } from './filter'
import { GROUP_ORDER, buildPaletteItems, groupItems, jumpGroupOf, type PaletteItem } from './paletteItems'
import { THREAD_GROUP_SCORE, blendScore, looksLikeEmail, orderGroups, rankScored, type JumpGroup } from './jump'
import { loadFrecency, recordPick } from './frecency'
import { loadRecent, pushRecent, saveRecent } from './recent'
import { runCommand, targetThreads, undoStack } from './runner'
import { primaryBinding } from './shortcuts'
import { targetIds } from './selection'
import { useCommandUi } from './ui-store'
import { Keys } from './Keycaps'
import { Overlay } from './Overlay'
import { SnoozePicker } from './SnoozePicker'
import { LabelPicker } from './LabelPicker'
import { PersonAvatar, SenderCard, allMailFrom, composeTo, searchPeople } from '../people'
import { WhichKey } from '../whichkey'
import { VIEW_ICONS } from '../sidebar/viewIcons'
import './commands.css'
import './jump.css'

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
const ICONS: Record<string, Icon> = {
  archive: Archive, trash: Trash2, spam: ShieldAlert, mail: Mail, 'mail-open': MailOpen, inbox: Inbox, clock: Clock, tag: Tag, star: Star,
  'star-off': StarOff, undo: Undo2, unsubscribe: MailX, reply: Reply, 'reply-all': ReplyAll, forward: Forward, pencil: SquarePen, send: Send,
  file: FileText, layers: Layers, settings: Settings, keyboard: Keyboard, sidebar: PanelLeft, refresh: RefreshCw, 'user-plus': UserPlus,
  user: User, users: Users, sun: Sun, moon: Moon, monitor: Monitor, view: Layers, label: Tag
}

/** Caps per group while typing (Raycast-style: a few of each, best first). */
const CAP: Record<JumpGroup, number> = { Actions: 5, Navigate: 4, Commands: 5, People: 4, Threads: 5 }
/** Local queries take a few ms; a short debounce coalesces fast typing, stale replies are dropped. */
const DEBOUNCE_MS = 45

/**
 * The reminder / label pickers, grouped so App.tsx's four mounted exports (which only include
 * CommandPalette, not these) still get them rendered — CommandPalette hosts this below.
 */
export function Pickers(): JSX.Element {
  return (
    <>
      <SnoozePicker />
      <LabelPicker />
    </>
  )
}

/**
 * The palette plus Pickers (App only mounts CommandPalette, so it is the host for the overlays
 * that live in this feature: pickers, the sender card and the which-key hint).
 */
export function CommandPalette(): JSX.Element {
  return (
    <>
      <PaletteHost />
      <Pickers />
      <SenderCard />
      <WhichKey />
    </>
  )
}

function PaletteHost(): JSX.Element | null {
  const open = useApp((s) => s.overlay === 'palette')
  const seq = useCommandUi((s) => s.paletteSeq)
  return open ? <PaletteBody key={seq} /> : null
}

/** Query-match highlighting (bold, not colour: works in light and dark). */
function Hl({ text, query }: { text: string; query: string }): JSX.Element {
  if (!query.trim()) return <>{text}</>
  return (
    <>
      {highlightSegments(text, query).map((seg, i) => (seg.hit ? <mark key={i} className="cmd-hl">{seg.text}</mark> : <Fragment key={i}>{seg.text}</Fragment>))}
    </>
  )
}

/** The other party: first participant that is not one of your own addresses. */
function leadName(th: Thread, mine: Set<string>): string {
  const p = th.participants.find((x) => !mine.has(x.email.toLowerCase())) ?? th.participants[0]
  return p ? displayName(p) : 'Unknown'
}

interface Entry { key: string; group: JumpGroup; score: number; node: JSX.Element }

function PaletteBody(): JSX.Element {
  const ui = useCommandUi.getState()
  const [mode, setMode] = useState<'commands' | 'search'>(ui.paletteMode)
  const [query, setQuery] = useState(ui.paletteInitial)
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [frec] = useState(loadFrecency)
  const [results, setResults] = useState<{ threads: Thread[]; total: number }>({ threads: [], total: 0 })
  const [people, setPeople] = useState<PersonHit[]>([])
  const [searching, setSearching] = useState(false)
  const [sel, setSel] = useState('')
  const touched = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)

  const s = useApp()
  const target = targetThreads()
  const mine = useMemo(() => new Set(s.accounts.map((a) => a.email.toLowerCase())), [s.accounts])
  const ids = targetIds(s)

  const all = useMemo(() => buildPaletteItems({
    targetCount: ids.length,
    targetStarred: target.threads.length > 0 && target.threads.every((t) => t.starred),
    targetUnread: target.threads.length > 0 && target.threads.every((t) => t.unread),
    hasThread: !!(s.openThreadId ?? s.focusedId),
    navRole: s.nav.kind === 'role' ? s.nav.role : null,
    accountId: s.accountId, accounts: s.accounts, views: s.views, labels: s.labels,
    theme: s.settings.theme, sidebarCollapsed: s.sidebarCollapsed, canUndo: undoStack.size > 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ids.join('|'), s.threads, s.openThreadId, s.focusedId, s.nav, s.accountId, s.accounts, s.views, s.labels, s.settings.theme, s.sidebarCollapsed])

  const q = query.trim()

  // Commands: with a query, blended text match + frecency; without, the classic sectioned list.
  const scoredCommands = useMemo(() => {
    if (mode === 'search' || !q) return []
    return all
      .map((item) => ({ item, score: blendScore(q, item.label, item.keywords, `cmd:${item.key}`, frec) }))
      .filter((x) => x.score > 0)
  }, [all, q, mode, frec])
  const visible = useMemo(() => (mode === 'search' ? [] : q ? rankScored(scoredCommands) : all.filter((i) => !i.secondary)), [all, q, mode, scoredCommands])

  // Live local search: threads (FTS) + people, debounced; stale replies are dropped.
  useEffect(() => {
    if (!q) { setResults({ threads: [], total: 0 }); setPeople([]); setSearching(false); return }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(() => {
      const acc = s.accountId === 'all' ? undefined : [s.accountId]
      const limit = mode === 'search' ? 8 : CAP.Threads
      const th = q.length >= 2 ? window.api.invoke('threads.search', q, acc, limit).then((r) => ({ threads: r.threads.slice(0, limit), total: r.total })).catch(() => ({ threads: [] as Thread[], total: 0 })) : Promise.resolve({ threads: [] as Thread[], total: 0 })
      const pe = mode === 'search' ? Promise.resolve([] as PersonHit[]) : searchPeople(q, s.accountId).catch(() => [] as PersonHit[])
      void Promise.all([th, pe]).then(([r, p]) => { if (!cancelled) { setResults(r); setPeople(p); setSearching(false) } })
    }, DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, s.accountId, mode])

  const close = (): void => useApp.getState().setOverlay(null)
  const remember = (text: string): void => { const next = pushRecent(recent, text); setRecent(next); saveRecent(next) }

  const runItem = (it: PaletteItem): void => {
    // Overlay-opening commands must not be closed by our own close().
    const opensOverlay = ['thread.remind', 'thread.label', 'ui.help', 'ui.settings', 'account.add', 'ui.search'].includes(it.cmd)
    if (!opensOverlay) close()
    recordPick(`cmd:${it.key}`)
    runCommand(it.cmd, { arg: it.arg })
  }
  const submitSearch = (text: string): void => {
    const t = text.trim()
    if (!t) return
    remember(t); close(); useApp.getState().setNav({ kind: 'search', text: t })
  }
  const openResult = (th: Thread): void => {
    if (q) remember(q)
    close(); useApp.getState().openThread(th.id)
  }
  const pickPerson = (p: { email: string; name?: string }): void => { recordPick(`person:${p.email}`); close(); composeTo(p) }
  const personAllMail = (email: string): void => { recordPick(`person:${email}`); close(); allMailFrom(email) }

  const renderItem = (it: PaletteItem): JSX.Element => {
    // A view's own icon (VIEW_ICONS key, see sidebar/viewIcons.ts) wins over the generic
    // per-command icon; unrecognised/legacy values (an old emoji) just fall through to it.
    const Ico = (it.emoji && VIEW_ICONS[it.emoji]) || ICONS[it.icon] || Search
    const binding = it.binding ?? primaryBinding(it.cmd)
    return (
      <Command.Item key={it.key} value={`cmd:${it.key}`} onSelect={() => runItem(it)} className="cmd-item">
        <span className="cmd-item__icon">
          {it.labelColor ? <span className="cmd-dot" style={{ background: `var(--chip-${it.labelColor}-fg)` }} />
            : <Ico size={16} strokeWidth={1.5} />}
        </span>
        <span className="cmd-item__label"><Hl text={it.label} query={q} /></span>
        {binding ? <Keys binding={binding} /> : it.hint ? <span className="cmd-item__hint">{it.hint}</span> : null}
      </Command.Item>
    )
  }

  const renderPerson = (p: { email: string; name?: string; threadCount?: number }): JSX.Element => (
    <Command.Item key={`person:${p.email}`} value={`person:${p.email}`} onSelect={() => pickPerson(p)} className="cmd-item cmd-item--person">
      <span className="cmd-item__icon"><PersonAvatar address={p} size={22} /></span>
      <span className="cmd-item__label">
        <span className="cmd-person__name"><Hl text={p.name || p.email.split('@')[0]} query={q} /></span>
        <span className="cmd-person__email"><Hl text={p.email} query={q} /></span>
      </span>
      {p.threadCount ? <span className="cmd-item__hint cmd-item__hint--idle">{p.threadCount}</span> : null}
      <span className="cmd-item__acts">
        <span className="cmd-act"><Keys display={[['↵']]} /> Write</span>
        <span className="cmd-act"><Keys display={[['⇥']]} /> All mail</span>
      </span>
    </Command.Item>
  )

  // ---- Assemble the ranked groups (typing) -----------------------------------------------
  const typing = mode === 'commands' && q.length > 0
  const entries: Entry[] = []
  if (typing) {
    for (const g of ['Actions', 'Navigate', 'Commands'] as const) {
      const items = visible.filter((i) => jumpGroupOf(i) === g).slice(0, CAP[g])
      const byKey = new Map(scoredCommands.map((x) => [x.item.key, x.score]))
      items.forEach((i) => entries.push({ key: `cmd:${i.key}`, group: g, score: byKey.get(i.key) ?? 0, node: renderItem(i) }))
    }
    const exact = people.some((p) => p.email === q.toLowerCase())
    const ranked = rankScored(people.map((p) => ({ item: p, score: Math.max(30, blendScore(q, p.name || p.email, [p.email], `person:${p.email}`, frec)) + Math.min(10, Math.log2(1 + p.threadCount) * 3) })))
    ranked.slice(0, CAP.People).forEach((p) => entries.push({ key: `person:${p.email}`, group: 'People', score: Math.max(30, blendScore(q, p.name || p.email, [p.email], `person:${p.email}`, frec)), node: renderPerson(p) }))
    if (looksLikeEmail(q) && !exact) entries.push({ key: `person:${q.toLowerCase()}`, group: 'People', score: 55, node: renderPerson({ email: q.toLowerCase() }) })
  }

  const groups = groupItems(visible)
  const showRecent = !q && recent.length > 0 && mode === 'commands'
  const showSearchGroup = q.length > 0
  const typedGroups: { group: JumpGroup; best: number; nodes: JSX.Element[]; first: string }[] = []
  if (typing) {
    for (const g of ['Actions', 'Navigate', 'Commands', 'People'] as const) {
      const es = entries.filter((e) => e.group === g)
      if (es.length) typedGroups.push({ group: g, best: Math.max(...es.map((e) => e.score)), nodes: es.map((e) => e.node), first: es[0].key })
    }
  }
  const threadNodes = results.threads.map((th) => (
    <Command.Item key={th.id} value={`thread:${th.id}`} onSelect={() => openResult(th)} className="cmd-item cmd-item--thread">
      <span className="cmd-item__icon">{th.unread ? <span className="cmd-unread" /> : <Mail size={16} strokeWidth={1.5} />}</span>
      <span className="cmd-item__sender"><Hl text={leadName(th, mine)} query={q} /></span>
      <span className="cmd-item__subject"><Hl text={th.subject || '(no subject)'} query={q} /></span>
      {th.snippet && <span className="cmd-item__snippet">{th.snippet}</span>}
      <span className="cmd-item__time">{listTime(th.lastMessageAt)}</span>
    </Command.Item>
  ))
  const searchAllRow = (
    <Command.Item key="search-all" value={`search:${q}`} onSelect={() => submitSearch(q)} className="cmd-item cmd-item--searchall">
      <span className="cmd-item__icon"><Search size={16} strokeWidth={1.5} /></span>
      <span className="cmd-item__label">{results.total > results.threads.length ? `See all ${results.total} results for “${q}”` : `Search all mail for “${q}”`}</span>
      <span className="cmd-item__hint cmd-item__hint--key"><Keys display={[['⌘', '↵']]} /></span>
    </Command.Item>
  )

  const threadGroupBlock = typing && (results.threads.length > 0 || q.length >= 2) ? { group: 'Threads' as const, best: results.threads.length ? THREAD_GROUP_SCORE : 0, first: results.threads[0] ? `thread:${results.threads[0].id}` : 'search-all' } : null
  const ordered = typing
    ? orderGroups<{ group: JumpGroup; best: number; first: string; nodes?: JSX.Element[] }>([...typedGroups, ...(threadGroupBlock ? [threadGroupBlock] : [])])
    : []
  const firstValue = typing
    ? (ordered[0]?.first ?? `search:${q}`)
    : mode === 'search' ? (q ? (results.threads[0] ? `thread:${results.threads[0].id}` : `search:${q}`) : '') : groups[0]?.items[0] ? `cmd:${groups[0].items[0].key}` : ''

  // Selection follows the best-ranked row until the user takes over with the arrow keys.
  useEffect(() => { touched.current = false }, [q])
  useEffect(() => { if (!touched.current) setSel(firstValue) }, [firstValue])

  const nothing = typing ? !ordered.length : mode === 'commands' ? !groups.length && !showRecent : false

  const recentGroup = showRecent && (
    <Command.Group heading={<span className="cmd-heading">Recent searches</span>} key="recent">
      {recent.map((r) => (
        <Command.Item key={r} value={`recent:${r}`} onSelect={() => submitSearch(r)} className="cmd-item">
          <span className="cmd-item__icon"><History size={16} strokeWidth={1.5} /></span>
          <span className="cmd-item__label">{r}</span>
          <span className="cmd-item__hint">Search</span>
        </Command.Item>
      ))}
    </Command.Group>
  )

  const head = (g: string): JSX.Element => <span className="cmd-heading">{g}</span>
  const groupNode = (g: (typeof ordered)[number]): JSX.Element | null => {
    if (g.group === 'Threads') {
      return <Command.Group key="Threads" heading={head('Threads')}>{threadNodes}{searchAllRow}{searching && !results.threads.length && <div className="cmd-searching">Searching…</div>}</Command.Group>
    }
    const found = typedGroups.find((t) => t.group === g.group)
    return found ? <Command.Group key={g.group} heading={head(g.group === 'Actions' && ids.length > 1 ? `Actions · ${ids.length} selected` : g.group)}>{found.nodes}</Command.Group> : null
  }

  return (
    <Overlay onClose={close} width={640} label="Command menu" className="cmd-palette">
      <Command
        shouldFilter={false} loop label="Command menu" className="cmd-root"
        value={sel} onValueChange={setSel}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || (e.ctrlKey && /^[jknp]$/i.test(e.key))) touched.current = true
          if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault()
            if (sel.startsWith('person:')) personAllMail(sel.slice(7))
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && q) { e.preventDefault(); submitSearch(q) }
        }}
      >
        <div className="cmd-inputrow">
          <Search size={18} strokeWidth={1.5} className="cmd-inputrow__icon" />
          {mode === 'search' && <span className="cmd-pill">Search email</span>}
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder={mode === 'search' ? 'Search by sender, subject, or words in the message…' : 'Search mail, people, or run a command…'}
            className="cmd-input"
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !query && mode === 'search') { e.preventDefault(); setMode('commands') }
            }}
          />
          {query && <button className="cmd-clear" aria-label="Clear" onClick={() => setQuery('')}><X size={14} strokeWidth={1.75} /></button>}
        </div>
        <Command.List ref={listRef} className="cmd-list">
          {nothing && !searching && <div className="cmd-empty">No results</div>}
          {mode === 'search' && !q && !showRecent && <div className="cmd-empty">Search your mail. Try a name, a subject or a phrase.</div>}

          {mode === 'commands' && !typing && groups.filter((g) => g.group === 'Actions').map((g) => (
            <Command.Group key={g.group} heading={<span className="cmd-heading">{g.group}{ids.length > 1 ? ` · ${ids.length} selected` : ''}</span>}>{g.items.map(renderItem)}</Command.Group>
          ))}
          {!typing && recentGroup}
          {mode === 'commands' && !typing && groups.filter((g) => g.group !== 'Actions').sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)).map((g) => (
            <Command.Group key={g.group} heading={<span className="cmd-heading">{g.group}</span>}>{g.items.map(renderItem)}</Command.Group>
          ))}

          {typing && ordered.map(groupNode)}

          {mode === 'search' && showSearchGroup && (
            <Command.Group heading={head('Search email')}>
              <Command.Item value={`search:${q}`} onSelect={() => submitSearch(q)} className="cmd-item">
                <span className="cmd-item__icon"><Search size={16} strokeWidth={1.5} /></span>
                <span className="cmd-item__label">Search for “{q}”</span>
                <span className="cmd-item__hint cmd-item__hint--key"><CornerDownLeft size={12} strokeWidth={1.75} /></span>
              </Command.Item>
              {threadNodes}
              {searching && !results.threads.length && <div className="cmd-searching">Searching…</div>}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </Overlay>
  )
}
