import { describe, expect, it } from 'vitest'
import { KeyMatcher, normalizeBinding, splitSequence } from '@/features/commands/keys'
import { SECTIONS, SHORTCUTS, activeBindings } from '@/features/commands/shortcuts'
import { groupShortcuts } from '@/features/commands/sheet'
import { HANDLERS, MENU_COMMANDS } from '@/features/commands/runner'

describe('shortcut table', () => {
  it('has unique ids', () => {
    const ids = SHORTCUTS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('uses known sections', () => {
    for (const s of SHORTCUTS) expect(SECTIONS).toContain(s.section)
  })
  it('has no duplicate bindings among the ones this feature executes', () => {
    const seen = new Map<string, string>()
    for (const { binding, id } of activeBindings()) {
      const n = normalizeBinding(binding)
      expect(seen.get(n), `${n} bound to both ${seen.get(n)} and ${id}`).toBeUndefined()
      seen.set(n, id)
    }
  })
  it('never binds a key that is also the start of a sequence (g must stay a prefix)', () => {
    const b = activeBindings().map((x) => normalizeBinding(x.binding))
    const prefixes = new Set(b.filter((x) => splitSequence(x).length > 1).map((x) => splitSequence(x)[0]))
    for (const p of prefixes) expect(b, `${p} is both a key and a sequence prefix`).not.toContain(p)
  })
  it('has an implementation for every executable shortcut and every menu command', () => {
    for (const s of SHORTCUTS) if ((s.owner ?? 'commands') === 'commands') expect(HANDLERS[s.id], s.id).toBeTypeOf('function')
    for (const id of Object.values(MENU_COMMANDS)) expect(HANDLERS[id], id).toBeTypeOf('function')
  })
  it('covers the official Mac shortcut list', () => {
    const m = new KeyMatcher(activeBindings())
    const expectId = (combo: string[], id: string): void => {
      let r = m.feed(combo[0], 0)
      for (const c of combo.slice(1)) r = m.feed(c, 10)
      expect(r).toEqual({ kind: 'match', id })
    }
    expectId(['j'], 'nav.next'); expectId(['k'], 'nav.prev'); expectId(['enter'], 'nav.open'); expectId(['esc'], 'nav.back')
    expectId(['e'], 'thread.archive'); expectId(['#'], 'thread.trash'); expectId(['delete'], 'thread.trash'); expectId(['!'], 'thread.spam')
    expectId(['u'], 'thread.unread'); expectId(['shift+e'], 'thread.inbox'); expectId(['z'], 'thread.undo'); expectId(['h'], 'thread.remind')
    expectId(['l'], 'thread.label'); expectId(['s'], 'thread.star'); expectId(['r'], 'msg.reply'); expectId(['a'], 'msg.replyAll'); expectId(['f'], 'msg.forward')
    expectId(['c'], 'compose.new'); expectId(['/'], 'ui.search'); expectId(['?'], 'ui.help'); expectId(['mod+k'], 'ui.palette'); expectId(['mod+p'], 'ui.palette')
    expectId(['g', 'i'], 'go.inbox'); expectId(['g', 't'], 'go.sent'); expectId(['g', 'd'], 'go.drafts'); expectId(['g', 'a'], 'go.all')
    expectId(['ctrl+1'], 'account.switch'); expectId(['ctrl+9'], 'account.switch'); expectId(['mod+\\'], 'ui.sidebar'); expectId(['mod+u'], 'thread.unsubscribe')
    expectId(['x'], 'sel.toggle'); expectId(['shift+down'], 'sel.extendDown'); expectId(['shift+up'], 'sel.extendUp'); expectId(['mod+up'], 'nav.top')
  })
})

describe('shortcut sheet filtering', () => {
  it('shows every section with an empty query, in canonical order', () => {
    const g = groupShortcuts('')
    expect(g.map((x) => x.section)).toEqual(SECTIONS.filter((s) => SHORTCUTS.some((x) => x.section === s)))
    expect(g.reduce((n, x) => n + x.items.length, 0)).toBe(SHORTCUTS.length)
  })
  it('filters by label', () => {
    const g = groupShortcuts('archive')
    const labels = g.flatMap((x) => x.items.map((i) => i.id))
    expect(labels).toContain('thread.archive')
    expect(labels).toContain('compose.sendArchive')
    expect(labels).not.toContain('nav.next')
  })
  it('filters by keywords and by the keys themselves', () => {
    expect(groupShortcuts('snooze').flatMap((x) => x.items.map((i) => i.id))).toContain('thread.remind')
    expect(groupShortcuts('⌘K').flatMap((x) => x.items.map((i) => i.id))).toContain('ui.palette')
    expect(groupShortcuts('shift').flatMap((x) => x.items.map((i) => i.id))).toContain('thread.inbox')
  })
  it('returns nothing for gibberish', () => {
    expect(groupShortcuts('zzzqqq')).toEqual([])
  })
})
