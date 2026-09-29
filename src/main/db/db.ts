import { DatabaseSync } from 'node:sqlite'

export type DB = DatabaseSync

const SCHEMA_VERSION = 2

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL,
  color TEXT NOT NULL, avatar_url TEXT, created_at INTEGER NOT NULL, sync_cursor TEXT, last_sync_at INTEGER,
  status TEXT NOT NULL DEFAULT 'ok', status_message TEXT
);
CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  remote_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT, kind TEXT NOT NULL, role TEXT
);
CREATE INDEX IF NOT EXISTS idx_labels_account ON labels(account_id);
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  remote_id TEXT NOT NULL, subject TEXT NOT NULL, snippet TEXT NOT NULL,
  last_message_at INTEGER NOT NULL, message_count INTEGER NOT NULL,
  unread INTEGER NOT NULL, starred INTEGER NOT NULL, has_attachments INTEGER NOT NULL,
  participants TEXT NOT NULL, snoozed_until INTEGER, reminder_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_threads_last ON threads(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_account ON threads(account_id, last_message_at DESC);
CREATE TABLE IF NOT EXISTS thread_labels (
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL, PRIMARY KEY (thread_id, label_id)
);
CREATE INDEX IF NOT EXISTS idx_thread_labels_label ON thread_labels(label_id);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL, remote_id TEXT NOT NULL,
  from_json TEXT NOT NULL, to_json TEXT NOT NULL, cc_json TEXT NOT NULL, bcc_json TEXT NOT NULL,
  reply_to_json TEXT, subject TEXT NOT NULL, date INTEGER NOT NULL, snippet TEXT NOT NULL,
  body_html TEXT, body_text TEXT, attachments_json TEXT NOT NULL, unread INTEGER NOT NULL,
  message_id_header TEXT, in_reply_to TEXT, refs_json TEXT, list_unsubscribe TEXT,
  label_ids_json TEXT NOT NULL, is_draft INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, date);
CREATE VIRTUAL TABLE IF NOT EXISTS thread_fts USING fts5(
  thread_id UNINDEXED, subject, body, participants, tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TABLE IF NOT EXISTS views (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, emoji TEXT, color TEXT, filter_json TEXT NOT NULL,
  position INTEGER NOT NULL, show_in_sidebar INTEGER NOT NULL DEFAULT 1, show_as_tab INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, json TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS scheduled_sends (
  id TEXT PRIMARY KEY, json TEXT NOT NULL, send_at INTEGER NOT NULL,
  status TEXT NOT NULL, error TEXT
);
CREATE TABLE IF NOT EXISTS contacts (
  email TEXT PRIMARY KEY, name TEXT, last_used_at INTEGER NOT NULL, use_count INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

/** Per-version migrations, applied in order after SCHEMA (which only CREATEs missing tables). */
const MIGRATIONS: Record<number, (db: DB) => void> = {
  2: (db) => {
    const cols = db.prepare('PRAGMA table_info(accounts)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'avatar_url')) db.exec('ALTER TABLE accounts ADD COLUMN avatar_url TEXT')
  }
}

export function openDb(path: string): DB {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;')
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (row.user_version < SCHEMA_VERSION) {
    db.exec(SCHEMA)
    for (let v = row.user_version + 1; v <= SCHEMA_VERSION; v++) MIGRATIONS[v]?.(db)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  }
  return db
}

/** Run fn inside a transaction (node:sqlite has no helper). */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
