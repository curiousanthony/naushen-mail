/**
 * Gmail ProviderAdapter over plain `fetch`. See README.md in this folder for the design notes.
 */
import type { Label, OutgoingMessage, ThreadAction } from '@shared/types'
import { ensureAccessToken } from '../../auth/tokens'
import type { AdapterFactoryDeps, NormalizedThread, ProviderAdapter, SyncPage } from '../types'
import type { GmailHistoryResponse, GmailLabel, GmailMessage, GmailPart, GmailProfile, GmailThread } from './api-types'
import { refreshAccessToken } from './auth'
import { decodeCursor, encodeCursor, type GmailCursor } from './cursor'
import { diffHistory } from './history'
import { GmailApiError, GmailHttp, pool } from './http'
import { mapLabels, toGmailColor, toRemoteLabelId } from './labels'
import { buildRaw as defaultBuildRaw, type RawBuilder, type RawContext } from './mime'
import { findLargeBodyParts, headerMap, normalizeThread, splitAttachmentId } from './normalize'

export interface GmailAdapterOptions {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  /** Swap point for the shared MIME builder (feat/compose-blocks). */
  buildRaw?: RawBuilder
  /** Newest threads pulled by the initial backfill. */
  backfillLimit?: number
  /** Concurrent threads.get requests. */
  concurrency?: number
  /** Threads hydrated per incremental sync() call. */
  hydrateBatch?: number
  /** More affected threads than this in one history window => full resync instead. */
  maxPending?: number
  /** Raw messages above this size go through the multipart upload endpoint. */
  uploadThresholdBytes?: number
}

const HISTORY_TYPES = ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved']
const EXTRA_MAILBOXES = ['TRASH', 'SPAM'] as const
const EXTRA_PER_MAILBOX = 25

export class GmailAdapter implements ProviderAdapter {
  readonly kind = 'gmail' as const
  readonly accountId: string
  private http: GmailHttp
  private inflightToken: Promise<string> | null = null
  private inflightForced = false
  private o: Required<Omit<GmailAdapterOptions, 'fetch' | 'sleep' | 'random'>> & Pick<GmailAdapterOptions, 'fetch' | 'sleep' | 'random'>

  constructor(private deps: AdapterFactoryDeps, opts: GmailAdapterOptions = {}) {
    this.accountId = deps.account.id
    this.o = {
      buildRaw: defaultBuildRaw, backfillLimit: 500, concurrency: 5, hydrateBatch: 100, maxPending: 1000,
      uploadThresholdBytes: 3 * 1024 * 1024, ...opts
    }
    this.http = new GmailHttp({
      getAccessToken: (force) => this.accessToken(force),
      onAuthRejected: (m) => deps.markReauthNeeded(m),
      fetch: opts.fetch, sleep: opts.sleep, random: opts.random
    })
  }

  // ------------------------------------------------------------------ auth

  private accessToken(force = false): Promise<string> {
    // De-duplicate concurrent refreshes (5 hydrate workers hit an expired/rejected token at the same time).
    if (this.inflightToken && (!force || this.inflightForced)) return this.inflightToken
    if (force) {
      const t = this.deps.getTokens()
      if (t) this.deps.saveTokens({ ...t, expiresAt: 0 }) // the server rejected it: refresh regardless of expiry
    }
    const p: Promise<string> = ensureAccessToken(
      () => this.deps.getTokens(),
      (t) => this.deps.saveTokens(t),
      (rt) => {
        const { googleClientId, googleClientSecret } = this.deps.getSettings().oauth
        return refreshAccessToken({ clientId: googleClientId, clientSecret: googleClientSecret }, rt, this.o.fetch)
      },
      (msg) => this.deps.markReauthNeeded(msg)
    ).finally(() => {
      if (this.inflightToken === p) { this.inflightToken = null; this.inflightForced = false }
    })
    this.inflightToken = p
    this.inflightForced = force
    return p
  }

  private rid(id: string): string {
    const prefix = this.accountId + ':'
    return id.startsWith(prefix) ? id.slice(prefix.length) : id
  }

  // ------------------------------------------------------------------ labels

  async listLabels(): Promise<Label[]> {
    const res = await this.http.get<{ labels?: GmailLabel[] }>('/labels')
    return mapLabels(this.accountId, res.labels ?? [])
  }

  async createLabel(name: string, color?: string): Promise<Label> {
    const gc = toGmailColor(color)
    const l = await this.http.post<GmailLabel>('/labels', {
      name, labelListVisibility: 'labelShow', messageListVisibility: 'show', ...(gc ? { color: gc } : {})
    })
    const [mapped] = mapLabels(this.accountId, [{ ...l, type: 'user' }])
    return gc ? { ...mapped, color: color as Label['color'] } : mapped
  }

  async updateLabel(remoteLabelId: string, patch: { name?: string; color?: string }): Promise<void> {
    const gc = toGmailColor(patch.color)
    await this.http.patch(`/labels/${encodeURIComponent(this.rid(remoteLabelId))}`, {
      ...(patch.name !== undefined ? { name: patch.name } : {}), ...(gc ? { color: gc } : {})
    })
  }

  async deleteLabel(remoteLabelId: string): Promise<void> {
    await this.http.delete(`/labels/${encodeURIComponent(this.rid(remoteLabelId))}`)
  }

  // ------------------------------------------------------------------ threads

  private async getThread(remoteId: string): Promise<GmailThread> {
    const t = await this.http.get<GmailThread>(`/threads/${encodeURIComponent(remoteId)}`, { format: 'full' })
    await this.inlineLargeBodies(t)
    return t
  }

  /** Large text/html bodies come back by reference (attachmentId, no data). Download and inline them. */
  private async inlineLargeBodies(t: GmailThread): Promise<void> {
    for (const m of t.messages ?? []) {
      for (const part of findLargeBodyParts(m.payload)) {
        const a = await this.http.get<{ data?: string }>(`/messages/${encodeURIComponent(m.id)}/attachments/${encodeURIComponent(part.body!.attachmentId!)}`)
        if (a.data) part.body!.data = a.data
      }
    }
  }

  async fetchThread(remoteThreadId: string): Promise<NormalizedThread> {
    const n = normalizeThread(this.accountId, this.deps.account.email, await this.getThread(this.rid(remoteThreadId)))
    if (!n) throw new Error('Thread not found')
    return n
  }

  /** Hydrate threads with bounded concurrency. 404 (deleted meanwhile) => reported in `missing`. */
  private async hydrate(ids: readonly string[]): Promise<{ threads: NormalizedThread[]; missing: string[] }> {
    const results = await pool(ids, this.o.concurrency, async (id) => {
      try {
        return normalizeThread(this.accountId, this.deps.account.email, await this.getThread(id))
      } catch (e) {
        if (e instanceof GmailApiError && e.status === 404) return null
        throw e
      }
    })
    const threads: NormalizedThread[] = []
    const missing: string[] = []
    results.forEach((r, i) => (r ? threads.push(r) : missing.push(ids[i])))
    return { threads, missing }
  }

  // ------------------------------------------------------------------ sync

  async sync(cursor: string | null): Promise<SyncPage> {
    const c = decodeCursor(cursor)
    if (!c) return this.firstBackfillPage(cursor !== null)
    return c.phase === 'backfill' ? this.backfillPage(c, false) : this.incremental(c)
  }

  private async firstBackfillPage(reset: boolean): Promise<SyncPage> {
    // Profile FIRST: its historyId is the point from which incremental sync will resume, so mail that arrives
    // while the (multi-call) crawl is running is picked up afterwards instead of being lost.
    const profile = await this.http.get<GmailProfile>('/profile')
    return this.backfillPage({ v: 1, phase: 'backfill', historyId: profile.historyId, fetched: 0 }, reset)
  }

  private async backfillPage(c: Extract<GmailCursor, { phase: 'backfill' }>, reset: boolean): Promise<SyncPage> {
    if (!c.extras) {
      const limit = this.o.backfillLimit
      const res = await this.http.get<{ threads?: { id: string }[]; nextPageToken?: string }>('/threads', {
        maxResults: Math.max(1, Math.min(100, limit - c.fetched)),
        pageToken: c.pageToken,
        fields: 'threads(id),nextPageToken'
      })
      const ids = (res.threads ?? []).map((t) => t.id)
      const { threads } = await this.hydrate(ids)
      const fetched = c.fetched + ids.length
      const more = !!res.nextPageToken && fetched < limit && ids.length > 0
      const next: GmailCursor = more
        ? { v: 1, phase: 'backfill', historyId: c.historyId, pageToken: res.nextPageToken, fetched }
        : { v: 1, phase: 'backfill', historyId: c.historyId, fetched, extras: true }
      return { threads, deletedRemoteThreadIds: [], cursor: encodeCursor(next), hasMore: true, reset }
    }

    // Trash / Spam are not in the default listing; pull a small recent slice so those mailboxes are not empty.
    const idSet = new Set<string>()
    for (const label of EXTRA_MAILBOXES) {
      const res = await this.http.get<{ threads?: { id: string }[] }>('/threads', {
        labelIds: label, includeSpamTrash: true, maxResults: EXTRA_PER_MAILBOX, fields: 'threads(id)'
      })
      for (const t of res.threads ?? []) idSet.add(t.id)
    }
    const { threads } = await this.hydrate([...idSet])
    return {
      threads, deletedRemoteThreadIds: [], hasMore: false, reset,
      cursor: encodeCursor({ v: 1, phase: 'incremental', historyId: c.historyId })
    }
  }

  private async incremental(c: Extract<GmailCursor, { phase: 'incremental' }>): Promise<SyncPage> {
    let pending = c.pending
    let historyId = c.historyId
    if (!pending) {
      const ids = new Set<string>()
      let pageToken: string | undefined
      let latest = c.historyId
      do {
        let res: GmailHistoryResponse
        try {
          res = await this.http.get<GmailHistoryResponse>('/history', {
            startHistoryId: c.historyId, historyTypes: HISTORY_TYPES, maxResults: 500, pageToken
          })
        } catch (e) {
          // 404 => startHistoryId is too old (history is only retained for about a week): full resync.
          if (e instanceof GmailApiError && e.status === 404) return this.firstBackfillPage(true)
          throw e
        }
        for (const id of diffHistory(res.history ?? []).threadIds) ids.add(id)
        if (res.historyId) latest = res.historyId
        pageToken = res.nextPageToken
      } while (pageToken)
      pending = [...ids]
      historyId = latest
      if (pending.length > this.o.maxPending) return this.firstBackfillPage(true)
    }
    const batch = pending.slice(0, this.o.hydrateBatch)
    const rest = pending.slice(this.o.hydrateBatch)
    const { threads, missing } = await this.hydrate(batch)
    const next: GmailCursor = rest.length ? { v: 1, phase: 'incremental', historyId, pending: rest } : { v: 1, phase: 'incremental', historyId }
    return { threads, deletedRemoteThreadIds: missing, cursor: encodeCursor(next), hasMore: rest.length > 0 }
  }

  // ------------------------------------------------------------------ actions

  private modify(threadId: string, add: string[], remove: string[]): Promise<unknown> {
    return this.http.post(`/threads/${encodeURIComponent(threadId)}/modify`, {
      ...(add.length ? { addLabelIds: add } : {}), ...(remove.length ? { removeLabelIds: remove } : {})
    })
  }

  async applyAction(remoteThreadId: string, action: ThreadAction, ctx: { labels: Label[] }): Promise<void> {
    const id = this.rid(remoteThreadId)
    const enc = encodeURIComponent(id)
    switch (action.type) {
      case 'archive': await this.modify(id, [], ['INBOX']); break
      case 'unarchive': await this.modify(id, ['INBOX'], ['TRASH', 'SPAM']); break
      case 'trash': await this.http.post(`/threads/${enc}/trash`); break
      case 'untrash':
        // threads.untrash only drops TRASH; the local model restores to the inbox, so mirror that.
        await this.http.post(`/threads/${enc}/untrash`)
        await this.modify(id, ['INBOX'], [])
        break
      case 'spam': await this.modify(id, ['SPAM'], ['INBOX']); break
      case 'notSpam': await this.modify(id, ['INBOX'], ['SPAM']); break
      case 'markRead': await this.modify(id, [], ['UNREAD']); break
      case 'markUnread': await this.modify(id, ['UNREAD'], []); break
      case 'star': await this.modify(id, ['STARRED'], []); break
      case 'unstar': await this.modify(id, [], ['STARRED']); break
      case 'addLabel': await this.modify(id, [toRemoteLabelId(this.accountId, ctx.labels, action.labelId)], []); break
      case 'removeLabel': await this.modify(id, [], [toRemoteLabelId(this.accountId, ctx.labels, action.labelId)]); break
      case 'deleteForever':
        try {
          await this.http.delete(`/threads/${enc}`)
        } catch (e) {
          // Permanent delete needs the full https://mail.google.com/ scope, which we deliberately do not request.
          // Degrade to Trash (Gmail purges it after 30 days) instead of failing the action.
          if (e instanceof GmailApiError && e.status === 403) await this.http.post(`/threads/${enc}/trash`)
          else throw e
        }
        break
      case 'snooze': case 'unsnooze': case 'remind': break // local-only; never sent to the provider
    }
  }

  // ------------------------------------------------------------------ compose

  /** Build the raw RFC 822 message and resolve reply threading (Message-ID/References of the parent). */
  private async prepare(msg: OutgoingMessage): Promise<{ raw: Buffer; threadId?: string }> {
    const ctx: RawContext = { from: { name: this.deps.account.name || undefined, email: this.deps.account.email } }
    let threadId: string | undefined
    const reply = msg.inReplyTo
    if (reply && reply.mode !== 'forward') {
      threadId = this.rid(reply.threadId)
      try {
        const parent = await this.http.get<GmailMessage>(`/messages/${encodeURIComponent(this.rid(reply.messageId))}`, {
          format: 'metadata', metadataHeaders: ['Message-ID', 'References', 'In-Reply-To']
        })
        const h = headerMap(parent.payload?.headers)
        const mid = h.get('message-id')?.trim()
        if (mid) {
          const refs = (h.get('references') ?? '').split(/\s+/).filter(Boolean)
          ctx.inReplyTo = mid
          ctx.references = refs.includes(mid) ? refs : [...refs, mid]
        }
      } catch (e) {
        if (!(e instanceof GmailApiError && e.status === 404)) throw e // parent gone: still thread by threadId
      }
    }
    return { raw: await this.o.buildRaw(msg, ctx), threadId }
  }

  private async putMessage(method: 'POST' | 'PUT', path: string, wrap: (m: { raw?: string; threadId?: string }) => unknown, p: { raw: Buffer; threadId?: string }): Promise<{ id: string }> {
    if (p.raw.length > this.o.uploadThresholdBytes) {
      const meta = wrap(p.threadId ? { threadId: p.threadId } : {})
      return this.http.upload<{ id: string }>(method, path, meta, p.raw)
    }
    const body = wrap({ raw: p.raw.toString('base64url'), ...(p.threadId ? { threadId: p.threadId } : {}) })
    return method === 'PUT' ? this.http.put(path, body) : this.http.post(path, body)
  }

  async send(msg: OutgoingMessage): Promise<void> {
    const p = await this.prepare(msg)
    if (msg.draftId) {
      // Replace the stored draft with the final content, then send it (this also removes the draft).
      const id = this.rid(msg.draftId)
      await this.putMessage('PUT', `/drafts/${encodeURIComponent(id)}`, (m) => ({ id, message: m }), p)
      await this.http.post('/drafts/send', { id })
      return
    }
    await this.putMessage('POST', '/messages/send', (m) => m, p)
  }

  async saveDraft(msg: OutgoingMessage): Promise<{ remoteDraftId: string }> {
    const p = await this.prepare(msg)
    if (msg.draftId) {
      const id = this.rid(msg.draftId)
      const r = await this.putMessage('PUT', `/drafts/${encodeURIComponent(id)}`, (m) => ({ id, message: m }), p)
      return { remoteDraftId: r.id ?? id }
    }
    const r = await this.putMessage('POST', '/drafts', (m) => ({ message: m }), p)
    return { remoteDraftId: r.id }
  }

  async deleteDraft(remoteDraftId: string): Promise<void> {
    try {
      await this.http.delete(`/drafts/${encodeURIComponent(this.rid(remoteDraftId))}`)
    } catch (e) {
      if (!(e instanceof GmailApiError && e.status === 404)) throw e // already gone
    }
  }

  // ------------------------------------------------------------------ attachments

  async fetchAttachment(remoteMessageId: string, attachmentId: string): Promise<Buffer> {
    const mid = encodeURIComponent(this.rid(remoteMessageId))
    const { partId, attachmentId: gid } = splitAttachmentId(attachmentId)
    if (gid) {
      try {
        const a = await this.http.get<{ data?: string }>(`/messages/${mid}/attachments/${encodeURIComponent(gid)}`)
        return Buffer.from(a.data ?? '', 'base64url')
      } catch (e) {
        if (!(e instanceof GmailApiError && e.status === 404 && partId)) throw e
        // attachmentIds are not stable across fetches: re-resolve through the (stable) partId below.
      }
    }
    const m = await this.http.get<GmailMessage>(`/messages/${mid}`, { format: 'full' })
    const part = findPart(m.payload, partId)
    if (!part) throw new Error('Attachment not found')
    if (part.body?.data) return Buffer.from(part.body.data, 'base64url')
    if (part.body?.attachmentId) {
      const a = await this.http.get<{ data?: string }>(`/messages/${mid}/attachments/${encodeURIComponent(part.body.attachmentId)}`)
      return Buffer.from(a.data ?? '', 'base64url')
    }
    throw new Error('Attachment has no content')
  }
}

function findPart(p: GmailPart | undefined, partId: string): GmailPart | undefined {
  if (!p) return undefined
  if ((p.partId ?? '') === partId) return p
  for (const k of p.parts ?? []) {
    const hit = findPart(k, partId)
    if (hit) return hit
  }
  return undefined
}
