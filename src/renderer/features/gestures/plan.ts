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
      // Labels are per account. A thread of another account gets that account's label of the
      // same name (Receipts on Gmail -> Receipts on Outlook); with no such label it is left alone.
      const name = labels.find((l) => l.id === dest.labelId)?.name ?? 'label'
      const want = name.toLowerCase()
      const resolve = (t: Thread): string | null => {
        if (t.accountId === dest.accountId) return dest.labelId
        return labels.find((l) => l.kind === 'user' && l.accountId === t.accountId && l.name.toLowerCase() === want)?.id ?? null
      }
      // "Move" semantics (Gmail): the label goes on and the thread leaves the inbox.
      const target = new Map<string, string>()
      for (const t of threads) {
        const lid = resolve(t)
        if (lid && (!t.labelIds.includes(lid) || has(t, inbox))) { apply.push(t); target.set(t.id, lid) }
      }
      const byLabel = new Map<string, string[]>()
      for (const t of apply) {
        const lid = target.get(t.id)!
        if (!t.labelIds.includes(lid)) (byLabel.get(lid) ?? byLabel.set(lid, []).get(lid)!).push(t.id)
      }
      for (const [labelId, ids] of byLabel) steps.push({ ids, action: { type: 'addLabel', labelId } })
      const out = apply.filter((t) => has(t, inbox))
      if (out.length) steps.push({ ids: out.map((t) => t.id), action: { type: 'archive' } })
      message = `${noun(apply.length)} moved to “${name}”`
      break
    }
  }
  return { apply, skipped: threads.length - apply.length, steps: apply.length ? steps : [], message }
}

/** Toast copy when part of a multi-account selection was skipped. */
export function skippedNote(plan: MovePlan, dest: Dest): string {
  if (!plan.skipped || !plan.apply.length) return plan.message
  const why = dest.kind === 'label' ? `${plan.skipped} without a matching label left as is` : `${plan.skipped} already there`
  return `${plan.message} (${why})`
}

/** The action a right-to-left swipe (and its reveal strip) performs, given the mailbox. */
export function swipeArchiveAction(navRole: SystemRole | null): { action: ThreadAction; label: string; done: string } {
  if (navRole === 'trash') return { action: { type: 'untrash' }, label: 'Restore', done: 'Conversation restored' }
  if (navRole === 'spam') return { action: { type: 'notSpam' }, label: 'Not spam', done: 'Conversation moved to inbox' }
  return { action: { type: 'archive' }, label: 'Archive', done: 'Conversation archived' }
}
