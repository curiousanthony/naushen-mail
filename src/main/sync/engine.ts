import type { Account, Label, OutgoingMessage, Rule, RuleStep, SyncEvent, Thread, ThreadAction } from '@shared/types'
import { activeRules } from '@shared/rules'
import type { ProviderAdapter } from '../providers/types'
import type { Repo } from '../db/repo'
import { FollowUps } from './followups'
import { mt } from '../i18n'
import { RulesStore, planFor } from './rules'

const LOCAL_ONLY = new Set<ThreadAction['type']>(['snooze', 'unsnooze', 'remind'])

/**
 * Owns one adapter per account and keeps the local SQLite store in sync.
 * The renderer only ever talks to the store (optimistic), never to a provider.
 */
export class SyncEngine {
  private adapters = new Map<string, ProviderAdapter>()
  private running = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private listeners = new Set<(e: SyncEvent) => void>()

  readonly followups: FollowUps
  /** Local filter rules (never pushed to a provider). */
  readonly rules: RulesStore
  /** Sent-message follow-ups waiting for the provider to report the new thread. */
  private pendingFollowUps: Array<{ accountId: string; subject: string; sentAt: number; at: number }> = []

  constructor(private repo: Repo) { this.followups = new FollowUps(repo); this.rules = new RulesStore(repo.db) }

  onEvent(cb: (e: SyncEvent) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  emit(e: SyncEvent): void { for (const l of this.listeners) l(e) }

  register(adapter: ProviderAdapter): void { this.adapters.set(adapter.accountId, adapter) }
  unregister(accountId: string): void {
    this.adapters.get(accountId)?.dispose?.()
    this.adapters.delete(accountId)
  }
  getAdapter(accountId: string): ProviderAdapter | undefined { return this.adapters.get(accountId) }

  start(intervalMs = 60_000): void {
    this.stop()
    this.timer = setInterval(() => {
      const woke = this.repo.wakeSnoozed()
      if (woke.length) this.emit({ type: 'changed', threadIds: woke })
      // Settle after the sync so a reply that just arrived clears the follow-up instead of racing it.
      void this.syncAll().finally(() => this.settleFollowUps())
    }, intervalMs)
  }

  /** Advance "follow up if no reply" state (fire due ones, drop answered ones) and tell the UI. */
  settleFollowUps(): void {
    const { fired, cleared } = this.followups.settle()
    const ids = [...fired, ...cleared]
    if (ids.length) this.emit({ type: 'changed', threadIds: ids })
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null }

  async syncAll(): Promise<void> {
    await Promise.allSettled([...this.adapters.keys()].map((id) => this.syncAccount(id)))
  }

  async syncAccount(accountId: string): Promise<void> {
    const adapter = this.adapters.get(accountId)
    if (!adapter || this.running.has(accountId)) return
    this.running.add(accountId)
    this.setStatus(accountId, { status: 'syncing' })
    try {
      const labels = await adapter.listLabels()
      this.repo.replaceLabels(accountId, labels)
      let cursor = this.repo.getAccount(accountId)?.syncCursor ?? null
      for (let guard = 0; guard < 200; guard++) {
        // Rules file *newly arrived* mail. The first backfill (no cursor) and a reset re-import
        // the whole mailbox, which is not "new" and must never be re-filed.
        const fileNew = cursor !== null
        const page = await adapter.sync(cursor)
        if (page.reset) this.repo.clearAccountMail(accountId)
        const arrived: string[] = []
        // labels must exist before threads reference them (FKs are soft, but keep ordering explicit)
        const me = this.repo.getAccount(accountId)?.email.toLowerCase()
        for (const t of page.threads) {
          // An incremental page also returns threads that merely changed (read, relabelled). Only a
          // thread that is new here, or has a newer message than we stored, counts as arrival.
          if (fileNew && !page.reset) {
            const prev = this.repo.getThreadRow(t.thread.id)
            if (!prev || t.thread.lastMessageAt > prev.lastMessageAt) arrived.push(t.thread.id)
          }
          this.repo.upsertNormalized(t)
          // Recipient autocomplete (compose, search from:/to:) needs both directions: `send()`
          // already bumps who *you* write to, this is the other half -- everyone a synced
          // message came from or was sent to, so people who've only ever emailed you also
          // show up as suggestions, not just people you've emailed. Exclude the account's own
          // address, which shows up as `from` on sent mail and `to`/`cc` on received mail.
          for (const m of t.messages) {
            this.repo.bumpContacts([m.from, ...m.to, ...m.cc].filter((a) => a.email.toLowerCase() !== me))
          }
        }
        if (page.deletedRemoteThreadIds.length) this.repo.deleteThreadsByRemote(accountId, page.deletedRemoteThreadIds)
        cursor = page.cursor
        this.repo.patchAccount(accountId, { syncCursor: cursor })
        this.attachPendingFollowUps(accountId)
        if (arrived.length) await this.fileArrivals(arrived)
        this.emit({ type: 'changed', accountId })
        if (!page.hasMore) break
      }
      this.setStatus(accountId, { status: 'ok', statusMessage: undefined, lastSyncAt: Date.now() })
      this.settleFollowUps()
    } catch (e) {
      this.failStatus(accountId, e)
    } finally {
      this.running.delete(accountId)
    }
  }

  private setStatus(accountId: string, patch: Partial<Account>): void {
    this.repo.patchAccount(accountId, patch)
    this.emit({ type: 'account-status', accountId })
  }

  /**
   * Record a thrown sync/action error, without clobbering a more specific 'reauth' status the
   * adapter may have just set (via `markReauthNeeded`) immediately before throwing — a bare
   * network/API error is a worse, less actionable message than "sign in again".
   */
  private failStatus(accountId: string, e: unknown, prefixKey = ''): void {
    const current = this.repo.getAccount(accountId)?.status
    if (current === 'reauth') return
    this.setStatus(accountId, { status: 'error', statusMessage: prefixKey ? mt(prefixKey, { message: e instanceof Error ? e.message : String(e) }) : e instanceof Error ? e.message : String(e) })
  }

  /**
   * Run the local rules over just-arrived threads. Goes through `act`, so the change is optimistic
   * locally *and* pushed to the provider (otherwise the next sync would undo it), then announces
   * what it did so the UI can offer an undo.
   */
  private async fileArrivals(threadIds: string[]): Promise<void> {
    const rules = activeRules(this.rules.list())
    if (!rules.length) return
    const threads = threadIds.map((id) => this.repo.getThreadRow(id)).filter((t): t is NonNullable<typeof t> => !!t)
    await this.runRules(rules, threads)
  }

  /** Apply rules to threads; emits one `rules-applied` per rule that changed something. */
  async runRules(rules: Rule[], threads: Thread[]): Promise<Map<string, RuleStep[]>> {
    const byRule = new Map<string, RuleStep[]>()
    for (const { ruleId, step } of planFor(this.repo, rules, threads)) {
      await this.act(step.threadIds, step.action)
      ;(byRule.get(ruleId) ?? byRule.set(ruleId, []).get(ruleId)!).push(step)
    }
    for (const [ruleId, steps] of byRule) {
      this.emit({ type: 'rules-applied', ruleId, threadCount: new Set(steps.flatMap((x) => x.threadIds)).size, steps })
    }
    return byRule
  }

  /** Optimistic: apply locally, notify UI, then push to provider (re-sync on failure). */
  async act(threadIds: string[], action: ThreadAction): Promise<void> {
    const touched = this.repo.applyLocal(threadIds, action)
    if (action.type === 'remind') this.settleFollowUps() // a deadline that is already due fires right away
    this.emit({ type: 'changed', threadIds })
    if (LOCAL_ONLY.has(action.type)) return
    const byAccount = new Map<string, typeof touched>()
    for (const t of touched) (byAccount.get(t.accountId) ?? byAccount.set(t.accountId, []).get(t.accountId)!).push(t)
    await Promise.all([...byAccount.entries()].map(async ([accountId, threads]) => {
      const adapter = this.adapters.get(accountId)
      if (!adapter) return
      const labels: Label[] = this.repo.labelsForAccount(accountId)
      try {
        // Muting is a local flag; the provider just sees archive / move-to-inbox.
        const remote: ThreadAction = action.type === 'mute' ? { type: 'archive' } : action.type === 'unmute' ? { type: 'unarchive' } : action
        for (const t of threads) await adapter.applyAction(t.remoteId, remote, { labels })
      } catch (e) {
        this.failStatus(accountId, e, 'errors.actionFailed')
        void this.syncAccount(accountId) // reconcile local state with the server
      }
    }))
  }

  async send(msg: OutgoingMessage): Promise<void> {
    const adapter = this.adapters.get(msg.accountId)
    if (!adapter) throw new Error(mt('errors.accountNotConnected'))
    const sentAt = Date.now()
    await adapter.send(msg)
    this.repo.bumpContacts([...msg.to, ...msg.cc, ...msg.bcc])
    if (msg.followUpDays && msg.followUpDays > 0) {
      const at = sentAt + msg.followUpDays * 86_400_000
      if (msg.inReplyTo && msg.inReplyTo.mode !== 'forward') this.followups.set([msg.inReplyTo.threadId], at)
      else this.pendingFollowUps.push({ accountId: msg.accountId, subject: msg.subject || '(no subject)', sentAt, at })
    }
    void this.syncAccount(msg.accountId)
  }

  /** New messages have no thread id until the provider reports it; attach the follow-up when it shows up. */
  private attachPendingFollowUps(accountId: string): void {
    if (!this.pendingFollowUps.length) return
    const stale = Date.now() - 15 * 60_000
    this.pendingFollowUps = this.pendingFollowUps.filter((p) => {
      if (p.sentAt < stale) return false
      if (p.accountId !== accountId) return true
      const id = this.repo.findRecentThreadBySubject(accountId, p.subject, p.sentAt - 60_000)
      if (!id) return true
      this.followups.set([id], p.at)
      return false
    })
  }
}
