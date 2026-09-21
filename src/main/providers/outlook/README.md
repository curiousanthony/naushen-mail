# Outlook / Microsoft 365 provider (Microsoft Graph)

Plain-`fetch` adapter implementing `ProviderAdapter` (`../types.ts`). No SDK, no backend, no client secret (public client + PKCE).

| File | Role |
|---|---|
| `register.ts` | `connectors.outlook = { connect, restore, forget }`; builds the token source and adapter for an account |
| `auth.ts` | Sign-in (system browser, loopback `http://localhost:<port>`, PKCE), refresh, `GET /me` profile, `TokenSource` on top of `ensureAccessToken` |
| `graph.ts` | HTTP client: bearer auth, `Prefer: IdType="ImmutableId"` on every request, 4-way concurrency cap, `Retry-After` retries (429/503/504), 401 refresh-and-retry, non-Graph link guard |
| `adapter.ts` | `OutlookAdapter`: labels, sync (backfill + delta), actions, send/drafts, attachments, categories |
| `mapping.ts` | Pure functions: folder -> role, category colours, message/thread normalisation |

## Sign-in
Client id comes from Settings → Accounts → OAuth setup (`oauth.microsoftClientId`); a missing id raises a friendly error.
Authority `common`, scopes `openid profile email offline_access User.Read Mail.ReadWrite Mail.Send MailboxSettings.ReadWrite`.
The redirect is registered as `http://localhost` (Entra ignores the port). Token calls use Node's `fetch`, which sends no `Origin`
header — required, otherwise Entra treats the client as a SPA (AADSTS9002327). Refresh tokens rotate: the new one is persisted
before the access token is used. `invalid_grant` / `interaction_required` flag the account `reauth` and stop further requests
until the user reconnects (re-running "Connect" for the same mailbox reuses the account id `outlook-<slug of email>`).

## Model mapping
* **Thread = Graph `conversationId`** (Graph has no thread endpoint). `Thread.remoteId` = conversationId, `Message.remoteId` = Graph message id
  (immutable ids, so moving a message between folders keeps its id and our local primary keys).
* **System labels** (remote id = well-known folder name): `inbox`→inbox, `sentitems`→sent, `drafts`→drafts, `deleteditems`→trash, `junkemail`→spam, `archive`→archive.
  A thread carries the union of the roles of its *live* messages. Messages in Deleted Items / Junk are dropped from a conversation
  that still has live messages (otherwise the store's Inbox filter would hide the whole thread); a conversation whose messages are all trashed/junked gets only the trash/spam label.
* **User labels = Outlook categories** (`masterCategories`), remote id `cat:<displayName>`. Colours: `preset0..24` → our 9 colours
  (`mapping.ts` table); our colour → `preset0/1/2/3/4/7/8/9/12`. Categories on a message that are not in the master list are ignored.
* **User-created mail folders are not exposed** (decision): messages living in a custom folder get no role label, so they show up as "archive" in the store. Folders are a filing concept Notion-Mail-style labels/views replace with categories.
* `flag.flagStatus == flagged` → starred; `!isRead` → unread; `bodyPreview` → snippet. Bodies are requested as HTML (`Prefer: outlook.body-content-type="html"`).
* Attachments: `$expand=attachments($select=id,name,contentType,size,isInline,contentId)` (metadata only; bytes via `fetchAttachment` → `/$value`, base64 fallback).

## Sync
Cursor = base64url JSON `{ phase, next?, cutoff?, todo?, pending?, links: { <folder>: deltaLink } }`.
1. **backfill** — pages `GET /me/messages?$select=id,conversationId,receivedDateTime,parentFolderId&$orderby=receivedDateTime desc&$top=50`
   (light) until ~1000 messages; each *new* conversation is fetched whole (`$filter=conversationId eq '…'`, bodies + attachments + headers, bounded concurrency 4, deduped across pages) and returned as one thread.
2. **baseline** — one folder per page: `/mailFolders/{inbox|sentitems|drafts|deleteditems|junkemail|archive}/messages/delta?$select=id,conversationId`
   (filtered to `receivedDateTime ge <oldest backfilled>` when the backfill was truncated) to obtain each `deltaLink`. Messages that were not seen during the backfill
   (arrived in the gap) get their conversation pulled, so nothing is lost between the two phases.
3. **delta** — one folder per page (a round = 6 pages, the engine loops while `hasMore`): follow the stored deltaLink, collect the conversations of updated ids and of `@removed` ids
   (removed items only carry an id → resolved through the local store via `lookupConversation`, then an in-memory cache, then `GET /me/messages/{id}`; a 404 means it never reached us), then re-fetch each
   affected conversation and rebuild its `NormalizedThread`. A conversation that no longer has any message is returned in `deletedRemoteThreadIds`.
4. HTTP 410 / `syncStateNotFound` / `resyncRequired` (or an unreadable cursor) → `{ reset: true, cursor: null, hasMore: true }`, and the engine restarts the backfill.

`internetMessageHeaders` are included in conversation fetches (deviation from "on demand"): the reader only calls `fetchThread` when bodies are missing, so
fetching headers lazily would mean `List-Unsubscribe` / `In-Reply-To` never reach the store.

## Actions (Graph acts per message → applied to the whole conversation)
| Action | Graph |
|---|---|
| archive | `POST /messages/{id}/move {destinationId:"archive"}` for messages in the Inbox (Sent stays put); creates an `Archive` folder if the mailbox has none |
| unarchive / untrash / notSpam | move back: mine → `sentitems`, drafts → `drafts`, others → `inbox` |
| trash / spam | move every message not already there to `deleteditems` / `junkemail` |
| markRead / markUnread | `PATCH {isRead}` only on messages that differ |
| star / unstar | `PATCH {flag:{flagStatus}}`: star flags the **newest** message only, unstar clears every flagged one |
| addLabel / removeLabel | `PATCH {categories:[…]}` read-modify-write per message |
| deleteForever | `DELETE /messages/{id}` per message |
| snooze / remind | local only, never sent |

Categories: create/recolour are direct; Graph cannot rename, so `updateLabel({name})` creates the new category, re-tags every message that had the old one, then deletes the old one.

## Send
* New mail: `POST /me/sendMail` (HTML body, `fileAttachment` base64, inline images `isInline` + `contentId`), `saveToSentItems: true`.
* Reply / reply-all / forward: `createReply|createReplyAll|createForward` → `PATCH` body + recipients (+ attachments) → `POST /send`. If the composer HTML already contains its own quote
  (`<blockquote type="cite">`) it is used as-is, otherwise the new text is inserted above Graph's quote. A failed send deletes the stray draft.
* Attachments ≥ 3 MB (or > 3 MB total) use a draft + `createUploadSession` and chunked `PUT`s (the upload URL carries its own token, so no bearer header is sent).
* Drafts: `POST /me/messages` / `PATCH` (attachments reconciled by name); `deleteDraft` ignores 404.

## Known limits
* Only the six well-known folders are delta-synced; a change made inside a custom folder is seen only when the conversation is refreshed for another reason.
* Graph deltas are per folder and there is no push (polling only, via the sync engine's 60 s timer).
* The reauth state is set on the account by the adapter, but `SyncEngine.syncAccount` then overwrites it with `error` (message text is still the reconnect hint).
* Tests never touch the network (`tests/main/outlook/`, mocked `fetch`).
