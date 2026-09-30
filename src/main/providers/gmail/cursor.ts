/**
 * The opaque sync cursor persisted in `accounts.sync_cursor`.
 *
 *  - `backfill`: initial crawl in progress. `historyId` was read from users.getProfile BEFORE the first
 *    threads.list page so nothing that arrives during the (multi-call) crawl is missed.
 *  - `incremental`: caught up to `historyId`; `pending` holds thread ids still to be re-fetched when one
 *    history batch touched more threads than we hydrate per call.
 *
 *  - `categories`: per-category backfill (Social/Promotions/Updates/Forums inbox mail that the recency-ordered
 *    main crawl never reached). `step` indexes CATEGORY_STEPS in the adapter. Runs once after the initial
 *    backfill and once for accounts whose incremental cursor predates it (no `cat` flag) -- a migration that
 *    keeps all stored data. `pending` carries an interrupted incremental batch through it.
 *  - `incremental.cat`: set once the category backfill has run.
 *
 * A bare numeric string is accepted as a legacy `incremental` cursor.
 */
export type GmailCursor =
  | { v: 1; phase: 'backfill'; historyId: string; pageToken?: string; fetched: number; extras?: boolean }
  | { v: 1; phase: 'categories'; historyId: string; step: number; pageToken?: string; fetched: number; pending?: string[] }
  | { v: 1; phase: 'incremental'; historyId: string; pending?: string[]; cat?: boolean }

export function encodeCursor(c: GmailCursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url')
}

export function decodeCursor(s: string | null): GmailCursor | null {
  if (!s) return null
  if (/^\d+$/.test(s)) return { v: 1, phase: 'incremental', historyId: s }
  try {
    const c = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as GmailCursor
    if (c && c.v === 1 && (c.phase === 'backfill' || c.phase === 'incremental' || c.phase === 'categories') && typeof c.historyId === 'string') return c
  } catch { /* fall through */ }
  return null // unrecognised cursor => caller starts over
}
