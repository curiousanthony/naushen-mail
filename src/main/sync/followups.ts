import type { Address } from '@shared/types'
import type { Repo } from '../db/repo'

/**
 * "Follow up if no reply" -- local only, built on the thread's `reminder_at` column (the
 * `{ type: 'remind' }` action arms / cancels it).
 *
 *   armed ──inbound reply after arming──▶ cleared (silently)
 *   armed ──deadline passed, no reply───▶ fired  (thread resurfaces unread in the Inbox with
 *                                                 a "No reply yet" chip; `followup_fired_at`)
 *   armed / fired ──cancel ({remind: null}), archive, or a late reply──▶ cleared
 *
 * `settle()` is the only place state advances. It is idempotent and clock-injected, so the
 * same code path covers the 60s tick, the post-sync check and "the app was closed across the
 * deadline" (the first settle after launch simply finds `reminder_at <= now`).
 */

export interface SettleResult {
  fired: string[]
  cleared: string[]
}

interface Row { id: string; account_id: string; reminder_at: number | null; followup_set_at: number | null; followup_fired_at: number | null }

export class FollowUps {
  constructor(private repo: Repo, private clock: () => number = Date.now) {}

  /** Arm a follow-up on the given threads. */
  set(threadIds: string[], at: number): void {
    this.repo.applyLocal(threadIds, { type: 'remind', at })
  }

  /** Cancel / dismiss. */
  cancel(threadIds: string[]): void {
    this.repo.applyLocal(threadIds, { type: 'remind', at: null })
  }

  /** Did anyone other than the account owner write in this thread after `since`? */
  hasReplySince(threadId: string, accountEmail: string, since: number): boolean {
    const rows = this.repo.db.prepare('SELECT from_json FROM messages WHERE thread_id = ? AND date > ? AND is_draft = 0').all(threadId, since) as Array<{ from_json: string }>
    const me = accountEmail.toLowerCase()
    return rows.some((r) => {
      try { return (JSON.parse(r.from_json) as Address).email.toLowerCase() !== me } catch { return false }
    })
  }

  private clear(id: string): void {
    this.repo.db.prepare('UPDATE threads SET reminder_at = NULL, followup_set_at = NULL, followup_fired_at = NULL WHERE id = ?').run(id)
  }

  /** Advance every armed / fired follow-up. Returns the thread ids whose visible state changed. */
  settle(): SettleResult {
    const now = this.clock()
    const out: SettleResult = { fired: [], cleared: [] }
    const rows = this.repo.db.prepare(
      'SELECT id, account_id, reminder_at, followup_set_at, followup_fired_at FROM threads WHERE reminder_at IS NOT NULL OR followup_fired_at IS NOT NULL'
    ).all() as unknown as Row[]
    for (const r of rows) {
      const email = this.repo.getAccount(r.account_id)?.email ?? ''
      // Rows armed before the baseline column existed: start counting from now, never fire retroactively.
      const since = r.followup_set_at ?? now
      if (r.followup_set_at === null) this.repo.db.prepare('UPDATE threads SET followup_set_at = ? WHERE id = ?').run(since, r.id)

      if (this.hasReplySince(r.id, email, since)) { this.clear(r.id); out.cleared.push(r.id); continue }
      if (r.followup_fired_at === null && r.reminder_at !== null && r.reminder_at <= now) {
        this.repo.db.prepare('UPDATE threads SET reminder_at = NULL, followup_fired_at = ?, unread = 1 WHERE id = ?').run(now, r.id)
        this.repo.db.prepare('UPDATE messages SET unread = 1 WHERE id = (SELECT id FROM messages WHERE thread_id = ? ORDER BY date DESC LIMIT 1)').run(r.id)
        out.fired.push(r.id)
      }
    }
    return out
  }
}
