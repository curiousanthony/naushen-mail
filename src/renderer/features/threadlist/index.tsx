import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Inbox } from 'lucide-react'
import { useApp } from '@/lib/store'
import { Row } from './Row'
import { FilterBar } from './FilterBar'
import { BulkBar } from './BulkBar'
import { VIEW_ICONS } from '../sidebar/viewIcons'
import {
  EMPTY_CHIPS, WINDOW_THRESHOLD, applyChips, chipCount, emptyCopy, flatten, groupThreads,
  listTitle, offsetsOf, rangeIds, scrollOffsetFor, unionIds, windowRange,
  type Chips, type Metrics
} from './lib'
import './threadlist.css'

/**
 * Row geometry must agree with threadlist.css, because the windowing maths below measures
 * the list from these numbers rather than from the DOM. `--row-h` / `--header-h` are set from
 * the same table, so changing a value here changes the rendered height with it.
 */
const DENSITY: Record<'comfortable' | 'compact', Metrics> = {
  comfortable: { rowH: 44, headerH: 28 },
  compact: { rowH: 32, headerH: 26 }
}

/** The conversation list: view title, filter chips, date groups, selection and hover actions. */
export function ThreadList(): JSX.Element {
  const threads = useApp((s) => s.threads)
  const total = useApp((s) => s.total)
  const loading = useApp((s) => s.loading)
  const nav = useApp((s) => s.nav)
  const views = useApp((s) => s.views)
  const labels = useApp((s) => s.labels)
  const accounts = useApp((s) => s.accounts)
  const accountId = useApp((s) => s.accountId)
  const focusedId = useApp((s) => s.focusedId)
  const selectedIds = useApp((s) => s.selectedIds)
  const openThreadId = useApp((s) => s.openThreadId)
  const settings = useApp((s) => s.settings)
  const openThread = useApp((s) => s.openThread)
  const focus = useApp((s) => s.focus)

  const [chips, setChips] = useState<Chips>(EMPTY_CHIPS)
  const scroller = useRef<HTMLDivElement>(null)
  const anchor = useRef<string | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(720)

  // A new mailbox is a new set of filters.
  useEffect(() => { setChips(EMPTY_CHIPS); anchor.current = null }, [nav, accountId])

  // `loading` flips true as soon as a nav change kicks off a refetch, but the OLD thread list
  // (from the mailbox you just left) keeps rendering under it until the new page arrives — local
  // SQLite queries usually resolve well under a frame, so replacing that content with the
  // skeleton immediately would just be a flash. Only swap to the skeleton once a load has been
  // running long enough that showing something stale is worse than showing a placeholder; a
  // load that finishes first (the common case) never shows it at all.
  const [staleLoad, setStaleLoad] = useState(false)
  useEffect(() => {
    if (!loading) { setStaleLoad(false); return undefined }
    const t = setTimeout(() => setStaleLoad(true), 150)
    return () => clearTimeout(t)
  }, [loading])

  const metrics = DENSITY[settings.density]
  const visible = useMemo(() => applyChips(threads, chips), [threads, chips])
  const items = useMemo(
    () => flatten(groupThreads(visible, settings.groupByDate)),
    [visible, settings.groupByDate]
  )
  const offsets = useMemo(() => offsetsOf(items, metrics), [items, metrics])
  const win = useMemo(
    () => windowRange(items, offsets, scrollTop, viewportH, metrics),
    [items, offsets, scrollTop, viewportH, metrics]
  )

  // Selection reads live state so these stay referentially stable and `memo(Row)` keeps working.
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  const selectOne = useCallback((id: string) => {
    anchor.current = id
    const cur = useApp.getState().selectedIds
    useApp.setState({ selectedIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
  }, [])

  const selectRange = useCallback((id: string) => {
    const st = useApp.getState()
    const ids = rangeIds(visibleRef.current, anchor.current ?? st.focusedId, id)
    if (!anchor.current) anchor.current = st.focusedId ?? id
    useApp.setState({ selectedIds: unionIds(st.selectedIds, ids) })
  }, [])

  const onSelect = useCallback((id: string, e: MouseEvent) => {
    if (e.shiftKey) selectRange(id)
    else selectOne(id)
    focus(id)
  }, [selectRange, selectOne, focus])

  const onOpen = useCallback((id: string, e: MouseEvent) => {
    focus(id)
    if (e.shiftKey) { selectRange(id); return }
    if (e.metaKey || e.ctrlKey) { selectOne(id); return }
    openThread(id)
  }, [selectRange, selectOne, focus, openThread])

  // Drop selections the filter chips have hidden, so the bulk bar always matches what is on screen.
  useEffect(() => {
    const ids = new Set(visible.map((t) => t.id))
    const cur = useApp.getState().selectedIds
    const next = cur.filter((i) => ids.has(i))
    if (next.length !== cur.length) useApp.setState({ selectedIds: next })
  }, [visible])

  const windowed = items.length > WINDOW_THRESHOLD
  const onScroll = useCallback(() => {
    if (!windowed) return
    const el = scroller.current
    if (el) setScrollTop(el.scrollTop)
  }, [windowed])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    setViewportH(el.clientHeight)
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Keep the keyboard cursor on screen (the shortcuts themselves live in the commands feature).
  useEffect(() => {
    const el = scroller.current
    if (!el || !focusedId) return
    const idx = items.findIndex((it) => it.kind === 'row' && it.thread.id === focusedId)
    if (idx < 0) return
    const to = scrollOffsetFor(offsets, idx, metrics.rowH, el.scrollTop, el.clientHeight)
    if (to !== null) el.scrollTo({ top: to })
  }, [focusedId, items, offsets, metrics])

  const head = listTitle(nav, views, labels)
  const filtered = chipCount(chips) > 0
  const myEmails = useMemo(() => new Set(accounts.map((a) => a.email.toLowerCase())), [accounts])
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedThreads = useMemo(() => visible.filter((t) => selectedSet.has(t.id)), [visible, selectedSet])
  const userLabels = useMemo(
    () => labels.filter((l) => l.kind === 'user' && (accountId === 'all' || l.accountId === accountId)),
    [labels, accountId]
  )
  const showAccount = accountId === 'all' && accounts.length > 1
  const viewName = nav.kind === 'view' ? views.find((v) => v.id === nav.viewId)?.name : undefined
  const count = filtered ? visible.length : total
  const empty = emptyCopy(nav, viewName, filtered)

  return (
    <section className="tl" data-density={settings.density} aria-label={head.title}>
      <header className="tl__bar">
        <h1 className="tl__title">
          {head.emoji && VIEW_ICONS[head.emoji] && (() => { const Icon = VIEW_ICONS[head.emoji!]; return <Icon size={16} className="tl__emoji" /> })()}
          <span className="tl__titletext">{head.title}</span>
          {count > 0 && <span className="tl__count">{count}</span>}
        </h1>
        <FilterBar chips={chips} onChange={setChips} labels={userLabels} />
      </header>

      <div
        className="tl__scroll" ref={scroller} onScroll={onScroll}
        role="listbox" aria-multiselectable aria-label="Conversations" tabIndex={-1}
      >
        {loading && (!threads.length || staleLoad) ? (
          <Skeleton />
        ) : !items.length ? (
          <div className="tl__empty">
            <span className="tl__emptyicon"><Inbox size={22} /></span>
            <p className="tl__emptytitle">{empty.title}</p>
            <p className="tl__emptybody">{empty.body}</p>
          </div>
        ) : (
          <>
            {win.padTop > 0 && <div style={{ height: win.padTop }} aria-hidden />}
            {win.header && <GroupHeader label={win.header.label} count={win.header.count} />}
            {items.slice(win.start, win.end).map((it) =>
              it.kind === 'header' ? (
                <GroupHeader key={it.key} label={it.label} count={it.count} />
              ) : (
                <Row
                  key={it.key}
                  thread={it.thread}
                  labels={labels}
                  account={accountById.get(it.thread.accountId)}
                  showAccount={showAccount}
                  myEmails={myEmails}
                  selected={selectedSet.has(it.thread.id)}
                  focused={focusedId === it.thread.id}
                  open={openThreadId === it.thread.id}
                  onSelect={onSelect}
                  onOpen={onOpen}
                />
              )
            )}
            {win.padBottom > 0 && <div style={{ height: win.padBottom }} aria-hidden />}
          </>
        )}
      </div>

      <BulkBar selected={selectedThreads} labels={labels} />
    </section>
  )
}

function GroupHeader({ label, count }: { label: string; count: number }): JSX.Element {
  return (
    <div className="tl__group" role="presentation">
      <span>{label}</span>
      <span className="tl__groupcount">{count}</span>
    </div>
  )
}

/** Placeholder rows while the first page loads, so the list does not flash empty. */
function Skeleton(): JSX.Element {
  return (
    <div className="tl__skel" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <div className="tl__skelrow" key={i}>
          <span className="tl__skelavatar" />
          <span className="tl__skelbar" style={{ width: `${18 + ((i * 7) % 10)}%` }} />
          <span className="tl__skelbar tl__skelbar--wide" style={{ width: `${34 + ((i * 11) % 22)}%` }} />
        </div>
      ))}
    </div>
  )
}
