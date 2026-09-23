import type { Account, Label, OutgoingMessage, SyncEvent, ThreadAction } from '@shared/types'
import type { ProviderAdapter } from '../providers/types'
import type { Repo } from '../db/repo'

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

  constructor(private repo: Repo) {}

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
      void this.syncAll()
    }, intervalMs)
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
        const page = await adapter.sync(cursor)
        if (page.reset) this.repo.clearAccountMail(accountId)
        // labels must exist before threads reference them (FKs are soft, but keep ordering explicit)
        for (const t of page.threads) this.repo.upsertNormalized(t)
        if (page.deletedRemoteThreadIds.length) this.repo.deleteThreadsByRemote(accountId, page.deletedRemoteThreadIds)
        cursor = page.cursor
        this.repo.patchAccount(accountId, { syncCursor: cursor })
        this.emit({ type: 'changed', accountId })
        if (!page.hasMore) break
      }
      this.setStatus(accountId, { status: 'ok', statusMessage: undefined, lastSyncAt: Date.now() })
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
  private failStatus(accountId: string, e: unknown, prefix = ''): void {
    const current = this.repo.getAccount(accountId)?.status
    if (current === 'reauth') return
    this.setStatus(accountId, { status: 'error', statusMessage: `${prefix}${e instanceof Error ? e.message : String(e)}` })
  }

  /** Optimistic: apply locally, notify UI, then push to provider (re-sync on failure). */
  async act(threadIds: string[], action: ThreadAction): Promise<void> {
    const touched = this.repo.applyLocal(threadIds, action)
    this.emit({ type: 'changed', threadIds })
    if (LOCAL_ONLY.has(action.type)) return
    const byAccount = new Map<string, typeof touched>()
    for (const t of touched) (byAccount.get(t.accountId) ?? byAccount.set(t.accountId, []).get(t.accountId)!).push(t)
    await Promise.all([...byAccount.entries()].map(async ([accountId, threads]) => {
      const adapter = this.adapters.get(accountId)
      if (!adapter) return
      const labels: Label[] = this.repo.labelsForAccount(accountId)
      try {
        for (const t of threads) await adapter.applyAction(t.remoteId, action, { labels })
      } catch (e) {
        this.failStatus(accountId, e, 'Action failed: ')
        void this.syncAccount(accountId) // reconcile local state with the server
      }
    }))
  }

  async send(msg: OutgoingMessage): Promise<void> {
    const adapter = this.adapters.get(msg.accountId)
    if (!adapter) throw new Error('Account not connected')
    await adapter.send(msg)
    this.repo.bumpContacts([...msg.to, ...msg.cc, ...msg.bcc])
    void this.syncAccount(msg.accountId)
  }
}
