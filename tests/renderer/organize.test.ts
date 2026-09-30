import { beforeEach, describe, expect, it } from 'vitest'
import './_i18n-en'
import type { AppSettings, Counts, Label, Rule, Thread } from '../../src/shared/types'
import { DEFAULT_SETTINGS } from '../../src/shared/types'
import { dedupeLabels, expandLabelIds } from '../../src/renderer/lib/labels'
import { navToFilter } from '../../src/renderer/lib/store'
import { mergedLabels, unreadForGroup } from '../../src/renderer/features/sidebar/lib'
import {
  assignBundle, buildEntries, buildItems, bundleCount, navStateOf, senderSummary, type BundleDef
} from '../../src/renderer/features/threadlist/bundles'
import { bundleStops, collapseBundleAt, expandBundleAt, expandBundleTargets, publishBundleNav, useBundleUi } from '../../src/renderer/features/threadlist/bundleNav'
import { flatten, groupByCategory, groupThreads, offsetsOf, windowRange } from '../../src/renderer/features/threadlist/lib'
import { targetIds } from '../../src/renderer/features/commands/selection'
import { moveFocus } from '../../src/renderer/features/commands/selection'
import { readBundles, toggleBundle } from '../../src/renderer/features/rules/prefs'
import { draftToRule, isDraftComplete, ruleToDraft, seedDraft, summarizeSteps, toggleAction, withField } from '../../src/renderer/features/rules/draft'
import { suggestRule } from '../../src/shared/rules'

const lab = (id: string, accountId: string, name: string, kind: Label['kind'] = 'user', color?: Label['color']): Label =>
  ({ id, accountId, remoteId: id.split(':')[1], name, kind, color })

// ------------------------------------------------------------------ label merging

describe('merging same-named labels across accounts', () => {
  const labels = [
    lab('a:L1', 'a', 'Newsletters', 'user', 'purple'), lab('b:L9', 'b', 'newsletters'), lab('a:L2', 'a', 'Travel'),
    lab('b:L3', 'b', 'Newsletters '), lab('a:INBOX', 'a', 'Inbox', 'system')
  ]

  it('All accounts: one row per name (case/whitespace-insensitive), keeping the first colour', () => {
    const rows = mergedLabels(labels, 'all')
    expect(rows.map((r) => r.name)).toEqual(['Newsletters', 'Travel'])
    expect(rows[0].color).toBe('purple')
    expect(rows[0].ids.sort()).toEqual(['a:L1', 'b:L3', 'b:L9'])
    expect(rows[0].accountIds.sort()).toEqual(['a', 'b'])
  })

  it('a single account keeps its own labels separate', () => {
    expect(mergedLabels(labels, 'b').map((r) => r.ids).flat().sort()).toEqual(['b:L3', 'b:L9'])
    expect(mergedLabels(labels, 'b')).toHaveLength(2)
    expect(mergedLabels(labels, 'a').map((r) => r.ids)).toEqual([['a:L1'], ['a:L2']])
  })

  it('combined unread is the sum over the underlying labels', () => {
    const counts: Counts = { unread: { 'all:a:L1': 3, 'all:b:L9': 4, 'all:b:L3': 1, 'all:a:L2': 9 } }
    const [news, travel] = mergedLabels(labels, 'all')
    expect(unreadForGroup(counts, 'all', news)).toBe(8)
    expect(unreadForGroup(counts, 'all', travel)).toBe(9)
  })

  it('navigating queries every underlying label; one account queries only its own', () => {
    expect(expandLabelIds(labels, 'a:L1', 'all').sort()).toEqual(['a:L1', 'b:L3', 'b:L9'])
    expect(expandLabelIds(labels, 'b:L9', 'all').sort()).toEqual(['a:L1', 'b:L3', 'b:L9'])
    expect(expandLabelIds(labels, 'a:L1', 'a')).toEqual(['a:L1'])
    // Viewing the merged label, then switching to account b, must not query a's label id.
    expect(expandLabelIds(labels, 'a:L1', 'b').sort()).toEqual(['b:L3', 'b:L9'])
    // An account without that label: falls back to the id (an empty list, not a crash).
    expect(expandLabelIds(labels, 'a:L2', 'b')).toEqual(['a:L2'])
    expect(expandLabelIds(labels, 'missing', 'all')).toEqual(['missing'])
    expect(navToFilter({ kind: 'label', labelId: 'a:L1' }, 'all', [], labels).labelIds?.sort()).toEqual(['a:L1', 'b:L3', 'b:L9'])
    expect(navToFilter({ kind: 'label', labelId: 'a:L1' }, 'a', [], labels)).toEqual({ accountIds: ['a'], labelIds: ['a:L1'] })
  })

  it('dedupes filter-chip labels only in the unified view', () => {
    const user = labels.filter((l) => l.kind === 'user')
    expect(dedupeLabels(user, 'all').map((l) => l.id)).toEqual(['a:L1', 'a:L2'])
    expect(dedupeLabels(user, 'b')).toBe(user)
  })
})

// ------------------------------------------------------------------ Gmail categories

describe('Gmail categories', () => {
  const catLabels = [
    lab('a:CATEGORY_SOCIAL', 'a', 'Social', 'category'),
    lab('b:CATEGORY_SOCIAL', 'b', 'Social', 'category'),
    lab('a:CATEGORY_PROMOTIONS', 'a', 'Promotions', 'category'),
    lab('a:INBOX', 'a', 'Inbox', 'system')
  ]

  it('expandLabelIds groups a category by remoteId across accounts, same as a user label groups by name', () => {
    expect(expandLabelIds(catLabels, 'a:CATEGORY_SOCIAL', 'all').sort()).toEqual(['a:CATEGORY_SOCIAL', 'b:CATEGORY_SOCIAL'])
    expect(expandLabelIds(catLabels, 'a:CATEGORY_SOCIAL', 'a')).toEqual(['a:CATEGORY_SOCIAL'])
    // Switching to account b while viewing (what was) a's Social row queries b's own Social label.
    expect(expandLabelIds(catLabels, 'a:CATEGORY_SOCIAL', 'b')).toEqual(['b:CATEGORY_SOCIAL'])
    expect(expandLabelIds(catLabels, 'a:CATEGORY_PROMOTIONS', 'all')).toEqual(['a:CATEGORY_PROMOTIONS'])
  })

  it('navToFilter scopes a category nav to the Inbox (Gmail tabs are always is:inbox) so archiving removes a thread from the view', () => {
    const f = navToFilter({ kind: 'label', labelId: 'a:CATEGORY_SOCIAL' }, 'all', [], catLabels)
    expect(f.role).toBe('inbox')
    expect(f.labelIds?.sort()).toEqual(['a:CATEGORY_SOCIAL', 'b:CATEGORY_SOCIAL'])
    // A plain user-label nav is untouched: no implicit role.
    const userNav = navToFilter({ kind: 'label', labelId: 'a:L1' }, 'all', [], [...catLabels, lab('a:L1', 'a', 'Travel')])
    expect(userNav.role).toBeUndefined()
  })

  it('navToFilter adds excludeCategories to the Inbox role nav only when the setting is on', () => {
    const on: AppSettings = { ...DEFAULT_SETTINGS, hideCategoriesFromInbox: true }
    expect(navToFilter({ kind: 'role', role: 'inbox' }, 'all', [], [], on).excludeCategories).toBe(true)
    expect(navToFilter({ kind: 'role', role: 'inbox' }, 'all', [], [], DEFAULT_SETTINGS).excludeCategories).toBeUndefined()
    // Only the Inbox role is affected — e.g. Starred never gets the flag.
    expect(navToFilter({ kind: 'role', role: 'starred' }, 'all', [], [], on).excludeCategories).toBeUndefined()
  })

  it("navToFilter's 'categories' nav scopes to the Inbox and never applies excludeCategories, even when the hide setting is on", () => {
    const on: AppSettings = { ...DEFAULT_SETTINGS, hideCategoriesFromInbox: true }
    const f = navToFilter({ kind: 'categories' }, 'all', [], [], on)
    expect(f.role).toBe('inbox')
    expect(f.excludeCategories).toBeUndefined()
  })

  it('groupByCategory buckets threads by category, in Gmail tab order, dropping empty categories', () => {
    const labels = [
      lab('a:CATEGORY_PERSONAL', 'a', 'Primary', 'category'),
      lab('a:CATEGORY_SOCIAL', 'a', 'Social', 'category'),
      lab('a:CATEGORY_PROMOTIONS', 'a', 'Promotions', 'category'),
      lab('a:CATEGORY_UPDATES', 'a', 'Updates', 'category')
      // Forums deliberately absent: no thread and no label for it -- must not appear.
    ]
    const threads = [
      T('promo1', NOW - 1000, { labelIds: ['a:CATEGORY_PROMOTIONS'] }),
      T('social1', NOW - 2000, { labelIds: ['a:CATEGORY_SOCIAL'] }),
      T('promo2', NOW - 3000, { labelIds: ['a:CATEGORY_PROMOTIONS'] }),
      // Primary / uncategorised mail is not part of the Categories view.
      T('uncat', NOW - 4000, { labelIds: [] }),
      T('primary1', NOW - 5000, { labelIds: ['a:CATEGORY_PERSONAL'] })
    ]
    const groups = groupByCategory(threads, labels, 'a')
    expect(groups.map((g) => g.label)).toEqual(['Social', 'Promotions'])
    expect(groups.find((g) => g.label === 'Promotions')?.threads.map((t) => t.id)).toEqual(['promo1', 'promo2'])
    expect(groups.find((g) => g.label === 'Social')?.threads.map((t) => t.id)).toEqual(['social1'])
    expect(groups.some((g) => g.label === 'Primary')).toBe(false)
  })

  it('groupByCategory falls back to one ungrouped bucket when the account has no category labels at all', () => {
    const threads = [T('t1', NOW - 1000), T('t2', NOW - 2000)]
    const groups = groupByCategory(threads, [], 'a')
    expect(groups).toEqual([{ key: 'all', label: '', threads }])
  })
})

// ------------------------------------------------------------------ bundles

const T = (id: string, at: number, over: Partial<Thread> = {}): Thread => ({
  id, accountId: 'a', remoteId: id, subject: id, snippet: '', lastMessageAt: at, messageCount: 1, unread: false, starred: false,
  hasAttachments: false, labelIds: [], participants: [{ name: 'Sender ' + id, email: `${id}@ex.com` }, { email: 'me@x.io' }],
  snoozedUntil: null, reminderAt: null, ...over
})
const NOW = Date.now()
const news: BundleDef = { id: 'label:newsletters', kind: 'label', match: 'newsletters', name: 'Newsletters' }
const bLabels = [lab('a:LN', 'a', 'Newsletters'), lab('a:LR', 'a', 'Receipts')]
const me = new Set(['me@x.io'])

describe('bundle grouping', () => {
  const threads = [
    T('t1', NOW - 1000, { unread: true }), T('n1', NOW - 2000, { labelIds: ['a:LN'], unread: true }), T('t2', NOW - 3000),
    T('n2', NOW - 4000, { labelIds: ['a:LN'] }), T('n3', NOW - 5000, { labelIds: ['a:LN'], unread: true }), T('t3', NOW - 6000)
  ]

  it('is a no-op without bundles', () => {
    expect(buildEntries(threads, [], bLabels, me).every((e) => e.kind === 'thread')).toBe(true)
  })

  it('collapses members into one entry placed where the newest member was', () => {
    const e = buildEntries(threads, [news], bLabels, me)
    expect(e.map((x) => (x.kind === 'thread' ? x.thread.id : `bundle:${x.bundle.threads.length}`))).toEqual(['t1', 'bundle:3', 't2', 't3'])
    const b = (e[1] as Extract<(typeof e)[number], { kind: 'bundle' }>).bundle
    expect(b.unread).toBe(2)
    expect(b.newest).toBe(NOW - 2000)
    expect(bundleCount(b)).toBe('2 new')
    expect(b.senders).toEqual(['Sender n1', 'Sender n3', 'Sender n2']) // unread first, then the rest
  })

  it('says "N conversations" when nothing is unread, and spells the singular', () => {
    const [x] = buildEntries([T('n', 1, { labelIds: ['a:LN'] })], [news], bLabels, me)
    expect(x.kind === 'bundle' && bundleCount(x.bundle)).toBe('1 conversation')
  })

  it('starred mail is never bundled; the first matching definition wins; sender bundles match address and domain', () => {
    expect(assignBundle(T('s', 1, { labelIds: ['a:LN'], starred: true }), [news], bLabels, me)).toBeNull()
    const recv: BundleDef = { id: 'label:receipts', kind: 'label', match: 'receipts', name: 'Receipts' }
    expect(assignBundle(T('x', 1, { labelIds: ['a:LN', 'a:LR'] }), [recv, news], bLabels, me)?.id).toBe('label:receipts')
    const acme: BundleDef = { id: 'sender:acme.com', kind: 'sender', match: 'acme.com', name: 'Acme' }
    const t = T('y', 1, { participants: [{ email: 'billing@mail.acme.com' }, { email: 'me@x.io' }] })
    expect(assignBundle(t, [acme], bLabels, me)?.id).toBe('sender:acme.com')
    expect(assignBundle(T('z', 1, { participants: [{ email: 'a@notacme.com' }] }), [acme], bLabels, me)).toBeNull()
    const exact: BundleDef = { id: 'sender:a@b.co', kind: 'sender', match: 'a@b.co', name: 'A' }
    expect(assignBundle(T('w', 1, { participants: [{ email: 'A@B.co' }] }), [exact], bLabels, me)?.id).toBe('sender:a@b.co')
    // your own address never makes a thread "from" a sender bundle
    const mine: BundleDef = { id: 'sender:me@x.io', kind: 'sender', match: 'me@x.io', name: 'Me' }
    expect(assignBundle(T('v', 1, { participants: [{ email: 'me@x.io' }] }), [mine], bLabels, me)).toBeNull()
  })

  it('summarises distinct senders once each', () => {
    const a = T('a', 3, { participants: [{ name: 'Same', email: 's@x.com' }] })
    const b = T('b', 2, { participants: [{ name: 'Same', email: 's@x.com' }] })
    expect(senderSummary([a, b], me)).toEqual(['Same'])
  })

  it('builds flat items: date headers count entries, an open bundle lists its members as child rows', () => {
    const entries = buildEntries(threads, [news], bLabels, me)
    const closed = buildItems(entries, true, {}, NOW)
    expect(closed.map((i) => i.kind)).toEqual(['header', 'row', 'bundle', 'row', 'row'])
    expect(closed[0]).toMatchObject({ kind: 'header', count: 4 })
    const open = buildItems(entries, true, { 'label:newsletters': true }, NOW)
    expect(open.map((i) => i.kind)).toEqual(['header', 'row', 'bundle', 'row', 'row', 'row', 'row', 'row'])
    expect(open.filter((i) => i.kind === 'row' && i.child).map((i) => i.kind === 'row' && i.thread.id)).toEqual(['n1', 'n2', 'n3'])
    // no date grouping: no headers
    expect(buildItems(entries, false, {}).some((i) => i.kind === 'header')).toBe(false)
  })

  it('leaves the windowing maths intact (bundle rows are fixed-height rows)', () => {
    const many = Array.from({ length: 600 }, (_, i) => T(`m${i}`, NOW - i * 1000, i % 3 === 0 ? { labelIds: ['a:LN'] } : {}))
    const items = buildItems(buildEntries(many, [news], bLabels, me), false, {})
    const m = { rowH: 44, headerH: 28 }
    const offsets = offsetsOf(items, m)
    expect(offsets[items.length]).toBe(items.length * 44)
    const w = windowRange(items, offsets, 3000, 700, m)
    expect(w.start).toBeGreaterThan(0)
    expect(w.end).toBeLessThanOrEqual(items.length)
    // identical to the plain path when not bundling
    expect(flatten(groupThreads(many.slice(0, 5), false)).length).toBe(5)
  })
})

describe('keyboard navigation through bundles', () => {
  beforeEach(() => { publishBundleNav(null); useBundleUi.setState({ expanded: {} }) })
  const entries = buildEntries([
    T('t1', 100), T('n1', 90, { labelIds: ['a:LN'] }), T('n2', 80, { labelIds: ['a:LN'] }), T('t2', 70)
  ], [news], bLabels, me)
  const ids = ['t1', 'n1', 'n2', 't2']

  it('is the identity when nothing is published', () => {
    expect(bundleStops(ids, 'n1')).toEqual({ ids, focusedId: 'n1' })
    expect(expandBundleTargets(['n1'])).toEqual(['n1'])
    expect(targetIds({ focusedId: 'n1', selectedIds: [], openThreadId: null })).toEqual(['n1'])
  })

  it('j/k treat a collapsed bundle as one stop, wherever the cursor sits inside it', () => {
    publishBundleNav(navStateOf(buildItems(entries, false, {})))
    const step = (from: string | null, d: number) => { const s = bundleStops(ids, from); return moveFocus(s.ids, s.focusedId, d) }
    expect(step('t1', 1)).toBe('n1')
    expect(step('n1', 1)).toBe('t2') // skips hidden n2
    expect(step('n2', 1)).toBe('t2') // cursor on a hidden member behaves like the bundle
    expect(step('n2', -1)).toBe('t1')
    expect(step('t2', -1)).toBe('n1')
  })

  it('e / bulk actions on a collapsed bundle target every member', () => {
    publishBundleNav(navStateOf(buildItems(entries, false, {})))
    expect(targetIds({ focusedId: 'n1', selectedIds: [], openThreadId: null })).toEqual(['n1', 'n2'])
    expect(targetIds({ focusedId: 't1', selectedIds: [], openThreadId: null })).toEqual(['t1'])
    expect(targetIds({ focusedId: 'n1', selectedIds: ['t1', 'n2'], openThreadId: null })).toEqual(['t1', 'n1', 'n2'])
    // an open reader acts on that thread only
    expect(targetIds({ focusedId: 'n1', selectedIds: [], openThreadId: 'n2' })).toEqual(['n2'])
  })

  it('Enter expands a collapsed bundle; an open bundle exposes its members as stops and acts per row; Esc folds it', () => {
    publishBundleNav(navStateOf(buildItems(entries, false, {})))
    expect(expandBundleAt('t1')).toBe(false)
    expect(expandBundleAt('n1')).toBe(true)
    expect(useBundleUi.getState().expanded['label:newsletters']).toBe(true)

    publishBundleNav(navStateOf(buildItems(entries, false, useBundleUi.getState().expanded)))
    expect(bundleStops(ids, 'n1')).toEqual({ ids: ['t1', 'n1', 'n2', 't2'], focusedId: 'n1' })
    expect(targetIds({ focusedId: 'n1', selectedIds: [], openThreadId: null })).toEqual(['n1'])
    expect(expandBundleAt('n1')).toBe(false) // already open: Enter opens the thread
    expect(collapseBundleAt('t1')).toBe(false)
    expect(collapseBundleAt('n2')).toBe(true)
    expect(useBundleUi.getState().expanded['label:newsletters']).toBe(false)
  })
})

// ------------------------------------------------------------------ prefs & draft

describe('feature preferences', () => {
  const s = (x: unknown): AppSettings => ({ ...DEFAULT_SETTINGS, ...(x as object) })
  it('bundles default to none and survive junk', () => {
    expect(readBundles(DEFAULT_SETTINGS)).toEqual([])
    expect(readBundles(s({ bundles: 'x' }))).toEqual([])
    expect(readBundles(s({ bundles: [null, { kind: 'label' }, { kind: 'nope', match: 'a' }, { kind: 'label', match: ' Receipts ', name: 'Receipts' }, { kind: 'label', match: 'receipts' }] })))
      .toEqual([{ id: 'label:receipts', kind: 'label', match: 'receipts', name: 'Receipts' }])
  })
  it('toggling adds then removes, keyed by lower-cased match', () => {
    const on = toggleBundle([], 'label', 'Newsletters', 'Newsletters')
    expect(on).toEqual([news])
    expect(toggleBundle(on, 'label', 'NEWSLETTERS', 'x')).toEqual([])
  })
})

describe('rule draft', () => {
  const sug = suggestRule({ accountId: 'a', subject: 'Hi', from: 'x@acme.com' }, 'Re: Your receipt')!

  it('seeds from the thread: domain + skip inbox, and re-fills when the kind changes', () => {
    const d = seedDraft(sug, 'a')
    expect(d).toMatchObject({ field: 'fromDomain', value: 'acme.com', accountId: 'a', actions: { archive: true, trash: false } })
    expect(withField(d, 'from', sug).value).toBe('x@acme.com')
    expect(withField(d, 'subject', sug).value).toBe('Your receipt')
  })

  it('trash and archive / never-spam are mutually exclusive', () => {
    let d = seedDraft(sug, 'a')
    d = toggleAction(d, 'trash')
    expect(d.actions).toMatchObject({ trash: true, archive: false })
    d = toggleAction(d, 'neverSpam')
    expect(d.actions).toMatchObject({ trash: false, neverSpam: true })
  })

  it('round-trips through a Rule, preserving extra conditions and the label', () => {
    const rule: Rule = {
      id: 'r', enabled: true, position: 3, accountId: null, createdAt: 5,
      conditions: [{ field: 'from', value: 'a@b.co' }, { field: 'subject', value: 'x' }],
      actions: [{ type: 'star' }, { type: 'label', name: 'Receipts' }]
    }
    const d = ruleToDraft(rule)
    expect(d.actions.star).toBe(true)
    expect(d.label).toBe('Receipts')
    expect(draftToRule(d, rule).conditions).toEqual(rule.conditions)
    expect(new Set(draftToRule(d, rule).actions.map((a) => JSON.stringify(a)))).toEqual(new Set(rule.actions.map((a) => JSON.stringify(a))))
  })

  it('is incomplete without a value or an action', () => {
    const d = seedDraft(sug, 'a')
    expect(isDraftComplete(d)).toBe(true)
    expect(isDraftComplete({ ...d, value: '  ' })).toBe(false)
    expect(isDraftComplete({ ...d, actions: { ...d.actions, archive: false } })).toBe(false)
    expect(isDraftComplete({ ...d, actions: { ...d.actions, archive: false }, label: 'X' })).toBe(true)
  })

  it('words what a run did', () => {
    expect(summarizeSteps([
      { threadIds: ['1', '2'], action: { type: 'archive' }, inverse: { type: 'unarchive' } },
      { threadIds: ['1'], action: { type: 'addLabel', labelId: 'L' }, inverse: null }
    ], () => 'Receipts')).toBe('Archived 2 · Labelled 1 “Receipts”')
  })
})
