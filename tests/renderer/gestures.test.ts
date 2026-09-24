import { describe, expect, it } from 'vitest'
import type { Label, Thread } from '@shared/types'
import { BURST_GAP_MS, SWIPE_THRESHOLD, SwipeTracker, WheelBurst, rubber } from '@/features/gestures/swipe'
import { dragPayload } from '@/features/gestures/dnd'
import { planMove, skippedNote, swipeArchiveAction } from '@/features/gestures/plan'
import { UndoStack, invertAction } from '@/features/commands/undo'
import { SHORTCUTS } from '@/features/commands/shortcuts'
import { HANDLERS } from '@/features/commands/runner'

describe('rubber', () => {
  it('is 1:1 to the threshold, then resists and saturates', () => {
    expect(rubber(40)).toBe(40)
    expect(rubber(-SWIPE_THRESHOLD)).toBe(-SWIPE_THRESHOLD)
    const a = rubber(SWIPE_THRESHOLD + 50), b = rubber(SWIPE_THRESHOLD + 500)
    expect(a).toBeGreaterThan(SWIPE_THRESHOLD)
    expect(a - SWIPE_THRESHOLD).toBeLessThan(50)
    expect(b).toBeLessThan(SWIPE_THRESHOLD * 1.9)
    expect(rubber(-300)).toBe(-rubber(300))
  })
})

describe('WheelBurst axis lock', () => {
  it('claims a horizontal burst, leaves a vertical scroll alone', () => {
    const h = new WheelBurst()
    h.feed(-4, 0, 0)
    expect(h.feed(-4, 0, 8)).toBe('x')
    const v = new WheelBurst()
    expect(v.feed(0, 9, 0)).toBe('y')
  })
  it('a vertical scroll that drifts sideways never turns into a swipe', () => {
    const b = new WheelBurst()
    let last: string = ''
    for (let i = 0; i < 20; i++) last = b.feed(i % 2 ? 6 : -6, 30, i * 8)
    expect(last).toBe('y')
  })
  it('waits for a couple of noisy events before deciding', () => {
    const b = new WheelBurst()
    expect(b.feed(1, 0, 0)).toBe('pending')
    expect(b.feed(1, 1, 8)).toBe('pending')
  })
  it('ambiguous diagonals go to vertical', () => {
    const b = new WheelBurst()
    b.feed(5, 4, 0)
    expect(b.feed(5, 4, 8)).toBe('y')
  })
  it('inertia after a finished swipe is ignored, a new burst after a gap is fresh', () => {
    const b = new WheelBurst()
    b.feed(-8, 0, 0)
    expect(b.feed(-8, 0, 8)).toBe('x')
    b.finish()
    expect(b.feed(-3, 0, 20)).toBe('spent')
    b.feed(-8, 0, 20 + BURST_GAP_MS + 1)
    expect(b.feed(-8, 0, 20 + BURST_GAP_MS + 9)).toBe('x')
  })
})

describe('SwipeTracker', () => {
  it('follows natural scrolling: fingers right (deltaX < 0) moves the row right', () => {
    const t = new SwipeTracker()
    t.push(-20)
    expect(t.view().offset).toBe(20)
    expect(t.view().side).toBe('right')
    t.push(50); t.push(50)
    expect(t.view().side).toBe('left')
  })
  it('arms at the threshold and only then commits on release', () => {
    const t = new SwipeTracker()
    t.push(SWIPE_THRESHOLD - 10)
    expect(t.view().armed).toBe(false)
    expect(t.release()).toBeNull()
    t.push(20)
    expect(t.view().armed).toBe(true)
    expect(t.release()).toBe('left')
  })
  it('detects the inertia tail once armed', () => {
    const t = new SwipeTracker()
    for (const d of [20, 30, 40]) t.push(d)
    expect(t.view().armed).toBe(true)
    // fingers lift: deltas decay
    expect([18, 12, 8].map((d) => t.push(d))).toEqual([false, false, true])
  })
  it('does not commit early before the threshold', () => {
    const t = new SwipeTracker()
    expect([10, 8, 6, 4].map((d) => t.push(d)).some(Boolean)).toBe(false)
  })
})

const label = (id: string, accountId: string, role?: Label['role'], name = id): Label => ({ id, accountId, remoteId: id, name, kind: role ? 'system' : 'user', role, color: 'blue' })
const labels: Label[] = [
  label('a:inbox', 'a', 'inbox'), label('a:trash', 'a', 'trash'), label('a:spam', 'a', 'spam'), label('a:travel', 'a', undefined, 'Travel'),
  label('b:inbox', 'b', 'inbox'), label('b:trash', 'b', 'trash'), label('b:spam', 'b', 'spam'), label('b:travel', 'b', undefined, 'Travel')
]
const th = (id: string, accountId: string, labelIds: string[], extra: Partial<Thread> = {}): Thread => ({
  id, accountId, remoteId: id, subject: id, snippet: '', lastMessageAt: 1, messageCount: 1, unread: false, starred: false,
  hasAttachments: false, labelIds, participants: [], snoozedUntil: null, reminderAt: null, ...extra
})

describe('planMove', () => {
  const a1 = th('a1', 'a', ['a:inbox']), a2 = th('a2', 'a', ['a:inbox', 'a:travel']), b1 = th('b1', 'b', ['b:inbox'])
  it('label drop: only that account, adds label and leaves the inbox', () => {
    const p = planMove([a1, b1], { kind: 'label', labelId: 'a:travel', accountId: 'a' }, labels)
    expect(p.apply.map((t) => t.id)).toEqual(['a1'])
    expect(p.skipped).toBe(1)
    expect(p.steps).toEqual([
      { ids: ['a1'], action: { type: 'addLabel', labelId: 'a:travel' } },
      { ids: ['a1'], action: { type: 'archive' } }
    ])
    expect(skippedNote(p, { kind: 'label', labelId: 'a:travel', accountId: 'a' })).toContain('from another account left as is')
  })
  it('a thread already labelled and archived is left alone; labelled but in inbox just leaves it', () => {
    const done = th('a3', 'a', ['a:travel'])
    expect(planMove([done], { kind: 'label', labelId: 'a:travel', accountId: 'a' }, labels).apply).toEqual([])
    const p = planMove([a2], { kind: 'label', labelId: 'a:travel', accountId: 'a' }, labels)
    expect(p.steps).toEqual([{ ids: ['a2'], action: { type: 'archive' } }])
  })
  it('a label of another account cannot accept anything', () => {
    expect(planMove([a1], { kind: 'label', labelId: 'b:travel', accountId: 'b' }, labels).apply).toEqual([])
  })
  it('inbox / archive / trash refuse no-ops', () => {
    expect(planMove([a1], { kind: 'inbox' }, labels).apply).toEqual([])
    expect(planMove([a1], { kind: 'archive' }, labels).apply.length).toBe(1)
    const arch = th('a4', 'a', [])
    expect(planMove([arch], { kind: 'archive' }, labels).apply).toEqual([])
    expect(planMove([arch], { kind: 'inbox' }, labels).apply.length).toBe(1)
    const tr = th('a5', 'a', ['a:trash'])
    expect(planMove([tr], { kind: 'trash' }, labels).apply).toEqual([])
    expect(planMove([tr], { kind: 'inbox' }, labels, 'trash').steps[0].action).toEqual({ type: 'untrash' })
    expect(planMove([th('s', 'a', ['a:spam'])], { kind: 'inbox' }, labels, 'spam').steps[0].action).toEqual({ type: 'notSpam' })
  })
  it('spans accounts for role destinations and copy counts conversations', () => {
    const p = planMove([a1, b1], { kind: 'trash' }, labels)
    expect(p.apply.length).toBe(2)
    expect(p.message).toBe('2 conversations moved to trash')
    expect(planMove([a1], { kind: 'starred' }, labels).message).toBe('Conversation starred')
  })
})

describe('swipe + drag helpers', () => {
  it('swipe-left is archive, or the matching restore inside Trash / Spam', () => {
    expect(swipeArchiveAction(null).action).toEqual({ type: 'archive' })
    expect(swipeArchiveAction('trash').action).toEqual({ type: 'untrash' })
    expect(swipeArchiveAction('spam').action).toEqual({ type: 'notSpam' })
  })
  it('dragging a selected row carries the whole selection, otherwise just the row', () => {
    const all = [th('1', 'a', []), th('2', 'a', []), th('3', 'a', [])]
    expect(dragPayload(all[0], ['1', '3'], all).map((t) => t.id)).toEqual(['1', '3'])
    expect(dragPayload(all[1], ['1', '3'], all).map((t) => t.id)).toEqual(['2'])
    expect(dragPayload(all[0], ['1'], all).map((t) => t.id)).toEqual(['1'])
  })
})

describe('mute / compound undo wiring', () => {
  it('mute and unmute invert each other', () => {
    expect(invertAction({ type: 'mute' })).toEqual({ type: 'unmute' })
    expect(invertAction({ type: 'unmute' })).toEqual({ type: 'mute' })
  })
  it('an undo entry can carry extra steps', () => {
    const s = new UndoStack()
    const e = s.push(['a'], { type: 'unarchive' }, 'x', [{ ids: ['a'], action: { type: 'removeLabel', labelId: 'l' } }])
    expect(s.take(e.id)?.extra?.length).toBe(1)
  })
  it('new shortcuts are registered and have handlers', () => {
    for (const id of ['thread.move', 'thread.mute', 'thread.markRead', 'sel.all']) {
      expect(SHORTCUTS.some((s) => s.id === id), id).toBe(true)
      expect(HANDLERS[id], id).toBeTypeOf('function')
    }
    expect(SHORTCUTS.find((s) => s.id === 'thread.move')!.keys).toEqual(['v'])
    expect(SHORTCUTS.find((s) => s.id === 'thread.mute')!.keys).toEqual(['m'])
    expect(SHORTCUTS.find((s) => s.id === 'thread.markRead')!.keys).toEqual(['shift+i'])
  })
})
