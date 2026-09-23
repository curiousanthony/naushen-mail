import { randomUUID } from 'node:crypto'
import type { OutgoingMessage, ScheduledSend } from '@shared/types'
import type { Repo } from '../db/repo'
import type { SyncEngine } from './engine'

/**
 * Local outbox: "undo send" delay and scheduled send. Both are just scheduled_sends rows
 * with a send time; a 1s tick dispatches due rows through the provider adapter.
 */
export class Outbox {
  private timer: NodeJS.Timeout | null = null
  constructor(private repo: Repo, private engine: SyncEngine) {}

  start(): void {
    this.stop()
    this.timer = setInterval(() => void this.tick(), 1000)
    void this.tick()
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null }

  /** Queue for send after the user's undo window. Returns immediately. */
  async sendWithUndo(msg: OutgoingMessage): Promise<void> {
    const delay = this.repo.getSettings().undoSendSeconds * 1000
    await this.schedule(msg, Date.now() + delay)
  }

  async schedule(message: OutgoingMessage, sendAt: number): Promise<ScheduledSend> {
    const s: ScheduledSend = { id: randomUUID(), message, sendAt, status: 'pending' }
    this.repo.saveScheduled(s)
    this.engine.emit({ type: 'outbox', id: s.id, status: 'pending' })
    if (sendAt <= Date.now()) void this.tick()
    return s
  }

  cancel(id: string): void {
    const s = this.repo.listScheduled().find((x) => x.id === id)
    if (s && s.status === 'pending') {
      this.repo.saveScheduled({ ...s, status: 'cancelled' })
      this.engine.emit({ type: 'outbox', id, status: 'cancelled' })
    }
  }

  private busy = false
  async tick(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const due = this.repo.listScheduled('pending').filter((s) => s.sendAt <= Date.now())
      for (const s of due) {
        try {
          await this.engine.send(s.message)
          this.repo.saveScheduled({ ...s, status: 'sent' })
          this.engine.emit({ type: 'outbox', id: s.id, status: 'sent' })
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e)
          this.repo.saveScheduled({ ...s, status: 'failed', error })
          this.engine.emit({ type: 'outbox', id: s.id, status: 'failed', error })
        }
      }
    } finally { this.busy = false }
  }

  /** Re-queue a failed send for immediate retry. The message content is untouched in the DB. */
  retry(id: string): void {
    const s = this.repo.listScheduled().find((x) => x.id === id)
    if (!s || s.status !== 'failed') return
    this.repo.saveScheduled({ ...s, status: 'pending', sendAt: Date.now(), error: undefined })
    this.engine.emit({ type: 'outbox', id, status: 'pending' })
    void this.tick()
  }
}
