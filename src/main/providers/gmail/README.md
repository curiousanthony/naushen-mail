# Gmail provider

Plain-`fetch` implementation of `ProviderAdapter` for Gmail (REST v1, scope `gmail.modify`). No Google SDK.

## Files
| File | Role |
|---|---|
| `register.ts` | Registers `connectors.gmail` (`connect` / `restore` / `forget`). The only file importing Electron-side modules (`oauth.ts`, `tokens.ts`). |
| `adapter.ts` | `GmailAdapter`: labels, sync, actions, send/drafts, attachments. |
| `http.ts` | One HTTP client: bearer auth, retry/backoff (429, 5xx, rate-limit 403, network), `Retry-After`, one forced refresh on 401, multipart upload, `pool()` for bounded concurrency. |
| `auth.ts` | Pure OAuth helpers (auth URL, code exchange, refresh, userinfo, revoke, account-id slug). |
| `normalize.ts` | MIME payload tree -> `Message` / `NormalizedThread` (pure). |
| `text.ts` | Charsets, RFC 2047 words, RFC 2231 params, address lists, HTML -> text, entity decoding. |
| `labels.ts` | System-label roles, Gmail palette <-> our 9 `LabelColor`s, local<->remote label ids. |
| `cursor.ts`, `history.ts` | Sync cursor encoding; `history.list` diffing. |
| `mime.ts` | Outgoing RFC 5322 (`buildRaw`) on `nodemailer/lib/mail-composer`. Injected into the adapter via `opts.buildRaw`, so `src/main/mime` from `feat/compose-blocks` can replace it. |

## Connect flow
Loopback (127.0.0.1) + PKCE, `access_type=offline`, `prompt=consent`, client secret included (Desktop clients require it).
Client id/secret come from Settings -> Accounts -> OAuth setup (`repo.getSettings().oauth`); a friendly error is thrown if missing.
Connect fails clearly if Google returns no refresh token or the user un-ticked the `gmail.modify` permission (granular consent).
Account id is `gmail-<email slug>-<6 hex of sha1>` (no `:`). Tokens go through `auth/tokens.ts` (safeStorage). Removing the account also revokes the grant at Google (best effort).

## Sync
`sync(cursor)` cursor is opaque base64url JSON (`cursor.ts`):
1. **null** -> `GET /profile` first (its `historyId` is where incremental resumes, so mail arriving during the crawl is not lost), then `threads.list` pages of 100 (cap 500 newest), each thread hydrated with `threads.get?format=full`, concurrency 5. Pages continue across calls via `{phase:'backfill', pageToken, historyId, fetched}`. A last call pulls 25 recent Trash + 25 Spam threads (not in the default listing) so those mailboxes are not empty, then the cursor flips to `incremental`.
2. **incremental** -> `history.list` (messageAdded/Deleted, labelAdded/Removed), affected thread ids are re-fetched (never replayed as deltas, so no drift). 404 on threads.get => deleted. Up to 100 threads per call; the remainder rides in the cursor (`pending`) with `hasMore: true`.
3. **Expired historyId (HTTP 404)**, an unrecognised cursor, or > 1000 affected threads => `reset: true` + first backfill page + `hasMore: true` (the engine wipes local mail, then the crawl refills it).

Normalisation notes: Gmail keeps trashed/spam messages inside live conversations but hides them; so do we (a thread is only Trash/Spam when all its messages are). `UNREAD`, `CHAT`, `CATEGORY_*` are excluded from both `listLabels()` and `labelIds` so the store's label pruning stays consistent. `STARRED` is both a label (role `starred`) and `thread.starred`. Attachment ids are `<partId>:<gmail attachmentId>` so a stale attachmentId can be re-resolved through the stable part id. Inline (`cid:`) resources the HTML never references are downgraded to normal attachments.

## Actions
archive = remove INBOX; unarchive = add INBOX, remove TRASH/SPAM; trash = `threads.trash`; untrash = `threads.untrash` + add INBOX (matches the local model); spam / notSpam; read/unread = `UNREAD`; star = `STARRED`; add/removeLabel (local label id -> Gmail id via `ctx.labels`); snooze/remind never reach the network.

**deleteForever**: `threads.delete` requires the full `https://mail.google.com/` scope, which we deliberately do not request (see `docs/research/02`). We try it and, on 403, fall back to `threads.trash` (Gmail purges Trash after 30 days) instead of failing.

## Sending
`buildRaw` -> base64url -> `messages.send` (`drafts.send` after replacing the draft when `draftId` is set). Replies set `threadId` and copy `Message-ID` / `References` from the parent (fetched with `messages.get?format=metadata`, ids derived from the local `accountId:remoteId`), so other clients thread correctly. Forwards start a new thread. Raw messages > 3 MB use the `uploadType=multipart` endpoint. `Bcc` is kept in the raw message (Gmail strips it on delivery).

## Known limits
* Sync status: the engine overwrites `status:'reauth'` (set by `markReauthNeeded`) with `'error'` when the sync call throws. The error message still tells the user to sign in again.
* Only the newest ~500 threads are backfilled; older mail is not fetched (no provider-side search yet).
* Push (`users.watch`) needs Pub/Sub, so polling via the engine's interval is used.
