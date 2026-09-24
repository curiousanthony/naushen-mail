import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { Command } from 'cmdk'
import {
  Archive, Clock, CornerDownLeft, FileText, Forward, History, Inbox, Keyboard, Layers, Mail, MailOpen, MailX, Monitor, Moon, PanelLeft,
  ListFilter, RefreshCw, Reply, ReplyAll, Search, Send, Settings, ShieldAlert, ShieldBan, SquarePen, Star, StarOff, Sun, Tag, Trash2, Undo2, User, UserPlus, Users, X
} from 'lucide-react'
import type { Thread } from '@shared/types'
import { useApp } from '@/lib/store'
import { displayName, listTime } from '@/lib/format'
import { filterRank } from './filter'
import { GROUP_ORDER, buildPaletteItems, groupItems, type PaletteItem } from './paletteItems'
import { loadRecent, pushRecent, saveRecent } from './recent'
import { runCommand, targetThreads, undoStack } from './runner'
import { primaryBinding } from './shortcuts'
import { targetIds } from './selection'
import { useCommandUi } from './ui-store'
import { Keys } from './Keycaps'
import { Overlay } from './Overlay'
import { SnoozePicker } from './SnoozePicker'
import { LabelPicker } from './LabelPicker'
import { VIEW_ICONS } from '../sidebar/viewIcons'
import { focusedSender } from '../rules/actions'
import { readBundles } from '../rules/prefs'
import './commands.css'

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
const ICONS: Record<string, Icon> = {
  archive: Archive, trash: Trash2, spam: ShieldAlert, mail: Mail, 'mail-open': MailOpen, inbox: Inbox, clock: Clock, tag: Tag, star: Star,
  'star-off': StarOff, undo: Undo2, unsubscribe: MailX, reply: Reply, 'reply-all': ReplyAll, forward: Forward, pencil: SquarePen, send: Send,
  file: FileText, layers: Layers, settings: Settings, keyboard: Keyboard, sidebar: PanelLeft, refresh: RefreshCw, 'user-plus': UserPlus,
  user: User, users: Users, sun: Sun, moon: Moon, monitor: Monitor, view: Layers, label: Tag, rule: ListFilter, block: ShieldBan
}

const MAX_RESULTS = 8

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
 * that live in this feature).
 */
export function CommandPalette(): JSX.Element {
  return (
    <>
      <PaletteHost />
      <Pickers />
    </>
  )
}

function PaletteHost(): JSX.Element | null {
  const open = useApp((s) => s.overlay === 'palette')
  const seq = useCommandUi((s) => s.paletteSeq)
  return open ? <PaletteBody key={seq} /> : null
}

function PaletteBody(): JSX.Element {
  const ui = useCommandUi.getState()
  const [mode, setMode] = useState<'commands' | 'search'>(ui.paletteMode)
  const [query, setQuery] = useState(ui.paletteInitial)
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [results, setResults] = useState<Thread[]>([])
  const [searching, setSearching] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const s = useApp()
  const target = targetThreads()
  const ids = targetIds(s)

  const all = useMemo(() => buildPaletteItems({
    targetCount: ids.length,
    targetStarred: target.threads.length > 0 && target.threads.every((t) => t.starred),
    targetUnread: target.threads.length > 0 && target.threads.every((t) => t.unread),
    hasThread: !!(s.openThreadId ?? s.focusedId),
    navRole: s.nav.kind === 'role' ? s.nav.role : null,
    accountId: s.accountId, accounts: s.accounts, views: s.views, labels: s.labels,
    theme: s.settings.theme, sidebarCollapsed: s.sidebarCollapsed, canUndo: undoStack.size > 0,
    sender: focusedSender(), bundleIds: readBundles(s.settings).map((b) => b.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ids.join('|'), s.threads, s.openThreadId, s.focusedId, s.nav, s.accountId, s.accounts, s.views, s.labels, s.settings.theme, s.sidebarCollapsed, s.settings])

  const q = query.trim()
  const visible = useMemo(() => {
    if (mode === 'search') return []
    const pool = q ? all : all.filter((i) => !i.secondary)
    return q ? filterRank(pool, q, (i) => ({ label: i.label, keywords: i.keywords })) : pool
  }, [all, q, mode])

  // Live thread search (debounced; stale responses dropped).
  useEffect(() => {
    if (q.length < 2) { setResults([]); setSearching(false); return }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(() => {
      window.api.invoke('threads.search', q, s.accountId === 'all' ? undefined : [s.accountId])
        .then((r) => { if (!cancelled) { setResults(r.threads.slice(0, MAX_RESULTS)); setSearching(false) } })
        .catch(() => { if (!cancelled) { setResults([]); setSearching(false) } })
    }, 140)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, s.accountId])

  const close = (): void => useApp.getState().setOverlay(null)
  const remember = (text: string): void => { const next = pushRecent(recent, text); setRecent(next); saveRecent(next) }

  const runItem = (it: PaletteItem): void => {
    // Overlay-opening commands must not be closed by our own close().
    const opensOverlay = ['thread.remind', 'thread.label', 'ui.help', 'ui.settings', 'account.add', 'ui.search'].includes(it.cmd)
    if (!opensOverlay) close()
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
        <span className="cmd-item__label">{it.label}</span>
        {binding ? <Keys binding={binding} /> : it.hint ? <span className="cmd-item__hint">{it.hint}</span> : null}
      </Command.Item>
    )
  }

  const groups = groupItems(visible)
  const showSearchGroup = q.length > 0
  const showRecent = !q && recent.length > 0
  const nothing = !groups.length && !showSearchGroup && !showRecent

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

  return (
    <Overlay onClose={close} width={640} label="Command menu" className="cmd-palette">
      <Command shouldFilter={false} loop label="Command menu" className="cmd-root">
        <div className="cmd-inputrow">
          <Search size={18} strokeWidth={1.5} className="cmd-inputrow__icon" />
          {mode === 'search' && <span className="cmd-pill">Search email</span>}
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder={mode === 'search' ? 'Search by sender, subject, or words in the message…' : 'Type a command or search…'}
            className="cmd-input"
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !query && mode === 'search') { e.preventDefault(); setMode('commands') }
            }}
          />
          {query && <button className="cmd-clear" aria-label="Clear" onClick={() => setQuery('')}><X size={14} strokeWidth={1.75} /></button>}
        </div>
        <Command.List ref={listRef} className="cmd-list">
          {nothing && <div className="cmd-empty">No results</div>}
          {mode === 'search' && !q && !showRecent && <div className="cmd-empty">Search your mail. Try a name, a subject or a phrase.</div>}

          {mode === 'commands' && groups.filter((g) => g.group === 'Actions').map((g) => (
            <Command.Group key={g.group} heading={<span className="cmd-heading">{g.group}{ids.length > 1 ? ` · ${ids.length} selected` : ''}</span>}>{g.items.map(renderItem)}</Command.Group>
          ))}
          {recentGroup}
          {mode === 'commands' && groups.filter((g) => g.group !== 'Actions').sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)).map((g) => (
            <Command.Group key={g.group} heading={<span className="cmd-heading">{g.group}</span>}>{g.items.map(renderItem)}</Command.Group>
          ))}

          {showSearchGroup && (
            <Command.Group heading={<span className="cmd-heading">Search email</span>}>
              <Command.Item value={`search:${q}`} onSelect={() => submitSearch(q)} className="cmd-item">
                <span className="cmd-item__icon"><Search size={16} strokeWidth={1.5} /></span>
                <span className="cmd-item__label">Search for “{q}”</span>
                <span className="cmd-item__hint cmd-item__hint--key"><CornerDownLeft size={12} strokeWidth={1.75} /></span>
              </Command.Item>
              {results.map((th) => (
                <Command.Item key={th.id} value={`thread:${th.id}`} onSelect={() => openResult(th)} className="cmd-item cmd-item--thread">
                  <span className="cmd-item__icon">{th.unread ? <span className="cmd-unread" /> : <Mail size={16} strokeWidth={1.5} />}</span>
                  <span className="cmd-item__sender">{th.participants[0] ? displayName(th.participants[0]) : 'Unknown'}</span>
                  <span className="cmd-item__subject">{th.subject || '(no subject)'}</span>
                  {th.snippet && <span className="cmd-item__snippet">{th.snippet}</span>}
                  <span className="cmd-item__time">{listTime(th.lastMessageAt)}</span>
                </Command.Item>
              ))}
              {searching && !results.length && <div className="cmd-searching">Searching…</div>}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </Overlay>
  )
}
