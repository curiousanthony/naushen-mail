import type { Label, OutgoingAttachment, OutgoingMessage, ThreadAction } from '@shared/types'
import { makeId } from '@shared/types'
import { mt } from '../../i18n'
import type { NormalizedThread, ProviderAdapter, SyncPage } from '../types'
import { GraphClient, GraphError, enc, isNotFound, isSyncStateError, odataString, type TokenSource } from './graph'
import {
  FOLDER_ROLE, buildThread, categoryNameFromRemoteId, categoryRemoteId, colorFromPreset, presetFromColor,
  toGraphRecipient, type NormalizeContext
} from './mapping'
import { WELL_KNOWN, type GraphAttachment, type GraphCategory, type GraphMailFolder, type GraphMessage, type Page, type WellKnown } from './types'

// ------------------------------------------------------------------ tunables

/** ~1000 newest messages are listed for the initial backfill (then delta takes over). */
export const BACKFILL_LIMIT = 1000
const LIST_PAGE = 50
const DELTA_PAGE = 100
const MAX_DELTA_PAGES = 400
/** Graph accepts inline (JSON) attachments below ~3 MB. */
export const INLINE_ATTACHMENT_LIMIT = 3 * 1024 * 1024
const UPLOAD_CHUNK = 12 * 320 * 1024

const BODY_HTML = 'outlook.body-content-type="html"'
const ATT_SELECT = 'attachments($select=id,name,contentType,size,isInline,contentId)'
const FULL_SELECT =
  'id,conversationId,conversationIndex,subject,bodyPreview,body,from,sender,toRecipients,ccRecipients,bccRecipients,replyTo,' +
  'receivedDateTime,sentDateTime,isRead,isDraft,hasAttachments,flag,categories,parentFolderId,internetMessageId,internetMessageHeaders'
const LIGHT_SELECT = 'id,conversationId,conversationIndex,parentFolderId,isRead,isDraft,flag,categories,from,receivedDateTime'
const FOLDER_TTL = 30 * 60_000

// ------------------------------------------------------------------ cursor

interface Cursor {
  v: 1
  phase: 'backfill' | 'baseline' | 'delta'
  /** backfill: next page link of the /me/messages listing. */
  next?: string
  fetched?: number
  /** Oldest receivedDateTime that was backfilled (undefined => whole mailbox was listed, delta is unfiltered). */
  cutoff?: string
  /** baseline: folders still to snapshot. */
  todo?: string[]
  /** delta: folders still to poll in the current round. */
  pending?: string[]
  /** deltaLink per well-known folder. */
  links: Record<string, string>
}

export const encodeCursor = (c: Cursor): string => Buffer.from(JSON.stringify(c)).toString('base64url')
export function decodeCursor(s: string | null): Cursor | null {
  if (!s) return null
  try {
    const c = JSON.parse(Buffer.from(s, 'base64url').toString()) as Cursor
    return c && c.v === 1 && (c.phase === 'backfill' || c.phase === 'baseline' || c.phase === 'delta') ? { ...c, links: c.links ?? {} } : null
  } catch { return null }
}

// ------------------------------------------------------------------ helpers

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]) }
  }))
  return out
}

const rawSize = (a: OutgoingAttachment): number => Math.floor((a.dataBase64.length * 3) / 4) - (a.dataBase64.endsWith('==') ? 2 : a.dataBase64.endsWith('=') ? 1 : 0)
const unique = <T>(xs: T[]): T[] => [...new Set(xs)]

export interface OutlookAdapterDeps {
  account: { id: string; email: string; name: string }
  tokens: TokenSource
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** Resolve a graph message id to its conversation via the local store (needed for delta `@removed` items). */
  lookupConversation?: (remoteMessageId: string) => string | undefined
  backfillLimit?: number
}

export class OutlookAdapter implements ProviderAdapter {
  readonly kind = 'outlook' as const
  readonly accountId: string
  readonly client: GraphClient

  private folderIdByWk = new Map<WellKnown, string>()
  private wkByFolderId = new Map<string, WellKnown>()
  private foldersAt = 0
  /** Id of an Archive folder we had to create because the mailbox had none (the `archive` alias doesn't resolve to it). */
  private createdArchiveId: string | null = null
  private categories = new Map<string, GraphCategory>() // lower-case name -> category
  private categoriesLoaded = false
  private msgConv = new Map<string, string>()
  private seenMsg = new Set<string>()
  private backfillConvs = new Set<string>()
  private baselineConvs = new Set<string>()
  private readonly me: string

  constructor(private deps: OutlookAdapterDeps) {
    this.accountId = deps.account.id
    this.me = deps.account.email.toLowerCase()
    this.client = new GraphClient({ tokens: deps.tokens, fetchImpl: deps.fetchImpl, sleep: deps.sleep })
  }

  dispose(): void { this.client.dispose() }

  // ================================================================ folders & labels

  private async ensureFolders(force = false): Promise<void> {
    if (!force && this.folderIdByWk.size && Date.now() - this.foldersAt < FOLDER_TTL) return
    const results = await Promise.allSettled(WELL_KNOWN.map((wk) => this.client.get<GraphMailFolder>(`/me/mailFolders/${wk}`, { query: { $select: 'id,displayName' } })))
    const byWk = new Map<WellKnown, string>()
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value?.id) byWk.set(WELL_KNOWN[i], r.value.id)
      else if (r.status === 'rejected' && !isNotFound(r.reason) && WELL_KNOWN[i] === 'inbox') throw r.reason
    })
    if (!byWk.has('inbox')) throw new Error(mt('outlook.noInbox'))
    if (!byWk.has('archive') && this.createdArchiveId) byWk.set('archive', this.createdArchiveId)
    this.folderIdByWk = byWk
    this.wkByFolderId = new Map([...byWk].map(([wk, id]) => [id, wk]))
    this.foldersAt = Date.now()
  }

  private folderRole = (folderId?: string): ReturnType<NormalizeContext['folderRole']> => {
    const wk = folderId ? this.wkByFolderId.get(folderId) : undefined
    return wk ? { wk, role: FOLDER_ROLE[wk].role } : undefined
  }

  private roleOfMsg(m: GraphMessage): WellKnown | undefined { return this.folderRole(m.parentFolderId)?.wk }

  private async loadCategories(): Promise<void> {
    try {
      const cats = await this.client.getAll<GraphCategory>('/me/outlook/masterCategories', { query: { $top: 100 } })
      this.categories = new Map(cats.map((c) => [c.displayName.toLowerCase(), c]))
    } catch (e) {
      // Categories need MailboxSettings.*; if unavailable, mail still works without user labels.
      if (!(e instanceof GraphError) || e.status === 401) throw e
      this.categories = new Map()
    }
    this.categoriesLoaded = true
  }

  async listLabels(): Promise<Label[]> {
    await this.ensureFolders()
    await this.loadCategories()
    const system: Label[] = WELL_KNOWN.map((wk) => ({
      id: makeId(this.accountId, wk), accountId: this.accountId, remoteId: wk, name: FOLDER_ROLE[wk].name, kind: 'system', role: FOLDER_ROLE[wk].role
    }))
    const user: Label[] = [...this.categories.values()].map((c) => ({
      id: makeId(this.accountId, categoryRemoteId(c.displayName)), accountId: this.accountId, remoteId: categoryRemoteId(c.displayName),
      name: c.displayName, color: colorFromPreset(c.color), kind: 'user'
    }))
    return [...system, ...user]
  }

  private ctx(): NormalizeContext {
    return {
      accountId: this.accountId, folderRole: this.folderRole,
      knownCategories: new Set([...this.categories.values()].map((c) => c.displayName))
    }
  }

  // ================================================================ conversations

  private remember(m: GraphMessage): void {
    if (!m.conversationId) return
    if (this.msgConv.size > 20_000) this.msgConv.delete(this.msgConv.keys().next().value as string)
    this.msgConv.set(m.id, m.conversationId)
  }

  /** All messages of a conversation, across folders. No $orderby (would trigger InefficientFilter); sorted locally. */
  private async conversationMessages(conversationId: string, full: boolean): Promise<GraphMessage[]> {
    const msgs = await this.client.getAll<GraphMessage>('/me/messages', {
      query: {
        $filter: `conversationId eq '${odataString(conversationId)}'`,
        $select: full ? FULL_SELECT : LIGHT_SELECT,
        $expand: full ? ATT_SELECT : undefined,
        $top: 25
      },
      prefer: full ? [BODY_HTML] : undefined
    }, 40)
    for (const m of msgs) this.remember({ ...m, conversationId })
    return msgs
  }

  /** Re-fetch whole conversations (bounded concurrency, deduped) and rebuild their threads. */
  private async refresh(conversationIds: string[]): Promise<{ threads: NormalizedThread[]; deleted: string[] }> {
    const ids = unique(conversationIds)
    if (!ids.length) return { threads: [], deleted: [] }
    await this.ensureFolders()
    if (!this.categoriesLoaded) await this.loadCategories()
    const ctx = this.ctx()
    const results = await mapLimit(ids, 4, async (id) => ({ id, msgs: await this.conversationMessages(id, true) }))
    const threads: NormalizedThread[] = []
    const deleted: string[] = []
    for (const { id, msgs } of results) {
      const t = buildThread(id, msgs, ctx)
      if (t) threads.push(t)
      else deleted.push(id)
    }
    return { threads, deleted }
  }

  async fetchThread(remoteThreadId: string): Promise<NormalizedThread> {
    const { threads } = await this.refresh([remoteThreadId])
    if (!threads[0]) throw new Error(mt('errors.threadNotFound'))
    return threads[0]
  }

  // ================================================================ sync

  async sync(cursor: string | null): Promise<SyncPage> {
    const cur = decodeCursor(cursor)
    if (cursor && !cur) return this.resetPage() // unreadable cursor
    try {
      if (!cur) return await this.backfillStep(null)
      if (cur.phase === 'backfill') return await this.backfillStep(cur)
      if (cur.phase === 'baseline') return await this.baselineStep(cur)
      return await this.deltaStep(cur)
    } catch (e) {
      if (cur && isSyncStateError(e)) return this.resetPage() // syncStateNotFound / 410: discard and re-backfill
      throw e
    }
  }

  private resetPage(): SyncPage {
    this.seenMsg.clear(); this.backfillConvs.clear(); this.baselineConvs.clear()
    return { threads: [], deletedRemoteThreadIds: [], cursor: null, hasMore: true, reset: true }
  }

  private async backfillStep(cur: Cursor | null): Promise<SyncPage> {
    if (!cur) {
      await this.ensureFolders(true)
      await this.loadCategories()
      this.seenMsg.clear(); this.backfillConvs.clear(); this.baselineConvs.clear()
    }
    const state: Cursor = cur ?? { v: 1, phase: 'backfill', fetched: 0, links: {} }
    const page = state.next
      ? await this.client.get<Page<GraphMessage>>(state.next)
      : await this.client.get<Page<GraphMessage>>('/me/messages', {
        query: { $select: 'id,conversationId,receivedDateTime,parentFolderId', $orderby: 'receivedDateTime desc', $top: LIST_PAGE }
      })
    const items = page.value ?? []
    let oldest = state.cutoff
    for (const m of items) {
      this.seenMsg.add(m.id); this.remember(m)
      if (m.receivedDateTime && (!oldest || m.receivedDateTime < oldest)) oldest = m.receivedDateTime
    }
    const convs = unique(items.map((m) => m.conversationId).filter((c): c is string => !!c && !this.backfillConvs.has(c)))
    convs.forEach((c) => this.backfillConvs.add(c))
    const { threads, deleted } = await this.refresh(convs)

    const fetched = (state.fetched ?? 0) + items.length
    const next = page['@odata.nextLink']
    if (next && fetched < (this.deps.backfillLimit ?? BACKFILL_LIMIT)) {
      return { threads, deletedRemoteThreadIds: deleted, cursor: encodeCursor({ ...state, next, fetched, cutoff: oldest }), hasMore: true }
    }
    // Backfill done: snapshot delta state for each folder next. If the mailbox was fully listed there is no window => unfiltered delta.
    const todo = [...this.folderIdByWk.keys()]
    return {
      threads, deletedRemoteThreadIds: deleted, hasMore: true,
      cursor: encodeCursor({ v: 1, phase: 'baseline', cutoff: next ? oldest : undefined, todo, links: {} })
    }
  }

  /** Follows a delta round to its `@odata.deltaLink`, collecting every item. */
  private async walkDelta(start: string, startOpts?: Parameters<GraphClient['get']>[1]): Promise<{ items: GraphMessage[]; deltaLink: string }> {
    const items: GraphMessage[] = []
    let url = start
    for (let i = 0; i < MAX_DELTA_PAGES; i++) {
      const page = await this.client.get<Page<GraphMessage>>(url, i === 0 ? startOpts : { prefer: [`odata.maxpagesize=${DELTA_PAGE}`] })
      items.push(...(page.value ?? []))
      if (page['@odata.deltaLink']) return { items, deltaLink: page['@odata.deltaLink'] }
      if (!page['@odata.nextLink']) break
      url = page['@odata.nextLink']
    }
    throw new Error(mt('outlook.deltaIncomplete'))
  }

  private async baselineStep(cur: Cursor): Promise<SyncPage> {
    await this.ensureFolders()
    const todo = [...(cur.todo ?? [])] as WellKnown[]
    const wk = todo.shift()
    const links = { ...cur.links }
    let convs: string[] = []
    if (wk) {
      const query: Record<string, string | undefined> = { $select: 'id,conversationId' }
      if (cur.cutoff) { query.$filter = `receivedDateTime ge ${cur.cutoff}`; query.$orderby = 'receivedDateTime desc' }
      const { items, deltaLink } = await this.walkDelta(`/me/mailFolders/${wk}/messages/delta`, { query, prefer: [`odata.maxpagesize=${DELTA_PAGE}`] })
      links[wk] = deltaLink
      // Anything we didn't list during the backfill arrived in the gap: pull its whole conversation.
      for (const m of items) {
        this.remember(m)
        if (m.conversationId && !this.seenMsg.has(m.id) && !this.baselineConvs.has(m.conversationId)) { this.baselineConvs.add(m.conversationId); convs.push(m.conversationId) }
      }
    }
    const { threads, deleted } = await this.refresh(convs)
    const done = todo.length === 0
    return {
      threads, deletedRemoteThreadIds: deleted, hasMore: !done,
      cursor: encodeCursor(done ? { v: 1, phase: 'delta', links } : { v: 1, phase: 'baseline', cutoff: cur.cutoff, todo, links })
    }
  }

  private async conversationOfRemoved(id: string): Promise<string | undefined> {
    const known = this.msgConv.get(id) ?? this.deps.lookupConversation?.(id)
    if (known) return known
    try {
      const m = await this.client.get<GraphMessage>(`/me/messages/${enc(id)}`, { query: { $select: 'id,conversationId' } })
      return m.conversationId
    } catch (e) {
      if (isNotFound(e)) return undefined // permanently deleted and never seen locally
      throw e
    }
  }

  private async deltaStep(cur: Cursor): Promise<SyncPage> {
    await this.ensureFolders()
    const known = Object.keys(cur.links)
    let pending = (cur.pending ?? []).filter((f) => f in cur.links)
    if (!pending.length) pending = known
    const wk = pending.shift()!
    const links = { ...cur.links }
    const convs: string[] = []
    if (wk) {
      const { items, deltaLink } = await this.walkDelta(links[wk], { prefer: [`odata.maxpagesize=${DELTA_PAGE}`] })
      for (const m of items) {
        if (m['@removed']) {
          const c = await this.conversationOfRemoved(m.id)
          if (c) convs.push(c)
        } else if (m.conversationId) { this.remember(m); convs.push(m.conversationId) }
      }
      links[wk] = deltaLink
    }
    const { threads, deleted } = await this.refresh(convs)
    return { threads, deletedRemoteThreadIds: deleted, hasMore: pending.length > 0, cursor: encodeCursor({ v: 1, phase: 'delta', links, pending }) }
  }

  // ================================================================ actions

  private async move(ids: string[], destination: string): Promise<void> {
    await mapLimit(ids, 4, (id) => this.client.post(`/me/messages/${enc(id)}/move`, { destinationId: destination }).catch(ignoreNotFound))
  }

  private async patchAll(ids: string[], body: (id: string) => unknown): Promise<void> {
    await mapLimit(ids, 4, (id) => this.client.patch(`/me/messages/${enc(id)}`, body(id)).catch(ignoreNotFound))
  }

  /** Where a message goes when it leaves Trash/Spam/Archive: back to Sent/Drafts if it is mine, else the Inbox. */
  private restoreTo(m: GraphMessage): string {
    if (m.isDraft) return 'drafts'
    return m.from?.emailAddress?.address?.toLowerCase() === this.me ? 'sentitems' : 'inbox'
  }

  private async archiveDestination(): Promise<string> {
    if (this.createdArchiveId) return this.createdArchiveId
    if (!this.folderIdByWk.has('archive')) await this.ensureFolders(true)
    if (this.createdArchiveId) return this.createdArchiveId
    if (this.folderIdByWk.has('archive')) return 'archive'
    // Some mailboxes have no Archive folder yet: create one and remember it.
    const f = await this.client.post<GraphMailFolder>('/me/mailFolders', { displayName: 'Archive' })
    this.createdArchiveId = f.id
    this.folderIdByWk.set('archive', f.id)
    this.wkByFolderId.set(f.id, 'archive')
    return f.id
  }

  async applyAction(remoteThreadId: string, action: ThreadAction, ctx: { labels: Label[] }): Promise<void> {
    if (action.type === 'snooze' || action.type === 'unsnooze' || action.type === 'remind') return // local only
    await this.ensureFolders()
    const msgs = await this.conversationMessages(remoteThreadId, false)
    if (!msgs.length) return
    const role = (m: GraphMessage): WellKnown | undefined => this.roleOfMsg(m)
    const ids = (xs: GraphMessage[]): string[] => xs.map((m) => m.id)
    const restore = async (xs: GraphMessage[]): Promise<void> => {
      for (const dest of unique(xs.map((m) => this.restoreTo(m)))) await this.move(ids(xs.filter((m) => this.restoreTo(m) === dest)), dest)
    }

    switch (action.type) {
      case 'archive': {
        const inbox = msgs.filter((m) => role(m) === 'inbox')
        if (inbox.length) await this.move(ids(inbox), await this.archiveDestination())
        break
      }
      case 'unarchive': await restore(msgs.filter((m) => { const r = role(m); return r !== 'inbox' && r !== 'sentitems' && r !== 'drafts' })); break
      case 'trash': await this.move(ids(msgs.filter((m) => role(m) !== 'deleteditems')), 'deleteditems'); break
      case 'untrash': await restore(msgs.filter((m) => role(m) === 'deleteditems')); break
      case 'spam': await this.move(ids(msgs.filter((m) => role(m) !== 'junkemail')), 'junkemail'); break
      case 'notSpam': await restore(msgs.filter((m) => role(m) === 'junkemail')); break
      case 'markRead':
      case 'markUnread': {
        const read = action.type === 'markRead'
        await this.patchAll(ids(msgs.filter((m) => !m.isDraft && (m.isRead ?? false) !== read)), () => ({ isRead: read }))
        break
      }
      case 'star': {
        // Flag the newest real message only (like Outlook's conversation flag), not every message.
        const candidates = msgs.filter((m) => !m.isDraft && role(m) !== 'deleteditems' && role(m) !== 'junkemail')
        const newest = [...(candidates.length ? candidates : msgs)].sort((a, b) => (a.receivedDateTime ?? '').localeCompare(b.receivedDateTime ?? '')).pop()
        if (newest && newest.flag?.flagStatus !== 'flagged') await this.patchAll([newest.id], () => ({ flag: { flagStatus: 'flagged' } }))
        break
      }
      case 'unstar': await this.patchAll(ids(msgs.filter((m) => m.flag?.flagStatus === 'flagged')), () => ({ flag: { flagStatus: 'notFlagged' } })); break
      case 'addLabel':
      case 'removeLabel': {
        const label = ctx.labels.find((l) => l.id === action.labelId)
        const name = label && label.kind === 'user' ? (categoryNameFromRemoteId(label.remoteId) ?? label.name) : null
        if (!name) return // system labels are folders; handled by archive/trash/spam actions
        const has = (m: GraphMessage): boolean => (m.categories ?? []).some((c) => c.toLowerCase() === name.toLowerCase())
        const add = action.type === 'addLabel'
        const targets = msgs.filter((m) => (add ? !has(m) : has(m)))
        const byId = new Map(targets.map((m) => [m.id, m]))
        await this.patchAll(ids(targets), (id) => {
          const cur = byId.get(id)?.categories ?? []
          return { categories: add ? [...cur, name] : cur.filter((c) => c.toLowerCase() !== name.toLowerCase()) }
        })
        break
      }
      case 'deleteForever':
        await mapLimit(ids(msgs), 4, (id) => this.client.delete(`/me/messages/${enc(id)}`).catch(ignoreNotFound))
        break
    }
  }

  // ================================================================ send / drafts

  private fileAttachment(a: OutgoingAttachment): Record<string, unknown> {
    const inline = !!(a.inline || a.contentId)
    return {
      '@odata.type': '#microsoft.graph.fileAttachment', name: a.filename, contentType: a.mimeType || 'application/octet-stream',
      contentBytes: a.dataBase64, isInline: inline, ...(a.contentId ? { contentId: a.contentId.replace(/^<|>$/g, '') } : {})
    }
  }

  private messageJson(msg: OutgoingMessage): Record<string, unknown> {
    return {
      subject: msg.subject,
      body: { contentType: 'HTML', content: msg.html },
      toRecipients: msg.to.map(toGraphRecipient), ccRecipients: msg.cc.map(toGraphRecipient), bccRecipients: msg.bcc.map(toGraphRecipient)
    }
  }

  /** Local message ids are `${accountId}:${remoteId}`; accept either form. */
  private remoteMessageId(id: string): string { return id.startsWith(`${this.accountId}:`) ? id.slice(this.accountId.length + 1) : id }

  private needsDraftFlow(msg: OutgoingMessage): boolean {
    const atts = msg.attachments ?? []
    return !!msg.inReplyTo || !!msg.draftId || atts.some((a) => rawSize(a) > INLINE_ATTACHMENT_LIMIT) || atts.reduce((n, a) => n + rawSize(a), 0) > INLINE_ATTACHMENT_LIMIT
  }

  async send(msg: OutgoingMessage): Promise<void> {
    if (!this.needsDraftFlow(msg)) {
      await this.client.post('/me/sendMail', {
        message: { ...this.messageJson(msg), attachments: (msg.attachments ?? []).map((a) => this.fileAttachment(a)) },
        saveToSentItems: true
      })
      return
    }
    const id = await this.upsertDraft(msg)
    try {
      await this.client.post(`/me/messages/${enc(id)}/send`)
    } catch (e) {
      if (!msg.draftId) await this.client.delete(`/me/messages/${enc(id)}`).catch(() => undefined) // don't leave a stray draft behind
      throw e
    }
  }

  async saveDraft(msg: OutgoingMessage): Promise<{ remoteDraftId: string }> {
    return { remoteDraftId: await this.upsertDraft(msg) }
  }

  async deleteDraft(remoteDraftId: string): Promise<void> {
    await this.client.delete(`/me/messages/${enc(this.remoteMessageId(remoteDraftId))}`).catch(ignoreNotFound)
  }

  /** Create (new / reply / forward) or update a server draft so it matches `msg`. Returns the draft id. */
  private async upsertDraft(msg: OutgoingMessage): Promise<string> {
    const json = this.messageJson(msg)
    if (msg.draftId) {
      const id = this.remoteMessageId(msg.draftId)
      await this.client.patch(`/me/messages/${enc(id)}`, json)
      await this.syncDraftAttachments(id, msg.attachments ?? [])
      return id
    }
    if (msg.inReplyTo) {
      const mode = msg.inReplyTo.mode
      const endpoint = mode === 'forward' ? 'createForward' : mode === 'replyAll' ? 'createReplyAll' : 'createReply'
      const draft = await this.client.post<GraphMessage>(`/me/messages/${enc(this.remoteMessageId(msg.inReplyTo.messageId))}/${endpoint}`, {}, { prefer: [BODY_HTML] })
      const body = mergeQuote(msg.html, draft.body?.content ?? '')
      await this.client.patch(`/me/messages/${enc(draft.id)}`, { ...json, subject: msg.subject || draft.subject || '', body: { contentType: 'HTML', content: body } })
      await this.addAttachments(draft.id, msg.attachments ?? [])
      return draft.id
    }
    const atts = msg.attachments ?? []
    const allSmall = atts.every((a) => rawSize(a) <= INLINE_ATTACHMENT_LIMIT) && atts.reduce((n, a) => n + rawSize(a), 0) <= INLINE_ATTACHMENT_LIMIT
    const created = await this.client.post<GraphMessage>('/me/messages', { ...json, ...(allSmall && atts.length ? { attachments: atts.map((a) => this.fileAttachment(a)) } : {}) })
    if (!allSmall) await this.addAttachments(created.id, atts)
    return created.id
  }

  private async addAttachments(draftId: string, atts: OutgoingAttachment[]): Promise<void> {
    for (const a of atts) {
      if (rawSize(a) <= INLINE_ATTACHMENT_LIMIT) { await this.client.post(`/me/messages/${enc(draftId)}/attachments`, this.fileAttachment(a)); continue }
      const inline = !!(a.inline || a.contentId)
      const session = await this.client.post<{ uploadUrl: string }>(`/me/messages/${enc(draftId)}/attachments/createUploadSession`, {
        AttachmentItem: { attachmentType: 'file', name: a.filename, size: rawSize(a), isInline: inline, ...(a.contentId ? { contentId: a.contentId } : {}) }
      })
      await this.uploadInChunks(session.uploadUrl, Buffer.from(a.dataBase64, 'base64'))
    }
  }

  /** The upload URL embeds its own token: it must NOT receive our bearer token, so this bypasses GraphClient. */
  private async uploadInChunks(uploadUrl: string, data: Buffer): Promise<void> {
    const doFetch = this.deps.fetchImpl ?? globalThis.fetch
    for (let start = 0; start < data.length; start += UPLOAD_CHUNK) {
      const end = Math.min(start + UPLOAD_CHUNK, data.length)
      const res = await doFetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(end - start), 'Content-Range': `bytes ${start}-${end - 1}/${data.length}` },
        body: data.subarray(start, end)
      })
      if (!res.ok) throw new GraphError(res.status, String(res.status), mt('outlook.attachmentUpload', { status: res.status }))
    }
  }

  /** Make the draft's attachments match the desired list (by name): delete removed ones, add new ones. */
  private async syncDraftAttachments(draftId: string, desired: OutgoingAttachment[]): Promise<void> {
    const existing = await this.client.getAll<GraphAttachment>(`/me/messages/${enc(draftId)}/attachments`, { query: { $select: 'id,name,size,isInline' } })
    const want = new Set(desired.map((a) => a.filename))
    const have = new Set(existing.map((a) => a.name ?? ''))
    for (const a of existing) if (!want.has(a.name ?? '')) await this.client.delete(`/me/messages/${enc(draftId)}/attachments/${enc(a.id)}`).catch(ignoreNotFound)
    await this.addAttachments(draftId, desired.filter((a) => !have.has(a.filename)))
  }

  async fetchAttachment(remoteMessageId: string, attachmentId: string): Promise<Buffer> {
    const base = `/me/messages/${enc(this.remoteMessageId(remoteMessageId))}/attachments/${enc(attachmentId)}`
    try {
      return await this.client.get<Buffer>(`${base}/$value`, { raw: true })
    } catch (e) {
      if (isNotFound(e)) throw e
      const a = await this.client.get<GraphAttachment>(base) // fallback: base64 payload
      if (!a.contentBytes) throw e
      return Buffer.from(a.contentBytes, 'base64')
    }
  }

  // ================================================================ labels (Outlook categories)

  async createLabel(name: string, color?: string): Promise<Label> {
    const cat = await this.client.post<GraphCategory>('/me/outlook/masterCategories', { displayName: name, color: presetFromColor(color) })
    this.categories.set(cat.displayName.toLowerCase(), cat)
    return {
      id: makeId(this.accountId, categoryRemoteId(cat.displayName)), accountId: this.accountId, remoteId: categoryRemoteId(cat.displayName),
      name: cat.displayName, color: colorFromPreset(cat.color) ?? (color as Label['color']), kind: 'user'
    }
  }

  private async findCategory(remoteLabelId: string): Promise<GraphCategory> {
    const name = categoryNameFromRemoteId(remoteLabelId)
    if (!name) throw new Error(mt('outlook.categoryOnly'))
    await this.loadCategories()
    const cat = this.categories.get(name.toLowerCase())
    if (!cat) throw new Error(mt('outlook.categoryGone', { name }))
    return cat
  }

  /**
   * Graph cannot rename a category (displayName is read-only). Colour changes are a plain PATCH; a rename creates the new
   * category, re-tags every message carrying the old one, then deletes the old category.
   */
  async updateLabel(remoteLabelId: string, patch: { name?: string; color?: string }): Promise<void> {
    const cat = await this.findCategory(remoteLabelId)
    const renaming = patch.name !== undefined && patch.name.trim() !== '' && patch.name !== cat.displayName
    if (!renaming) {
      if (patch.color !== undefined) {
        await this.client.patch(`/me/outlook/masterCategories/${enc(cat.id)}`, { color: presetFromColor(patch.color) })
        this.categories.set(cat.displayName.toLowerCase(), { ...cat, color: presetFromColor(patch.color) })
      }
      return
    }
    const newName = patch.name!.trim()
    const color = patch.color !== undefined ? presetFromColor(patch.color) : cat.color ?? 'none'
    const created = await this.client.post<GraphCategory>('/me/outlook/masterCategories', { displayName: newName, color })
    const tagged = await this.client.getAll<GraphMessage>('/me/messages', {
      query: { $filter: `categories/any(c:c eq '${odataString(cat.displayName)}')`, $select: 'id,categories', $top: 50 }
    }, 200)
    await this.patchAll(tagged.map((m) => m.id), (id) => {
      const cur = tagged.find((m) => m.id === id)?.categories ?? []
      return { categories: unique(cur.map((c) => (c.toLowerCase() === cat.displayName.toLowerCase() ? newName : c))) }
    })
    await this.client.delete(`/me/outlook/masterCategories/${enc(cat.id)}`)
    this.categories.delete(cat.displayName.toLowerCase())
    this.categories.set(created.displayName.toLowerCase(), created)
  }

  async deleteLabel(remoteLabelId: string): Promise<void> {
    const cat = await this.findCategory(remoteLabelId)
    await this.client.delete(`/me/outlook/masterCategories/${enc(cat.id)}`)
    this.categories.delete(cat.displayName.toLowerCase())
  }
}

function ignoreNotFound(e: unknown): void { if (!isNotFound(e)) throw e }

/**
 * Reply/forward drafts created by Graph already contain the quoted original. If the composer's own HTML carries a quote
 * (blockquote type="cite", see docs/05-email-html-contract.md) use it as-is; otherwise put the new text above Graph's quote.
 */
export function mergeQuote(userHtml: string, graphBodyHtml: string): string {
  if (!graphBodyHtml.trim() || /<blockquote[^>]*type=["']?cite/i.test(userHtml)) return userHtml
  const open = /<body[^>]*>/i.exec(graphBodyHtml)
  if (!open) return userHtml + graphBodyHtml
  const at = open.index + open[0].length
  return `${graphBodyHtml.slice(0, at)}${userHtml}<br>${graphBodyHtml.slice(at)}`
}
