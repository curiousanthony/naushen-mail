import type { SQLInputValue } from 'node:sqlite'
import type {
  Account, Address, AppSettings, Attachment, Contact, Counts, Draft, Label, Message, ScheduledSend,
  SystemRole, Thread, ThreadAction, ThreadFilter, ThreadListResult, ThreadQuery, ThreadWithMessages, View
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { NormalizedThread } from '../providers/types'
import { type DB, tx } from './db'

type Row = Record<string, any>
const j = <T>(s: string | null | undefined, fallback: T): T => (s ? (JSON.parse(s) as T) : fallback)

const rowToAccount = (r: Row): Account => ({
  id: r.id, provider: r.provider, email: r.email, name: r.name, color: r.color,
  createdAt: r.created_at, syncCursor: r.sync_cursor, lastSyncAt: r.last_sync_at,
  status: r.status, statusMessage: r.status_message ?? undefined
})
const rowToLabel = (r: Row): Label => ({
  id: r.id, accountId: r.account_id, remoteId: r.remote_id, name: r.name,
  color: r.color ?? undefined, kind: r.kind, role: r.role ?? undefined
})

export class Repo {
  constructor(readonly db: DB) {}

  // ------------------------------------------------------------ accounts
  listAccounts(): Account[] {
    return (this.db.prepare('SELECT * FROM accounts ORDER BY created_at').all() as Row[]).map(rowToAccount)
  }
  getAccount(id: string): Account | null {
    const r = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Row | undefined
    return r ? rowToAccount(r) : null
  }
  upsertAccount(a: Account): void {
    this.db.prepare(
      `INSERT INTO accounts (id, provider, email, name, color, created_at, sync_cursor, last_sync_at, status, status_message)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name, color=excluded.color,
         sync_cursor=excluded.sync_cursor, last_sync_at=excluded.last_sync_at, status=excluded.status,
         status_message=excluded.status_message`
    ).run(a.id, a.provider, a.email, a.name, a.color, a.createdAt, a.syncCursor, a.lastSyncAt, a.status, a.statusMessage ?? null)
  }
  patchAccount(id: string, patch: Partial<Account>): void {
    const cur = this.getAccount(id)
    if (cur) this.upsertAccount({ ...cur, ...patch })
  }
  deleteAccount(id: string): void {
    tx(this.db, () => {
      this.db.prepare('DELETE FROM thread_fts WHERE thread_id IN (SELECT id FROM threads WHERE account_id = ?)').run(id)
      this.db.prepare('DELETE FROM messages WHERE account_id = ?').run(id)
      this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id) // cascades threads/labels/thread_labels
    })
  }
  /** Wipe synced mail for an account but keep the account row (used on cursor reset). */
  clearAccountMail(id: string): void {
    tx(this.db, () => {
      this.db.prepare('DELETE FROM thread_fts WHERE thread_id IN (SELECT id FROM threads WHERE account_id = ?)').run(id)
      this.db.prepare('DELETE FROM messages WHERE account_id = ?').run(id)
      this.db.prepare('DELETE FROM threads WHERE account_id = ?').run(id)
    })
  }

  // ------------------------------------------------------------ labels
  listLabels(): Label[] {
    return (this.db.prepare('SELECT * FROM labels ORDER BY kind DESC, name COLLATE NOCASE').all() as Row[]).map(rowToLabel)
  }
  getLabel(id: string): Label | null {
    const r = this.db.prepare('SELECT * FROM labels WHERE id = ?').get(id) as Row | undefined
    return r ? rowToLabel(r) : null
  }
  labelsForAccount(accountId: string): Label[] {
    return (this.db.prepare('SELECT * FROM labels WHERE account_id = ?').all(accountId) as Row[]).map(rowToLabel)
  }
  upsertLabel(l: Label): void {
    this.db.prepare(
      `INSERT INTO labels (id, account_id, remote_id, name, color, kind, role) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=COALESCE(labels.color, excluded.color), kind=excluded.kind, role=excluded.role`
    ).run(l.id, l.accountId, l.remoteId, l.name, l.color ?? null, l.kind, l.role ?? null)
  }
  replaceLabels(accountId: string, labels: Label[]): void {
    tx(this.db, () => {
      const keep = new Set(labels.map((l) => l.id))
      for (const l of labels) this.upsertLabel(l)
      for (const old of this.labelsForAccount(accountId)) {
        if (!keep.has(old.id)) {
          this.db.prepare('DELETE FROM labels WHERE id = ?').run(old.id)
          this.db.prepare('DELETE FROM thread_labels WHERE label_id = ?').run(old.id)
        }
      }
    })
  }
  patchLabel(id: string, patch: { name?: string; color?: string }): void {
    if (patch.name !== undefined) this.db.prepare('UPDATE labels SET name = ? WHERE id = ?').run(patch.name, id)
    if (patch.color !== undefined) this.db.prepare('UPDATE labels SET color = ? WHERE id = ?').run(patch.color, id)
  }
  deleteLabel(id: string): void {
    this.db.prepare('DELETE FROM thread_labels WHERE label_id = ?').run(id)
    this.db.prepare('DELETE FROM labels WHERE id = ?').run(id)
  }

  // ------------------------------------------------------------ threads (write)
  /** Insert or update a normalised thread, preserving local-only fields (snooze / reminder). */
  upsertNormalized(n: NormalizedThread): void {
    const t = n.thread
    tx(this.db, () => {
      this.db.prepare(
        `INSERT INTO threads (id, account_id, remote_id, subject, snippet, last_message_at, message_count, unread, starred, has_attachments, participants)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET subject=excluded.subject, snippet=excluded.snippet, last_message_at=excluded.last_message_at,
           message_count=excluded.message_count, unread=excluded.unread, starred=excluded.starred,
           has_attachments=excluded.has_attachments, participants=excluded.participants`
      ).run(t.id, t.accountId, t.remoteId, t.subject, t.snippet, t.lastMessageAt, t.messageCount,
        +t.unread, +t.starred, +t.hasAttachments, JSON.stringify(t.participants))
      this.db.prepare('DELETE FROM thread_labels WHERE thread_id = ?').run(t.id)
      for (const l of new Set(t.labelIds)) this.db.prepare('INSERT INTO thread_labels (thread_id, label_id) VALUES (?,?)').run(t.id, l)
      if (n.messages.length) {
        this.db.prepare('DELETE FROM messages WHERE thread_id = ?').run(t.id)
        const ins = this.db.prepare(
          `INSERT INTO messages (id, thread_id, account_id, remote_id, from_json, to_json, cc_json, bcc_json, reply_to_json, subject, date, snippet,
             body_html, body_text, attachments_json, unread, message_id_header, in_reply_to, refs_json, list_unsubscribe, label_ids_json, is_draft)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        for (const m of n.messages) {
          ins.run(m.id, t.id, m.accountId, m.remoteId, JSON.stringify(m.from), JSON.stringify(m.to), JSON.stringify(m.cc),
            JSON.stringify(m.bcc), m.replyTo ? JSON.stringify(m.replyTo) : null, m.subject, m.date, m.snippet,
            m.bodyHtml, m.bodyText, JSON.stringify(m.attachments), +m.unread, m.messageIdHeader ?? null, m.inReplyTo ?? null,
            m.references ? JSON.stringify(m.references) : null, m.listUnsubscribe ?? null, JSON.stringify(m.labelIds), +m.isDraft)
        }
      }
      this.reindex(t.id, t.subject, n.messages, t.participants)
    })
  }

  private reindex(threadId: string, subject: string, messages: Message[], participants: Address[]): void {
    this.db.prepare('DELETE FROM thread_fts WHERE thread_id = ?').run(threadId)
    let body = messages.map((m) => m.bodyText ?? stripHtml(m.bodyHtml ?? '') ?? m.snippet).join('\n')
    if (!body.trim()) body = ''
    this.db.prepare('INSERT INTO thread_fts (thread_id, subject, body, participants) VALUES (?,?,?,?)').run(
      threadId, subject, body.slice(0, 200_000), participants.map((p) => `${p.name ?? ''} ${p.email}`).join(' ')
    )
  }

  deleteThreadsByRemote(accountId: string, remoteIds: string[]): void {
    tx(this.db, () => {
      for (const rid of remoteIds) {
        const id = `${accountId}:${rid}`
        this.db.prepare('DELETE FROM thread_fts WHERE thread_id = ?').run(id)
        this.db.prepare('DELETE FROM messages WHERE thread_id = ?').run(id)
        this.db.prepare('DELETE FROM threads WHERE id = ?').run(id)
      }
    })
  }

  // ------------------------------------------------------------ threads (read)
  private rowToThread(r: Row, labelIds: string[]): Thread {
    return {
      id: r.id, accountId: r.account_id, remoteId: r.remote_id, subject: r.subject, snippet: r.snippet,
      lastMessageAt: r.last_message_at, messageCount: r.message_count, unread: !!r.unread, starred: !!r.starred,
      hasAttachments: !!r.has_attachments, labelIds, participants: j<Address[]>(r.participants, []),
      snoozedUntil: r.snoozed_until ?? null, reminderAt: r.reminder_at ?? null
    }
  }

  private labelsFor(threadIds: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>()
    if (!threadIds.length) return map
    for (let i = 0; i < threadIds.length; i += 500) {
      const chunk = threadIds.slice(i, i + 500)
      const rows = this.db.prepare(`SELECT thread_id, label_id FROM thread_labels WHERE thread_id IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as Row[]
      for (const r of rows) (map.get(r.thread_id) ?? map.set(r.thread_id, []).get(r.thread_id)!).push(r.label_id)
    }
    return map
  }

  private hydrate(rows: Row[]): Thread[] {
    const labels = this.labelsFor(rows.map((r) => r.id))
    return rows.map((r) => this.rowToThread(r, labels.get(r.id) ?? []))
  }

  getThread(id: string): ThreadWithMessages | null {
    const r = this.db.prepare('SELECT * FROM threads WHERE id = ?').get(id) as Row | undefined
    if (!r) return null
    const thread = this.hydrate([r])[0]
    const msgs = (this.db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY date').all(id) as Row[]).map(rowToMessage)
    return { ...thread, messages: msgs }
  }

  getThreadRow(id: string): Thread | null {
    const r = this.db.prepare('SELECT * FROM threads WHERE id = ?').get(id) as Row | undefined
    return r ? this.hydrate([r])[0] : null
  }

  /** Translate a ThreadFilter to a WHERE clause. Exposed for tests. */
  buildWhere(f: ThreadFilter, now = Date.now()): { where: string; params: SQLInputValue[] } {
    const w: string[] = []
    const p: SQLInputValue[] = []
    const roleExists = (role: SystemRole, negate = false): string =>
      `${negate ? 'NOT ' : ''}EXISTS (SELECT 1 FROM thread_labels tl JOIN labels l ON l.id = tl.label_id WHERE tl.thread_id = t.id AND l.role = '${role}')`

    if (f.accountIds?.length) { w.push(`t.account_id IN (${f.accountIds.map(() => '?').join(',')})`); p.push(...f.accountIds) }
    if (f.labelIds?.length) { w.push(`EXISTS (SELECT 1 FROM thread_labels tl WHERE tl.thread_id = t.id AND tl.label_id IN (${f.labelIds.map(() => '?').join(',')}))`); p.push(...f.labelIds) }

    switch (f.role) {
      case 'inbox': w.push(roleExists('inbox')); break
      case 'sent': w.push(roleExists('sent')); break
      case 'drafts': w.push(roleExists('drafts')); break
      case 'trash': w.push(roleExists('trash')); break
      case 'spam': w.push(roleExists('spam')); break
      case 'starred': w.push('t.starred = 1'); break
      case 'important': w.push(roleExists('important')); break
      case 'archive': w.push(roleExists('inbox', true), roleExists('trash', true), roleExists('spam', true), roleExists('drafts', true)); break
      default: break // 'all' / undefined
    }
    if (f.role !== 'trash' && f.role !== 'spam' && !f.text) {
      w.push(roleExists('trash', true), roleExists('spam', true))
    } else if (f.text && f.role !== 'trash' && f.role !== 'spam') {
      w.push(roleExists('trash', true), roleExists('spam', true))
    }

    if (f.unread !== undefined) w.push(`t.unread = ${f.unread ? 1 : 0}`)
    if (f.starred) w.push('t.starred = 1')
    if (f.hasAttachment) w.push('t.has_attachments = 1')
    if (f.after) { w.push('t.last_message_at >= ?'); p.push(f.after) }
    if (f.before) { w.push('t.last_message_at <= ?'); p.push(f.before) }
    for (const s of f.from ?? []) {
      w.push(`EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.id AND m.from_json LIKE ? ESCAPE '\\')`); p.push(`%${likeEsc(s)}%`)
    }
    for (const s of f.to ?? []) {
      w.push(`EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.id AND (m.to_json LIKE ? ESCAPE '\\' OR m.cc_json LIKE ? ESCAPE '\\'))`); p.push(`%${likeEsc(s)}%`, `%${likeEsc(s)}%`)
    }
    if (f.subjectContains?.length) {
      w.push('(' + f.subjectContains.map(() => `t.subject LIKE ? ESCAPE '\\'`).join(' OR ') + ')')
      p.push(...f.subjectContains.map((s) => `%${likeEsc(s)}%`))
    }
    if (f.text?.trim()) {
      w.push('t.id IN (SELECT thread_id FROM thread_fts WHERE thread_fts MATCH ?)')
      p.push(ftsQuery(f.text))
    }
    if (f.onlySnoozed) { w.push('t.snoozed_until IS NOT NULL AND t.snoozed_until > ?'); p.push(now) }
    else if (!f.includeSnoozed) { w.push('(t.snoozed_until IS NULL OR t.snoozed_until <= ?)'); p.push(now) }
    return { where: w.length ? 'WHERE ' + w.join(' AND ') : '', params: p }
  }

  listThreads(q: ThreadQuery): ThreadListResult {
    const { where, params } = this.buildWhere(q.filter)
    const total = (this.db.prepare(`SELECT COUNT(*) c FROM threads t ${where}`).get(...params) as Row).c as number
    const rows = this.db.prepare(`SELECT t.* FROM threads t ${where} ORDER BY t.last_message_at DESC LIMIT ? OFFSET ?`)
      .all(...params, q.limit ?? 100, q.offset ?? 0) as Row[]
    return { threads: this.hydrate(rows), total }
  }

  counts(): Counts {
    const unread: Record<string, number> = {}
    const rows = this.db.prepare(
      `SELECT t.account_id a, l.id lid, l.role role, COUNT(*) c
       FROM threads t JOIN thread_labels tl ON tl.thread_id = t.id JOIN labels l ON l.id = tl.label_id
       WHERE t.unread = 1 AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?)
       GROUP BY t.account_id, l.id`
    ).all(Date.now()) as Row[]
    for (const r of rows) {
      const bump = (k: string): void => { unread[k] = (unread[k] ?? 0) + r.c }
      bump(`${r.a}:${r.lid}`)
      if (r.role) { bump(`${r.a}:${r.role}`); bump(`all:${r.role}`) }
      bump(`all:${r.lid}`)
    }
    return { unread }
  }

  // ------------------------------------------------------------ optimistic local actions
  /**
   * Apply an action to local state immediately. Returns the threads touched so callers
   * can forward to the provider. Local-only actions (snooze/remind) are fully handled here.
   */
  applyLocal(threadIds: string[], action: ThreadAction): Thread[] {
    const touched: Thread[] = []
    tx(this.db, () => {
      for (const id of threadIds) {
        const t = this.getThreadRow(id)
        if (!t) continue
        const labels = this.labelsForAccount(t.accountId)
        const byRole = (role: SystemRole): Label | undefined => labels.find((l) => l.role === role)
        const add = (l?: Label): void => { if (l) this.db.prepare('INSERT OR IGNORE INTO thread_labels VALUES (?,?)').run(id, l.id) }
        const del = (l?: Label): void => { if (l) this.db.prepare('DELETE FROM thread_labels WHERE thread_id = ? AND label_id = ?').run(id, l.id) }
        switch (action.type) {
          case 'archive': del(byRole('inbox')); break
          case 'unarchive': add(byRole('inbox')); del(byRole('trash')); del(byRole('spam')); break
          case 'trash': add(byRole('trash')); del(byRole('inbox')); break
          case 'untrash': del(byRole('trash')); add(byRole('inbox')); break
          case 'spam': add(byRole('spam')); del(byRole('inbox')); break
          case 'notSpam': del(byRole('spam')); add(byRole('inbox')); break
          case 'markRead': this.setUnread(id, false); break
          case 'markUnread': this.setUnread(id, true); break
          case 'star': this.db.prepare('UPDATE threads SET starred = 1 WHERE id = ?').run(id); break
          case 'unstar': this.db.prepare('UPDATE threads SET starred = 0 WHERE id = ?').run(id); break
          case 'addLabel': this.db.prepare('INSERT OR IGNORE INTO thread_labels VALUES (?,?)').run(id, action.labelId); break
          case 'removeLabel': this.db.prepare('DELETE FROM thread_labels WHERE thread_id = ? AND label_id = ?').run(id, action.labelId); break
          case 'snooze': this.db.prepare('UPDATE threads SET snoozed_until = ? WHERE id = ?').run(action.until, id); break
          case 'unsnooze': this.db.prepare('UPDATE threads SET snoozed_until = NULL WHERE id = ?').run(id); break
          case 'remind': this.db.prepare('UPDATE threads SET reminder_at = ? WHERE id = ?').run(action.at, id); break
          case 'deleteForever':
            this.db.prepare('DELETE FROM thread_fts WHERE thread_id = ?').run(id)
            this.db.prepare('DELETE FROM messages WHERE thread_id = ?').run(id)
            this.db.prepare('DELETE FROM threads WHERE id = ?').run(id)
            break
        }
        touched.push(t)
      }
    })
    return touched
  }

  private setUnread(threadId: string, unread: boolean): void {
    this.db.prepare('UPDATE threads SET unread = ? WHERE id = ?').run(+unread, threadId)
    this.db.prepare('UPDATE messages SET unread = ? WHERE thread_id = ?').run(+unread, threadId)
  }

  /** Threads whose snooze elapsed: clear and return them (they resurface, marked unread). */
  wakeSnoozed(now = Date.now()): string[] {
    const rows = this.db.prepare('SELECT id FROM threads WHERE snoozed_until IS NOT NULL AND snoozed_until <= ?').all(now) as Row[]
    for (const r of rows) {
      this.db.prepare('UPDATE threads SET snoozed_until = NULL, unread = 1 WHERE id = ?').run(r.id)
    }
    return rows.map((r) => r.id as string)
  }

  // ------------------------------------------------------------ views
  listViews(): View[] {
    return (this.db.prepare('SELECT * FROM views ORDER BY position').all() as Row[]).map((r) => ({
      id: r.id, name: r.name, emoji: r.emoji ?? undefined, color: r.color ?? undefined,
      filter: j<ThreadFilter>(r.filter_json, {}), position: r.position,
      showInSidebar: !!r.show_in_sidebar, showAsTab: !!r.show_as_tab
    }))
  }
  saveView(v: View): View {
    this.db.prepare(
      `INSERT INTO views (id, name, emoji, color, filter_json, position, show_in_sidebar, show_as_tab) VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, emoji=excluded.emoji, color=excluded.color, filter_json=excluded.filter_json,
         position=excluded.position, show_in_sidebar=excluded.show_in_sidebar, show_as_tab=excluded.show_as_tab`
    ).run(v.id, v.name, v.emoji ?? null, v.color ?? null, JSON.stringify(v.filter), v.position, +v.showInSidebar, +v.showAsTab)
    return v
  }
  deleteView(id: string): void { this.db.prepare('DELETE FROM views WHERE id = ?').run(id) }

  // ------------------------------------------------------------ drafts / outbox / contacts
  saveDraft(d: Draft): void {
    this.db.prepare('INSERT INTO drafts (id, account_id, json, updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at, account_id=excluded.account_id')
      .run(d.id, d.accountId, JSON.stringify(d), d.updatedAt)
  }
  listDrafts(): Draft[] {
    return (this.db.prepare('SELECT json FROM drafts ORDER BY updated_at DESC').all() as Row[]).map((r) => JSON.parse(r.json))
  }
  getDraft(id: string): Draft | null {
    const r = this.db.prepare('SELECT json FROM drafts WHERE id = ?').get(id) as Row | undefined
    return r ? JSON.parse(r.json) : null
  }
  deleteDraft(id: string): void { this.db.prepare('DELETE FROM drafts WHERE id = ?').run(id) }

  saveScheduled(s: ScheduledSend): void {
    this.db.prepare('INSERT INTO scheduled_sends (id, json, send_at, status, error) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, error=excluded.error, json=excluded.json')
      .run(s.id, JSON.stringify(s.message), s.sendAt, s.status, s.error ?? null)
  }
  listScheduled(status?: ScheduledSend['status']): ScheduledSend[] {
    const rows = (status
      ? this.db.prepare('SELECT * FROM scheduled_sends WHERE status = ? ORDER BY send_at').all(status)
      : this.db.prepare('SELECT * FROM scheduled_sends ORDER BY send_at').all()) as Row[]
    return rows.map((r) => ({ id: r.id, message: JSON.parse(r.json), sendAt: r.send_at, status: r.status, error: r.error ?? undefined }))
  }

  bumpContacts(addrs: Address[]): void {
    const st = this.db.prepare(
      `INSERT INTO contacts (email, name, last_used_at, use_count) VALUES (?,?,?,1)
       ON CONFLICT(email) DO UPDATE SET name=COALESCE(excluded.name, contacts.name), last_used_at=excluded.last_used_at, use_count=contacts.use_count+1`
    )
    for (const a of addrs) if (a.email) st.run(a.email.toLowerCase(), a.name ?? null, Date.now())
  }
  suggestContacts(prefix: string, limit = 8): Contact[] {
    const q = `%${likeEsc(prefix.trim().toLowerCase())}%`
    return (this.db.prepare(
      `SELECT * FROM contacts WHERE email LIKE ? ESCAPE '\\' OR LOWER(COALESCE(name,'')) LIKE ? ESCAPE '\\'
       ORDER BY use_count DESC, last_used_at DESC LIMIT ?`
    ).all(q, q, limit) as Row[]).map((r) => ({ email: r.email, name: r.name ?? undefined, lastUsedAt: r.last_used_at, useCount: r.use_count }))
  }

  // ------------------------------------------------------------ settings (kv)
  getSettings(): AppSettings {
    const r = this.db.prepare("SELECT value FROM kv WHERE key = 'settings'").get() as Row | undefined
    const saved = r ? JSON.parse(r.value) : {}
    return { ...DEFAULT_SETTINGS, ...saved, oauth: { ...DEFAULT_SETTINGS.oauth, ...(saved.oauth ?? {}) } }
  }
  setSettings(patch: Partial<AppSettings>): AppSettings {
    const next = { ...this.getSettings(), ...patch, oauth: { ...this.getSettings().oauth, ...(patch.oauth ?? {}) } }
    this.db.prepare("INSERT INTO kv (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(next))
    return next
  }
  kvGet(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as Row | undefined
    return r?.value ?? null
  }
  kvSet(key: string, value: string): void {
    this.db.prepare('INSERT INTO kv (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }
}

function rowToMessage(r: Row): Message {
  return {
    id: r.id, threadId: r.thread_id, accountId: r.account_id, remoteId: r.remote_id,
    from: j<Address>(r.from_json, { email: '' }), to: j(r.to_json, []), cc: j(r.cc_json, []), bcc: j(r.bcc_json, []),
    replyTo: r.reply_to_json ? j<Address>(r.reply_to_json, { email: '' }) : undefined,
    subject: r.subject, date: r.date, snippet: r.snippet, bodyHtml: r.body_html, bodyText: r.body_text,
    attachments: j<Attachment[]>(r.attachments_json, []), unread: !!r.unread,
    messageIdHeader: r.message_id_header ?? undefined, inReplyTo: r.in_reply_to ?? undefined,
    references: r.refs_json ? j<string[]>(r.refs_json, []) : undefined, listUnsubscribe: r.list_unsubscribe ?? undefined,
    labelIds: j<string[]>(r.label_ids_json, []), isDraft: !!r.is_draft
  }
}

const likeEsc = (s: string): string => s.replace(/[\\%_]/g, (c) => '\\' + c)

/** User text -> safe FTS5 query: quoted prefix terms ANDed together. */
export function ftsQuery(text: string): string {
  const terms = text.trim().split(/\s+/).filter(Boolean).map((t) => `"${t.replace(/"/g, '""')}"*`)
  return terms.join(' ')
}

export function stripHtml(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim()
}
