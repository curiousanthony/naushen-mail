import type { Repo } from './db/repo'
import type { SyncEngine } from './sync/engine'
import type { SyncEvent } from '@shared/types'
import {
  diffInbox, looksAutomated, planNotification,
  type Candidate, type NotifyMode, type NotifyPlan, type ViewState
} from './notify-plan'

/**
 * Detects genuinely new Inbox mail after each account's first completed sync in this session and
 * hands a coalesced plan to `deliver`. The first sync per account only records a baseline, so a
 * first launch / backfill / re-login never fires a wall of notifications.
 *
 * "New" = an inbox thread we hadn't seen, or one whose latest message is newer than what we
 * had, that is still unread and not sent by the user. Marking-unread or snooze wake-ups don't
 * change `lastMessageAt`, so they never re-notify.
 */
export class NewMailNotifier {
  private seen = new Map<string, Map<string, number>>()
  private baselineAt = new Map<string, number>()
  private busy = new Set<string>()

  constructor(
    private repo: Repo,
    private opts: { getView: () => Promise<ViewState>; deliver: (plan: NotifyPlan) => void }
  ) {}

  attach(engine: SyncEngine): () => void {
    return engine.onEvent((e: SyncEvent) => {
      if (e.type !== 'account-status') return
      if (this.repo.getAccount(e.accountId)?.status !== 'ok') return
      void this.check(e.accountId)
    })
  }

  private snapshot(accountId: string): { threadId: string; lastMessageAt: number }[] {
    const rows = this.repo.db.prepare(
      `SELECT t.id id, t.last_message_at at FROM threads t WHERE t.account_id = ?
         AND EXISTS (SELECT 1 FROM thread_labels tl JOIN labels l ON l.id = tl.label_id WHERE tl.thread_id = t.id AND l.role = 'inbox')`
    ).all(accountId) as { id: string; at: number }[]
    return rows.map((r) => ({ threadId: r.id, lastMessageAt: r.at }))
  }

  private candidate(threadId: string, me: string): Candidate | null {
    const t = this.repo.getThread(threadId)
    if (!t) return null
    const last = [...t.messages].reverse().find((m) => !m.isDraft)
    if (!last) return null
    return {
      threadId: t.id, accountId: t.accountId, lastMessageAt: t.lastMessageAt,
      unread: t.unread && last.unread, fromName: last.from.name ?? '', fromEmail: last.from.email,
      subject: t.subject, snippet: last.snippet || t.snippet,
      fromSelf: last.from.email.toLowerCase() === me,
      automated: looksAutomated(last.from.email, !!last.listUnsubscribe)
    }
  }

  async check(accountId: string): Promise<void> {
    if (this.busy.has(accountId)) return
    this.busy.add(accountId)
    try {
      const current = this.snapshot(accountId)
      const prev = this.seen.get(accountId)
      if (!prev) {
        this.seen.set(accountId, new Map(current.map((c) => [c.threadId, c.lastMessageAt])))
        this.baselineAt.set(accountId, Date.now())
        return
      }
      const { fresh, next } = diffInbox(prev, current)
      this.seen.set(accountId, next)
      if (!fresh.length) return
      const mode = this.mode()
      if (mode === 'off') return
      const me = (this.repo.getAccount(accountId)?.email ?? '').toLowerCase()
      // A thread first seen now but whose newest message predates this session's baseline is a
      // snooze wake-up / un-archive, not new mail.
      const horizon = this.baselineAt.get(accountId) ?? 0
      const candidates = fresh
        .filter((f) => prev.has(f.threadId) || f.lastMessageAt >= horizon - 60_000)
        .map((f) => this.candidate(f.threadId, me))
        .filter((c): c is Candidate => !!c)
      if (!candidates.length) return
      const plan = planNotification(candidates, mode, await this.opts.getView())
      if (plan.kind !== 'none') this.opts.deliver(plan)
    } finally {
      this.busy.delete(accountId)
    }
  }

  private mode(): NotifyMode {
    const s = this.repo.getSettings()
    if (!s.notifications) return 'off'
    return s.notifyScope === 'people' ? 'people' : 'all'
  }
}
