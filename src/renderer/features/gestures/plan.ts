import type { Label, SystemRole, Thread, ThreadAction } from '@shared/types'

/**
 * Where a conversation can be moved to, by drag & drop on the sidebar or the `v` picker.
 * Pure (no React, no store) so the rules are unit-tested in tests/renderer/gestures.test.ts.
 */
export type Dest =
  | { kind: 'inbox' }
  | { kind: 'archive' }
  | { kind: 'trash' }
  | { kind: 'spam' }
  | { kind: 'starred' }
  | { kind: 'label'; labelId: string; accountId: string }

export const destKey = (d: Dest): string => (d.kind === 'label' ? `label:${d.labelId}` : d.kind)

export interface Step { ids: string[]; action: ThreadAction }

export interface MovePlan {
  /** Threads the move actually changes. */
  apply: Thread[]
  /** Selected threads left alone (other account, or already there). */
  skipped: number
  /** Ordered actions to run. */
  steps: Step[]
  /** Toast copy. */
  message: string
}

/** Ids of every account's role label (`inbox`, `trash`, ...), for "is this thread in X" checks. */
export function roleLabelIds(labels: Label[], role: SystemRole): Set<string> {
  return new Set(labels.filter((l) => l.role === role).map((l) => l.id))
}

const has = (t: Thread, ids: Set<string>): boolean => t.labelIds.some((l) => ids.has(l))
const noun = (n: number): string => (n === 1 ? 'Conversation' : `${n} conversations`)

/**
 * What moving `threads` to `dest` does. `navRole` is the mailbox being viewed: restoring from
 * Trash / Spam must use the matching inverse so undo puts it back where it came from.
 * A destination that changes nothing yields an empty `apply` (the drop is refused).
 */
export function planMove(threads: Thread[], dest: Dest, labels: Label[], navRole: SystemRole | null = null): MovePlan {
  const inbox = roleLabelIds(labels, 'inbox')
  const trash = roleLabelIds(labels, 'trash')
  const spam = roleLabelIds(labels, 'spam')
  let apply: Thread[] = []
  const steps: Step[] = []
  let message = ''

  switch (dest.kind) {
    case 'inbox': {
      apply = threads.filter((t) => !has(t, inbox))
      const action: ThreadAction = navRole === 'trash' ? { type: 'untrash' } : navRole === 'spam' ? { type: 'notSpam' } : { type: 'unarchive' }
      steps.push({ ids: apply.map((t) => t.id), action })
      message = `${noun(apply.length)} moved to inbox`
      break
    }
    case 'archive':
      apply = threads.filter((t) => has(t, inbox))
      steps.push({ ids: apply.map((t) => t.id), action: { type: 'archive' } })
      message = `${noun(apply.length)} archived`
      break
    case 'trash':
      apply = threads.filter((t) => !has(t, trash))
      steps.push({ ids: apply.map((t) => t.id), action: { type: 'trash' } })
      message = `${noun(apply.length)} moved to trash`
      break
    case 'spam':
      apply = threads.filter((t) => !has(t, spam))
      steps.push({ ids: apply.map((t) => t.id), action: { type: 'spam' } })
      message = `${noun(apply.length)} reported as spam`
      break
    case 'starred':
      apply = threads.filter((t) => !t.starred)
      steps.push({ ids: apply.map((t) => t.id), action: { type: 'star' } })
      message = `${noun(apply.length)} starred`
      break
    case 'label': {
      // A label belongs to one account; threads of other accounts are left alone.
      const mine = threads.filter((t) => t.accountId === dest.accountId)
      // "Move" semantics (Gmail): the label goes on and the thread leaves the inbox.
      apply = mine.filter((t) => !t.labelIds.includes(dest.labelId) || has(t, inbox))
      const add = apply.filter((t) => !t.labelIds.includes(dest.labelId))
      const out = apply.filter((t) => has(t, inbox))
      if (add.length) steps.push({ ids: add.map((t) => t.id), action: { type: 'addLabel', labelId: dest.labelId } })
      if (out.length) steps.push({ ids: out.map((t) => t.id), action: { type: 'archive' } })
      const name = labels.find((l) => l.id === dest.labelId)?.name ?? 'label'
      message = `${noun(apply.length)} moved to “${name}”`
      break
    }
  }
  return { apply, skipped: threads.length - apply.length, steps: apply.length ? steps : [], message }
}

/** Toast copy when part of a multi-account selection was skipped. */
export function skippedNote(plan: MovePlan, dest: Dest): string {
  if (!plan.skipped || !plan.apply.length) return plan.message
  const why = dest.kind === 'label' ? 'other accounts skipped' : 'already there'
  return `${plan.message} (${plan.skipped} ${why})`
}

/** The action a right-to-left swipe (and its reveal strip) performs, given the mailbox. */
export function swipeArchiveAction(navRole: SystemRole | null): { action: ThreadAction; label: string; done: string } {
  if (navRole === 'trash') return { action: { type: 'untrash' }, label: 'Restore', done: 'Conversation restored' }
  if (navRole === 'spam') return { action: { type: 'notSpam' }, label: 'Not spam', done: 'Conversation moved to inbox' }
  return { action: { type: 'archive' }, label: 'Archive', done: 'Conversation archived' }
}
