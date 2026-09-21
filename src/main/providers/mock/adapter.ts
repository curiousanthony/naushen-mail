import type { Label, OutgoingMessage, ThreadAction } from '@shared/types'
import { makeId } from '@shared/types'
import type { NormalizedThread, ProviderAdapter, SyncPage } from '../types'
import { buildMockMailbox, type MockMailbox } from './fixtures'

/** In-memory demo provider. Lets the whole UI run with no OAuth, and doubles as a test double. */
export class MockAdapter implements ProviderAdapter {
  readonly kind = 'mock' as const
  private box: MockMailbox
  private outbox: NormalizedThread[] = []

  constructor(readonly accountId: string, private email: string, private name: string, flavor: 'personal' | 'work') {
    this.box = buildMockMailbox(accountId, email, name, flavor)
  }

  async listLabels(): Promise<Label[]> { return this.box.labels }

  async sync(cursor: string | null): Promise<SyncPage> {
    if (cursor === null) return { threads: this.box.threads, deletedRemoteThreadIds: [], cursor: 'mock-1', hasMore: false, reset: true }
    const threads = this.outbox
    this.outbox = []
    return { threads, deletedRemoteThreadIds: [], cursor: `mock-${Date.now()}`, hasMore: false }
  }

  async fetchThread(remoteThreadId: string): Promise<NormalizedThread> {
    const t = this.box.threads.find((x) => x.thread.remoteId === remoteThreadId)
    if (!t) throw new Error('Thread not found')
    return t
  }

  async applyAction(_id: string, _a: ThreadAction): Promise<void> { /* local store is the source of truth for the demo */ }

  async send(msg: OutgoingMessage): Promise<void> {
    const now = Date.now()
    const rid = `T_sent_${now}`
    const tid = makeId(this.accountId, rid)
    const sentLabel = makeId(this.accountId, 'SENT')
    const me = { name: this.name, email: this.email }
    this.outbox.push({
      thread: {
        id: tid, accountId: this.accountId, remoteId: rid, subject: msg.subject || '(no subject)', snippet: msg.text.slice(0, 140),
        lastMessageAt: now, messageCount: 1, unread: false, starred: false, hasAttachments: !!msg.attachments?.length,
        labelIds: [sentLabel], participants: [me, ...msg.to]
      },
      messages: [{
        id: makeId(this.accountId, `M_${rid}`), threadId: tid, accountId: this.accountId, remoteId: `M_${rid}`, from: me, to: msg.to, cc: msg.cc, bcc: msg.bcc,
        subject: msg.subject, date: now, snippet: msg.text.slice(0, 140), bodyHtml: msg.html, bodyText: msg.text, attachments: [], unread: false,
        labelIds: [sentLabel], isDraft: false
      }]
    })
  }

  async saveDraft(_m: OutgoingMessage): Promise<{ remoteDraftId: string }> { return { remoteDraftId: `D_${Date.now()}` } }
  async deleteDraft(): Promise<void> {}
  async fetchAttachment(): Promise<Buffer> { return Buffer.from('Demo attachment content') }

  async createLabel(name: string, color?: string): Promise<Label> {
    const l: Label = { id: makeId(this.accountId, `L_${name}`), accountId: this.accountId, remoteId: `L_${name}`, name, color: color as Label['color'], kind: 'user' }
    this.box.labels.push(l)
    return l
  }
  async updateLabel(): Promise<void> {}
  async deleteLabel(): Promise<void> {}
}
