import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useApp } from '@/lib/store'
import { usePreviewStore } from '@/features/preview'
import { Row } from './Row'
import { BundleRow } from './Bundle'
import { buildEntries, buildItems, navStateOf } from './bundles'
import { publishBundleNav, useBundleUi } from './bundleNav'
import { readBundles } from '../rules/prefs'
import { dedupeLabels } from '@/lib/labels'
import { FilterBar } from './FilterBar'
import { EmptyTrashButton } from './EmptyTrash'
import { BulkBar } from './BulkBar'
import { RowMenu } from './RowMenu'
import { buildRowMenu, type RowMenuItem } from './menuItems'
import { TitleGlyph, titleIconFor } from './titleIcon'
import { readShowListCount } from './listPrefs'
import { runCommand } from '../commands/runner'
import { useCommandUi } from '../commands/ui-store'
import { isEditableElement } from '../commands/keys'
import { activeCount } from '@shared/filters'
import { useFilters } from './filterState'
import {
  WINDOW_THRESHOLD, emptyCopy, flatten, groupByCategory, groupThreads,
  listTitle, offsetsOf, rangeIds, scrollOffsetFor, unionIds, windowRange,
  type Metrics
} from './lib'
import { useListFlip } from './useListFlip'
import { EmptyState, Skeleton } from './EmptyState'
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

  const conditions = useFilters((s) => s.conditions)
  const scroller = useRef<HTMLDivElement>(null)
  const anchor = useRef<string | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(720)

  // A new mailbox is a new set of filters.
  useEffect(() => { anchor.current = null }, [nav, accountId])

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
  // Filter conditions are applied in SQL (store.refreshThreads), so what is loaded is what is shown.
  const visible = threads
  const myEmails = useMemo(() => new Set(accounts.map((a) => a.email.toLowerCase())), [accounts])

  // Opt-in bundles (Settings -> Rules, or a label's menu): only ever in the Inbox.
  const bundleDefs = useMemo(() => readBundles(settings), [settings])
  const bundling = bundleDefs.length > 0 && nav.kind === 'role' && nav.role === 'inbox'
  const expanded = useBundleUi((s) => s.expanded)
  const items = useMemo(
    () => nav.kind === 'categories'
      ? flatten(groupByCategory(visible, labels, accountId))
      : bundling
        ? buildItems(buildEntries(visible, bundleDefs, labels, myEmails), settings.groupByDate, expanded)
        : flatten(groupThreads(visible, settings.groupByDate)),
    [nav.kind, bundling, visible, bundleDefs, labels, myEmails, settings.groupByDate, expanded, accountId]
  )
  // Tell the keyboard layer what is on screen (j/k stops, what `e` and Enter mean on a bundle).
  useEffect(() => {
    publishBundleNav(bundling ? navStateOf(items) : null)
    return () => publishBundleNav(null)
  }, [bundling, items])
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

  // ---- right-click menu (same commands as the palette / hover actions)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const onMenu = useCallback((id: string, e: MouseEvent) => {
    focus(id)
    setMenu({ id, x: e.clientX, y: e.clientY })
  }, [focus])
  const pickMenu = useCallback((item: RowMenuItem) => {
    const id = menu?.id
    setMenu(null)
    if (!id) return
    // Commands act on selection > open thread > cursor. Right-clicking a row outside the current
    // selection (or beside the open thread) must act on that row alone, so target it explicitly
    // and put the previous selection back once the action / picker is done.
    const st = useApp.getState()
    const before = st.selectedIds
    const inSel = before.length > 1 && before.includes(id)
    const needsSel = !inSel && ((st.openThreadId !== null && st.openThreadId !== id) || before.length > 0)
    useApp.setState({ focusedId: id, selectedIds: needsSel ? [id] : inSel ? before : [] })
    runCommand(item.cmd)
    if (!needsSel) return
    const restore = (): void => {
      const s = useApp.getState()
      const live = new Set(s.threads.map((t) => t.id))
      const same = s.selectedIds.length === 1 && s.selectedIds[0] === id
      if (same) useApp.setState({ selectedIds: before.filter((i) => live.has(i)) })
    }
    if (useApp.getState().overlay) {
      const off = useApp.subscribe((s) => { if (!s.overlay) { off(); setTimeout(restore, 0) } })
    } else setTimeout(restore, 250)
  }, [menu])
  const menuThread = menu ? visible.find((t) => t.id === menu.id) : undefined
  const navRole = nav.kind === 'role' ? nav.role : null

  // ---- keyboard cursor: arrows / o with nothing open, and the focus ring's on/off state
  const listKbd = useCommandUi((s) => s.listKbd)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const st = useApp.getState()
      if (st.overlay || st.openThreadId || st.composers.length) return
      const t = e.target instanceof HTMLElement ? e.target : null
      if (isEditableElement(t) || t?.closest('[role="menu"], [role="dialog"], .reader')) return
      const ids = visibleRef.current.map((x) => x.id)
      if (!ids.length) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const i = st.focusedId ? ids.indexOf(st.focusedId) : -1
        // No cursor yet (or it is on a row the filter hid): the first arrow lands on the first row.
        const next = i < 0 ? 0 : Math.max(0, Math.min(ids.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
        st.focus(ids[next])
        useCommandUi.getState().setListKbd(true)
        ;(document.activeElement as HTMLElement | null)?.blur?.()
      } else if (e.key === 'o' && st.focusedId) {
        e.preventDefault()
        st.openThread(st.focusedId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // Mouse use hands the cursor back to the pointer: drop the ring.
  const clearKbd = useCallback(() => useCommandUi.getState().setListKbd(false), [])

  // Drop selections the filter chips have hidden, so the bulk bar always matches what is on screen.
  useEffect(() => {
    const ids = new Set(visible.map((t) => t.id))
    const cur = useApp.getState().selectedIds
    const next = cur.filter((i) => ids.has(i))
    if (next.length !== cur.length) useApp.setState({ selectedIds: next })
  }, [visible])

  const windowed = items.length > WINDOW_THRESHOLD
  // Rows below a removed/arrived thread glide to their new slot (no-op when windowed / reduced motion).
  useListFlip(scroller, items, JSON.stringify(nav) + accountId, !windowed)
  const onScroll = useCallback(() => {
    // The row preview tracks the cursor, not the row's own position — a scroll moves the
    // hovered thread out from under the (still) cursor, so it must go rather than drift stale.
    usePreviewStore.getState().hide()
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
    let idx = items.findIndex((it) => it.kind === 'row' && it.thread.id === focusedId)
    // Cursor on a member of a collapsed bundle: scroll to the bundle row.
    if (idx < 0) idx = items.findIndex((it) => it.kind === 'bundle' && !it.expanded && it.bundle.threads.some((t) => t.id === focusedId))
    if (idx < 0) return
    const to = scrollOffsetFor(offsets, idx, metrics.rowH, el.scrollTop, el.clientHeight)
    if (to !== null) el.scrollTo({ top: to })
  }, [focusedId, items, offsets, metrics])

  const head = listTitle(nav, views, labels)
  const filtered = activeCount(conditions) > 0
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedThreads = useMemo(() => visible.filter((t) => selectedSet.has(t.id)), [visible, selectedSet])
  const userLabels = useMemo(
    () => dedupeLabels(labels.filter((l) => l.kind === 'user' && (accountId === 'all' || l.accountId === accountId)), accountId),
    [labels, accountId]
  )
  // In "All accounts", the sender's own account is a hover tooltip on the avatar (see Row.tsx),
  // never a colour -- a per-account tint or dot was cognitively noisy across a long list.
  const showAccount = accountId === 'all' && accounts.length > 1
  const viewName = nav.kind === 'view' ? views.find((v) => v.id === nav.viewId)?.name : undefined
  const showCount = readShowListCount(settings)
  const count = total
  const empty = emptyCopy(nav, viewName, filtered)

  return (
    <section className="tl" data-density={settings.density} data-kbd={listKbd || undefined} aria-label={head.title}>
      <header className="tl__bar">
        <h1 className="tl__title">
          <TitleGlyph icon={titleIconFor(nav, views, labels)} />
          <span className="tl__titletext">{head.title}</span>
          {showCount && count > 0 && <span className="tl__count">{count}</span>}
        </h1>
        {nav.kind === 'role' && nav.role === 'trash' && <EmptyTrashButton />}
        <FilterBar labels={userLabels} showGroupToggle={nav.kind !== 'categories'} />
      </header>

      <div
        className="tl__scroll" ref={scroller} onScroll={onScroll}
        role="listbox" aria-multiselectable aria-label="Conversations" tabIndex={0}
        aria-activedescendant={focusedId ? `trow-${focusedId}` : undefined}
        onMouseDown={clearKbd} onMouseMove={listKbd ? clearKbd : undefined}
        // Tab into the list lands the cursor on the first row (or keeps the current one), no opening.
        onFocus={(e) => {
          if (e.target !== e.currentTarget || !items.length) return
          const st = useApp.getState()
          if (!st.focusedId || !visibleRef.current.some((t) => t.id === st.focusedId)) st.focus(visibleRef.current[0]?.id ?? null)
          useCommandUi.getState().setListKbd(true)
        }}
      >
        {loading && (!threads.length || staleLoad) ? (
          <Skeleton />
        ) : !items.length ? (
          <EmptyState nav={nav} copy={empty} filtered={filtered} />
        ) : (
          <>
            {win.padTop > 0 && <div style={{ height: win.padTop }} aria-hidden />}
            {win.header && <GroupHeader label={win.header.label} count={win.header.count} />}
            {items.slice(win.start, win.end).map((it) =>
              it.kind === 'header' ? (
                <GroupHeader key={it.key} label={it.label} count={it.count} />
              ) : it.kind === 'bundle' ? (
                <BundleRow
                  key={it.key} bundle={it.bundle} expanded={it.expanded}
                  focused={!it.expanded && it.bundle.threads.some((t) => t.id === focusedId)}
                />
              ) : (
                <ChildWrap key={it.key} child={!!it.child}>
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
                  onMenu={onMenu}
                />
                </ChildWrap>
              )
            )}
            {win.padBottom > 0 && <div style={{ height: win.padBottom }} aria-hidden />}
          </>
        )}
      </div>

      <BulkBar selected={selectedThreads} labels={labels} />
      {menu && menuThread && (
        <RowMenu
          x={menu.x} y={menu.y} label="Conversation actions"
          items={buildRowMenu(menuThread, navRole)} onPick={pickMenu} onClose={closeMenu}
        />
      )}
    </section>
  )
}

/** Members of an open bundle sit under a guide line; plain rows render untouched. */
function ChildWrap({ child, children }: { child: boolean; children: JSX.Element }): JSX.Element {
  return child ? <div className="tbundle__child">{children}</div> : children
}

function GroupHeader({ label, count }: { label: string; count: number }): JSX.Element {
  return (
    <div className="tl__group" role="presentation">
      <span>{label}</span>
      <span className="tl__groupcount">{count}</span>
    </div>
  )
}
