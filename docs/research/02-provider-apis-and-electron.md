# 02 - Provider APIs (Gmail, Microsoft Graph) and Electron/macOS Implementation Guide

Scope: single-user, personal-use Electron macOS mail client, no backend server. Gmail + Outlook/Microsoft accounts.
Researched: 2026-09-21. Confidence notes are inline where something could not be confirmed from primary docs ("VERIFY").

Host machine: Apple Silicon (arm64). All packaging advice below assumes an arm64-only build.

---

## 0. User setup checklist (do this first, click by click)

### 0.1 Google Cloud Console (Gmail)

Console UI note: OAuth consent settings now live under "Google Auth Platform" (tabs: Overview, Branding, Audience, Clients, Data Access), not the old "APIs & Services > OAuth consent screen".

1. Open https://console.cloud.google.com and sign in with the Google account you will use as owner.
2. Top bar project picker > **New Project** > name `NotionMailClone` > **Create**. Make sure it is the selected project.
3. Left menu (hamburger) > **APIs & Services > Library** > search **Gmail API** > **Enable**.
4. Left menu > **Google Auth Platform** > **Get started** (first-time wizard):
   - App information: App name `NotionMailClone`, User support email = your email > Next.
   - Audience: choose **External** > Next. (Internal only exists for Google Workspace orgs.)
   - Contact information: your email > Next > accept the User Data Policy > **Continue** > **Create**.
5. **Data Access** tab > **Add or remove scopes**. Tick (use the filter box, or paste under "Manually add scopes"):
   - `https://www.googleapis.com/auth/gmail.modify`
   - `openid`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
   Then **Update** > **Save**. (Do not add `gmail.send`, `gmail.labels`, or contacts scopes; see section 1.2.)
6. **Audience** tab > **Test users** > **Add users** > enter every Gmail address you will connect (up to 100) > **Save**.
7. Still in **Audience**: click **Publish app** > **Confirm**. Publishing status becomes **In production**. Do NOT submit for verification. This removes the Testing-mode 7-day refresh-token expiry (see 1.3). Tokens will be issued for an "unverified app" and the consent screen shows a warning you click through once.
8. **Clients** tab > **Create client** > Application type **Desktop app** > Name `NotionMailClone desktop` > **Create**. Copy the **Client ID** and **Client secret** (or **Download JSON**). Put both in the app's config; for Desktop clients Google treats the secret as non-confidential.
9. First sign-in inside the app: system browser opens > pick account > "Google hasn't verified this app" > **Advanced** > **Go to NotionMailClone (unsafe)** > tick all checkboxes > **Continue**.

### 0.2 Microsoft Entra / Azure (Outlook, Hotmail, Microsoft 365)

1. Open https://entra.microsoft.com (or https://portal.azure.com) and sign in with a Microsoft account. A personal account gets an auto-created default directory; an Azure subscription is not needed in practice (docs list one as a prerequisite; VERIFY if the portal blocks you, then create a free Azure account).
2. **Entra ID > App registrations > New registration**.
3. Name `NotionMailClone`. **Supported account types**: **Any Entra ID Tenant + Personal Microsoft accounts** (older wording: "Accounts in any organizational directory and personal Microsoft accounts").
4. **Redirect URI**: platform dropdown **Public client/native (mobile & desktop)**, value `http://localhost` (no port, no path). Click **Register**.
5. On **Overview**, copy **Application (client) ID**. (Directory ID is not needed; use the `common` authority.)
6. **Authentication** > confirm the "Mobile and desktop applications" platform lists `http://localhost` > **Settings** tab > **Allow public client flows = Yes** > **Save**.
7. **API permissions > Add a permission > Microsoft Graph > Delegated permissions**; add: `Mail.ReadWrite`, `Mail.Send`, `MailboxSettings.ReadWrite`, `User.Read` (already present), `offline_access`, `openid`, `profile`, `email` > **Add permissions**. No admin consent is needed for personal accounts (all listed permissions are marked personal-account-capable in the Graph permissions reference).
8. Do NOT create a client secret. Do not add Web or SPA platforms (SPA-type redirect makes refresh tokens expire in 24h and forces cross-origin-only redemption).
9. Optional hardening: **Manifest** > add `"http://127.0.0.1"` to the public client redirect URIs (the portal text box rejects http loopback IP literals; only the manifest accepts them). Microsoft recommends 127.0.0.1 over localhost.
10. First sign-in in the app: system browser > account > consent screen listing the permissions > **Accept**.

Caveat: if you later sign in with a work/school account from a *different* tenant than the one holding the registration, an unverified-publisher multitenant app may require admin consent for Mail.* scopes. Personal accounts and your home tenant are not affected. (Medium confidence; from Entra consent policy, not re-verified this session.)

---

## 1. Gmail

### 1.1 OAuth 2.0 for desktop apps (loopback + PKCE)

Endpoints (verified against Google's native-app OAuth doc):

| Purpose | URL |
|---|---|
| Authorize | `https://accounts.google.com/o/oauth2/v2/auth` |
| Token / refresh | `https://oauth2.googleapis.com/token` |
| Revoke | `https://oauth2.googleapis.com/revoke` |
| Userinfo | `https://openidconnect.googleapis.com/v1/userinfo` |

Flow:

1. Generate `code_verifier` (43-128 chars from `[A-Za-z0-9-._~]`; use `crypto.randomBytes(32).toString('base64url')`), `code_challenge = base64url(sha256(verifier))`, and random `state`.
2. Start a one-shot HTTP server on `127.0.0.1:0` (ephemeral port). Redirect URI = `http://127.0.0.1:${port}` (Desktop-app clients need no pre-registered redirect URI; any loopback port works).
3. `shell.openExternal()` this URL (system browser only; Google blocks embedded webviews with `disallowed_useragent`):

```
https://accounts.google.com/o/oauth2/v2/auth
  ?client_id=CLIENT_ID
  &redirect_uri=http%3A%2F%2F127.0.0.1%3A54321
  &response_type=code
  &scope=openid%20email%20profile%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.modify
  &code_challenge=CHALLENGE
  &code_challenge_method=S256
  &state=STATE
  &access_type=offline
  &prompt=consent
```

`access_type=offline` + `prompt=consent` guarantees a `refresh_token` is returned (otherwise Google only returns it on the first-ever consent).

4. Loopback receives `GET /?code=...&state=...`; check `state`; reply with a small "You can close this tab" HTML page; close the server; enforce a 5 minute timeout.
5. Exchange the code:

```
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

client_id=...&client_secret=...&code=...&code_verifier=...&redirect_uri=http://127.0.0.1:54321&grant_type=authorization_code
```

Response:

```json
{
  "access_token": "ya29....",
  "expires_in": 3599,
  "refresh_token": "1//0g...",
  "scope": "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/gmail.modify",
  "token_type": "Bearer",
  "id_token": "eyJ..."
}
```

**client_secret for Desktop-app clients: include it.** Google's doc says the secret is "not applicable" only to Android/iOS/Chrome-app clients; Desktop-type clients are issued a secret and the token endpoint commonly rejects PKCE-only exchanges with `client_secret is missing`. The secret is embedded in the app and is not confidential (RFC 8252). PKCE is still required practice.

6. Refresh (response contains a new `access_token` and `expires_in`, but NOT a new refresh_token; keep the old one):

```
POST https://oauth2.googleapis.com/token
client_id=...&client_secret=...&refresh_token=...&grant_type=refresh_token
```

7. Identify the account: decode `id_token` (claims `email`, `sub`, `name`, `picture`) or `GET /v1/userinfo`. Key accounts by `sub`/email.

Refresh-token invalidation cases (handle `error: "invalid_grant"` by prompting re-auth, not by crashing): user revokes at myaccount.google.com/permissions; Testing-mode 7 days; password change for tokens with Gmail scopes; 6 months of non-use; more than 100 outstanding refresh tokens per (account, client) - oldest is silently invalidated (do not re-run consent repeatedly in dev).

### 1.2 Scopes

| Scope | Class | Needed? |
|---|---|---|
| `https://www.googleapis.com/auth/gmail.modify` | Restricted | Yes. Read, compose, send, drafts, threads, labels CRUD, trash/untrash; excludes permanent delete. Covers everything below. |
| `https://www.googleapis.com/auth/gmail.send` | Sensitive | Redundant, verified on the `users.messages.send` reference page: it accepts any of `mail.google.com`, `gmail.modify`, `gmail.compose`, `gmail.send`. Omit (adding it is harmless if you prefer a belt-and-braces scope list, since `gmail.modify` is already restricted). |
| `https://www.googleapis.com/auth/gmail.labels` | Non-sensitive | Redundant: labels.* accepts `gmail.modify`. Omit. |
| `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` | Basic | Yes (account identity, avatar). |
| `https://mail.google.com/` | Restricted | No. Only required for permanent delete (`messages.delete`, `batchDelete`, `threads.delete`). Use trash instead. |
| Contacts (`contacts.readonly`, `contacts.other.readonly`) | Sensitive | Omit. Build autocomplete from synced From/To/Cc headers in SQLite. Fewer scopes = simpler consent. |

### 1.3 Testing mode, 7-day expiry, and the fix

Facts (Google Auth Platform Help, "Manage App Audience"):

- Publishing status **Testing**: max 100 test users; authorizations by test users, including refresh tokens, **expire 7 days after consent** (exception only for basic name/email/profile scopes). Gmail scopes do not qualify, so a Testing-mode Gmail client forces re-login weekly.
- Publishing status **In production** but **unverified** and requesting sensitive/restricted scopes: the "unverified app" warning shows, and a **lifetime cap of 100 users** applies. The 7-day expiry does not apply.

Recommendation for single-user personal use: **Audience > Publish app (In production) and never submit for verification.** One user is far under the 100 cap. You click through "Advanced > Go to app (unsafe)" once per account. Verification of `gmail.modify` (restricted) would require a CASA third-party security assessment, which is not worth it.

Confidence: the two rules above are from Google's docs; that an unverified in-production app with a restricted scope still authorizes for the project owner/any user under the cap is consistent with the doc's wording and widely reported, but confirm on first login. Fallback if it were blocked: stay in Testing and treat `invalid_grant` as "re-login weekly" (build the re-auth UX anyway).

### 1.4 Gmail REST surface

Base: `https://gmail.googleapis.com/gmail/v1/users/me` (all calls `Authorization: Bearer <access_token>`).

**System label IDs**: `INBOX, SENT, DRAFT, TRASH, SPAM, STARRED, UNREAD, IMPORTANT, CHAT, CATEGORY_PERSONAL, CATEGORY_SOCIAL, CATEGORY_PROMOTIONS, CATEGORY_UPDATES, CATEGORY_FORUMS`. User labels have opaque IDs like `Label_123`.

**List threads**

```
GET /threads?labelIds=INBOX&q=is:unread%20newer_than:30d&maxResults=50&pageToken=...&includeSpamTrash=false
```
```json
{ "threads": [ { "id": "18c...", "snippet": "...", "historyId": "123456" } ],
  "nextPageToken": "...", "resultSizeEstimate": 201 }
```
`q` uses the Gmail search-box syntax (`from:`, `has:attachment`, `is:starred`, `label:x`, `after:`), so provider-side search maps 1:1. Multiple `labelIds` are ANDed. The list gives only id/snippet/historyId; you need `threads.get` for headers.

**Get thread**

```
GET /threads/{id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date   (list rows)
GET /threads/{id}?format=full                                                                                          (open thread)
```
Formats: `minimal` (ids + labels), `metadata` (+ headers), `full` (parsed `payload`). Response:

```json
{ "id": "18c...", "historyId": "123456",
  "messages": [ { "id": "18c...", "threadId": "18c...", "labelIds": ["INBOX","UNREAD"],
                  "snippet": "...", "historyId": "123", "internalDate": "1726900000000",
                  "sizeEstimate": 4213, "payload": { /* MessagePart */ } } ] }
```
Messages are in chronological order.

**Modify labels (the primitive behind archive/star/read)**

```
POST /threads/{id}/modify        {"addLabelIds": [...], "removeLabelIds": [...]}   (<=100 label ids each; returns Thread)
POST /messages/{id}/modify       same body; returns Message
POST /messages/batchModify       {"ids": ["..."], "addLabelIds": [...], "removeLabelIds": [...]}   (<=1000 ids; empty 200 body)
```
Because the UI is thread-centric, use **threads.modify** for thread actions and `batchModify` for multi-select of individual messages.

| UI action | Call |
|---|---|
| Archive | remove `INBOX` |
| Unarchive / move to inbox | add `INBOX` |
| Star / unstar | add/remove `STARRED` |
| Mark unread / read | add/remove `UNREAD` |
| Mark spam | add `SPAM`, remove `INBOX` |
| Trash / untrash | `POST /threads/{id}/trash`, `POST /threads/{id}/untrash` (or add `TRASH`); no permanent delete |
| Apply custom label | add label id |

**Drafts**

```
POST   /drafts            {"message": {"raw": "<base64url RFC822>", "threadId": "optional"}}   -> {"id":"r-123","message":{"id":"...","threadId":"..."}}
PUT    /drafts/{id}       {"id":"r-123","message":{"raw":"..."}}    // replaces content; message id changes, draft id stays
POST   /drafts/send       {"id":"r-123"}                            // sends and removes the draft
DELETE /drafts/{id}
GET    /drafts?maxResults=..&pageToken=..   |   GET /drafts/{id}?format=full
```

**Send**

```
POST /messages/send   {"raw": "<base64url RFC822>", "threadId": "18c..."}
```
`raw` = base64url (no padding required) of the full RFC 5322 message. To keep a reply in the thread you need BOTH the `threadId` and `In-Reply-To`/`References` headers (and a matching Subject). Gmail stores the message in SENT automatically. Large messages (>~5 MB): `POST https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart` (or `resumable`) with `Content-Type: message/rfc822`; hard cap about 35 MB, 25 MB attachments recommended.
With MailComposer, set `keepBcc: true` on the compiled node; Gmail strips the Bcc header on delivery but needs it in the raw message to know recipients.

**Attachments**

```
GET /messages/{messageId}/attachments/{attachmentId}
```
```json
{ "size": 102400, "data": "<base64url bytes>" }
```
`attachmentId` comes from `payload...body.attachmentId`; treat it as short-lived (re-fetch the message to get a fresh id if you get 404). Convert with `Buffer.from(data, 'base64url')`.

**Labels**

```
GET    /labels
POST   /labels        {"name":"Clients/Acme","labelListVisibility":"labelShow","messageListVisibility":"show",
                       "color":{"textColor":"#ffffff","backgroundColor":"#16a765"}}
PATCH  /labels/{id}   partial update (name, visibility, color)
DELETE /labels/{id}
```
`type` is `system` or `user`. Colors must come from Gmail's fixed palette (~100 hex pairs) or the API returns 400. Nested labels are just names with `/`. Max 10,000 labels.

**Message resource / MIME payload**

```json
"payload": {
  "partId": "", "mimeType": "multipart/alternative", "filename": "",
  "headers": [ {"name":"From","value":"A <a@x.com>"}, {"name":"Subject","value":"..."},
               {"name":"Message-ID","value":"<...>"}, {"name":"References","value":"<...>"},
               {"name":"List-Unsubscribe","value":"<mailto:...>"} ],
  "body": { "size": 0 },
  "parts": [
    { "partId":"0", "mimeType":"text/plain", "filename":"", "headers":[...], "body":{"size":120,"data":"<base64url>"} },
    { "partId":"1", "mimeType":"text/html",  "filename":"", "headers":[...], "body":{"size":900,"data":"<base64url>"} },
    { "partId":"2", "mimeType":"image/png",  "filename":"logo.png",
      "headers":[{"name":"Content-ID","value":"<logo123>"},{"name":"Content-Disposition","value":"inline; filename=\"logo.png\""}],
      "body":{"size":5421,"attachmentId":"ANGjdJ..."} } ] }
```
Walk rules: (1) recurse `parts`; (2) `multipart/alternative`: prefer `text/html`, keep `text/plain` as fallback; (3) `multipart/related`: root html + inline images referenced by `cid:`; (4) any part with `body.attachmentId` (or non-empty `filename`) is an attachment or inline image; small parts may have `body.data` inline; (5) `body.data` is base64url of the transfer-decoded bytes; decode charset from the part's `Content-Type` header parameter with `new TextDecoder(charset)` (fall back to utf-8 / windows-1252); (6) `Content-Disposition: inline` + `Content-ID` = inline image, `attachment` = downloadable file. No inbound MIME parser is needed.

### 1.5 Incremental sync (`history.list`)

Initial sync: call `GET /profile` **first** and store its `historyId` (so nothing arriving during the crawl is missed), then page `threads.list` (e.g. INBOX, last N days) and `threads.get?format=metadata`.

Incremental:

```
GET /history?startHistoryId=123456&historyTypes=messageAdded&historyTypes=messageDeleted&historyTypes=labelAdded&historyTypes=labelRemoved&maxResults=500&pageToken=...
```
```json
{ "history": [ { "id": "123457",
      "messages": [ {"id":"m1","threadId":"t1"} ],
      "messagesAdded":   [ {"message": {"id":"m1","threadId":"t1","labelIds":["INBOX","UNREAD"]}} ],
      "messagesDeleted": [ {"message": {"id":"m2","threadId":"t2"}} ],
      "labelsAdded":     [ {"message": {"id":"m3","threadId":"t3","labelIds":["INBOX","STARRED"]}, "labelIds": ["STARRED"]} ],
      "labelsRemoved":   [ {"message": {"id":"m3","threadId":"t3","labelIds":["INBOX"]}, "labelIds": ["UNREAD"]} ] } ],
  "historyId": "123999", "nextPageToken": "..." }
```
Records are in increasing id order and contain only ids/threadIds/labelIds. Strategy: collect the set of affected `threadId`s from all record kinds, re-fetch those threads (`format=metadata`, or `full` for the open thread), upsert, then store the response's top-level `historyId` as the new cursor. **HTTP 404 = startHistoryId too old** (history is kept "at least a week", often longer): fall back to a full resync. Poll every 30-60 s while focused (history.list costs 2 quota units). Push via `users.watch` requires Cloud Pub/Sub and a public endpoint, so it does not fit a no-backend app.

### 1.6 Batch, quota, rate limits

- Batch endpoint: `POST https://gmail.googleapis.com/batch/gmail/v1` with `Content-Type: multipart/mixed; boundary=...`, each part `Content-Type: application/http` containing a full sub-request; max 100 per batch, Google recommends <=50; **each sub-request counts individually against quota**. For Node, a bounded-concurrency `fetch` pool (6-10 in flight) plus `batchModify` (1000 ids) is simpler than hand-rolling multipart. Skip the batch endpoint unless profiling shows a need.
- Quota (Gmail API usage-limits page, fetched 2026-09): 1,200,000 units/min/project, **6,000 units/min/user**, plus a new daily billing threshold (80,000,000 units/day/project after 2026-05-01; personal use will never approach it). Per-method costs quoted on the page: `messages.send` 100, `threads.get` 40, `messages.get` 20, `history.list` 2, `labels.list` 1 (the full table has the rest; re-check it, older docs listed threads.get 10 / messages.get 5). Budget: an initial sync of 500 threads is about 20k units; spread it over a few minutes.
- On HTTP 429 or 403 `rateLimitExceeded`/`userRateLimitExceeded`: truncated exponential backoff with jitter, honor `Retry-After` if present.

### 1.7 Snooze (not native; implement locally)

1. Ensure a user label `Snoozed` exists (`labels.create`, cache its id).
2. Snooze: `threads.modify` remove `INBOX`, add `Snoozed`; persist `{account, thread_id, wake_at}` in SQLite.
3. A scheduler in the main process (`setTimeout` for the next wake, recomputed on `powerMonitor.on('resume')` and app start) wakes threads: remove `Snoozed`, add `INBOX` and `UNREAD`.
4. Limitation: snoozed mail returns only while the app is running (or at next launch). State that in the UI. The Graph equivalent is move to a self-created `Snoozed` folder and back to `inbox`.

### 1.8 Contacts

None. Populate a local `contacts` table from message headers; rank by frequency/recency.

---

## 2. Microsoft Graph (Outlook / Hotmail / Microsoft 365)

### 2.1 OAuth 2.0 (public client, PKCE, no secret)

Endpoints (authority `common` = work/school + personal):

| Purpose | URL |
|---|---|
| Authorize | `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` |
| Token / refresh | `https://login.microsoftonline.com/common/oauth2/v2.0/token` |

Authorize URL:

```
https://login.microsoftonline.com/common/oauth2/v2.0/authorize
  ?client_id=CLIENT_ID
  &response_type=code
  &redirect_uri=http%3A%2F%2Flocalhost%3A54321
  &response_mode=query
  &scope=openid%20profile%20email%20offline_access%20User.Read%20Mail.ReadWrite%20Mail.Send%20MailboxSettings.ReadWrite
  &state=STATE
  &code_challenge=CHALLENGE
  &code_challenge_method=S256
  &prompt=select_account
```

Redirect URI rules (Entra "reply URL" doc): `http` is allowed only for loopback; for `localhost` the **port is ignored when matching**, so register `http://localhost` and use any port at runtime; the path must match; do not register several localhost URIs differing only by port; IPv6 `[::1]` is unsupported. Because the browser may resolve `localhost` to `::1` first, bind the loopback listener on both `127.0.0.1` and `::1` for the chosen port (or add `http://127.0.0.1` in the manifest and use that instead, which Microsoft recommends). Query strings are not allowed in redirect URIs for apps that accept personal accounts.

Token exchange (no `client_secret`):

```
POST https://login.microsoftonline.com/common/oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded

client_id=...&scope=<same scopes>&code=...&redirect_uri=http://localhost:54321&grant_type=authorization_code&code_verifier=...
```
```json
{ "token_type": "Bearer", "scope": "Mail.ReadWrite Mail.Send ...", "expires_in": 3599, "ext_expires_in": 3599,
  "access_token": "EwB...", "refresh_token": "M.C5...", "id_token": "eyJ..." }
```
Refresh: `grant_type=refresh_token&client_id=...&refresh_token=...&scope=<scopes>`.

**Refresh tokens rotate: every refresh returns a new `refresh_token`. Persist the newest one atomically before discarding the old** (docs: old tokens are not revoked on use, but you should securely delete them). Lifetime: 90 days (sliding, renewed on use) for non-SPA clients; 24h if the redirect is registered as SPA (avoid). Revocations: password change for password-based tokens, user or admin revoke, `interaction_required`/`invalid_grant` errors -> re-auth interactively.

Identity: `GET https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName`. For personal accounts `mail` can be null; use `userPrincipalName` or the `id_token` `preferred_username`.

### 2.2 Scopes

| Scope | Why |
|---|---|
| `Mail.ReadWrite` | Read, move, flag, delete, drafts, createReply/Forward, attachments. Personal-account capable, no admin consent. |
| `Mail.Send` | `sendMail`, `send` draft. |
| `MailboxSettings.ReadWrite` | Required for `masterCategories` (labels). **Supported for personal accounts** per the permissions reference (checked). If you drop categories, drop this scope. |
| `User.Read` | `/me` profile. |
| `offline_access` | Returns the refresh token. |
| `openid profile email` | id_token identity. |
| Contacts | Omit (`Contacts.Read`); derive from headers. |

### 2.3 Graph mail API

Base: `https://graph.microsoft.com/v1.0`. Send on **every** request:

```
Authorization: Bearer <token>
Prefer: IdType="ImmutableId"
```
(Combine with other preferences in one header: `Prefer: IdType="ImmutableId", odata.maxpagesize=50`.)

**Well-known folder names** (usable anywhere a folder id is expected, locale independent): `inbox, drafts, sentitems, deleteditems, junkemail, archive, outbox, clutter, conflicts, conversationhistory, msgfolderroot, recoverableitemsdeletions, scheduled, searchfolders, localfailures, serverfailures, syncissues`. `archive` is the one-click Archive folder (not the Exchange Online archive mailbox). Delta responses and `parentFolderId` use real ids, so on startup resolve `GET /me/mailFolders/{wellKnown}` for inbox/archive/sentitems/drafts/deleteditems/junkemail and cache the id map. List custom folders with `GET /me/mailFolders?$top=100` and recurse `childFolders` (default page is only 10).

**List messages in a folder**

```
GET /me/mailFolders/inbox/messages
    ?$select=id,conversationId,conversationIndex,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isRead,isDraft,hasAttachments,flag,categories,importance,parentFolderId,internetMessageId
    &$orderby=receivedDateTime desc
    &$top=50
```
```json
{ "@odata.context": "...", "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$select=...&$top=50&$skip=50",
  "value": [ { "@odata.etag": "W/\"CQAA...\"", "id": "AAMkAD...", "conversationId": "AAQkAD...",
      "conversationIndex": "AdlX...", "subject": "...", "bodyPreview": "...",
      "from": {"emailAddress": {"name": "Dana", "address": "dana@contoso.com"}},
      "toRecipients": [ {"emailAddress": {"name": "...", "address": "..."}} ],
      "receivedDateTime": "2026-09-20T10:15:00Z", "isRead": false, "isDraft": false, "hasAttachments": false,
      "flag": {"flagStatus": "notFlagged"}, "categories": [], "importance": "normal",
      "parentFolderId": "AAMkAD..." } ] }
```
Default page size 10; `$top` 1-1000 (use 50-100; large pages with bodies cause 504). **Follow `@odata.nextLink` verbatim; never construct `$skip` yourself.** Body is returned as HTML unless `Prefer: outlook.body-content-type="text"`. For the list view select `bodyPreview` and omit `body`; fetch `body` (`GET /me/messages/{id}?$select=body,uniqueBody,internetMessageHeaders`) on open.

**Threading decision (asymmetry): Gmail has native threads; Graph has no thread endpoint.** Group by `conversationId` client-side:
- Store every synced message row with `(account_id, message_id, conversation_id, folder, received_at, ...)`; the thread list is `GROUP BY conversation_id` over messages in the visible folder, thread date = max(received_at).
- To render a full conversation across folders (inbox + sent + archive): `GET /me/messages?$filter=conversationId eq '<id>'&$select=...` (no `$orderby`, or you hit `InefficientFilter`; sort locally by `receivedDateTime`, tie-break `conversationIndex`). This means you must also sync Sent Items (and Archive) or issue this query on open.
- Gmail thread = provider thread; Graph thread = derived. Model both as `thread_key` in the local DB.

**Delta sync per folder** (verified against message-delta docs):

```
GET /me/mailFolders/{id}/messages/delta?$select=id,conversationId,subject,from,receivedDateTime,isRead,flag,categories,parentFolderId,hasAttachments,bodyPreview
    &$filter=receivedDateTime ge 2026-08-21T00:00:00Z
    &$orderby=receivedDateTime desc
Prefer: odata.maxpagesize=50, IdType="ImmutableId"
```
- Response has `value[]` plus either `@odata.nextLink` (`...?$skiptoken=...`, keep going) or `@odata.deltaLink` (`...?$deltatoken=...`, round complete; **persist it per folder**). Next round: `GET <saved deltaLink>`.
- Query options (`$select`, `$filter`, `$orderby`, `changeType`) are supplied only on the initial request; the tokens encode them.
- Supported: `$select`, `$top`, `$expand`; `$filter` only `receivedDateTime ge|gt X` (returns at most 5,000 messages); `$orderby` only `receivedDateTime desc`; **no `$search`**; optional `changeType=created|updated|deleted`.
- Deletions and moves-out arrive as:
```json
{ "@odata.type": "#microsoft.graph.message", "id": "AAMk...", "@removed": { "reason": "deleted" } }
```
  Delta also emits `@removed` for moves out of the folder and read/unread changes that don't match your filter; always treat `@removed` as "remove from this folder" and apply updates by id.
- Delta is per folder: keep one deltaLink each for inbox, sentitems, archive, drafts, deleteditems, junkemail (and custom folders you show). Folder tree changes: `GET /me/mailFolders/delta`.
- Expired/invalid state token: HTTP 410 (`syncStateNotFound`); discard the deltaLink and re-run the bounded initial sync (VERIFY exact code name).
- Poll every 30-60 s while focused. Change-notification webhooks need a public HTTPS endpoint, so skip.

**Actions**

| UI action | Call |
|---|---|
| Archive | `POST /me/messages/{id}/move` `{"destinationId":"archive"}` -> `201` + message. If the account has no archive folder yet, create one (`POST /me/mailFolders {"displayName":"Archive"}`) and use its id. |
| Trash | `POST /me/messages/{id}/move` `{"destinationId":"deleteditems"}` |
| Spam | move to `junkemail` |
| Mark read/unread | `PATCH /me/messages/{id}` `{"isRead": true}` |
| Star | `PATCH /me/messages/{id}` `{"flag": {"flagStatus": "flagged"}}` (`notFlagged`, `complete`) |
| Set categories | `PATCH /me/messages/{id}` `{"categories": ["Clients","Urgent"]}` (full replacement array: read-modify-write) |
| Move to folder | `POST .../move {"destinationId": "<folderId>"}` |
| Permanent delete | `DELETE /me/messages/{id}`; avoid, use move to deleteditems. |

Move "creates a new copy in the destination and removes the original"; with `Prefer: IdType="ImmutableId"` the returned id equals the original id (see 2.6). For bulk actions use JSON batching: `POST /v1.0/$batch` with `{"requests":[{"id":"1","method":"PATCH","url":"/me/messages/{id}","headers":{"Content-Type":"application/json","Prefer":"IdType=\"ImmutableId\""},"body":{"isRead":true}}]}`, max 20 sub-requests, each counted individually and executed within the mailbox concurrency limit.

**Categories as labels**

```
GET    /me/outlook/masterCategories
POST   /me/outlook/masterCategories   {"displayName":"Project expenses","color":"preset9"}   -> 201 {"id":"bac262b7-...","displayName":"...","color":"preset9"}
PATCH  /me/outlook/masterCategories/{id}   {"color":"preset3"}      // displayName is not updatable; rename = create new + reassign
DELETE /me/outlook/masterCategories/{id}
```
`color` is `none` or `preset0`..`preset24`. A message's `categories` is an array of `displayName` strings; the master list only supplies color. A category string not in the master list still works but has no color.

**Send**

```
POST /me/sendMail          (202 Accepted, empty body)
{ "message": { "subject": "Meet for lunch?",
               "body": { "contentType": "HTML", "content": "<p>Hi</p>" },
               "toRecipients": [ {"emailAddress": {"address": "a@x.com"}} ],
               "ccRecipients": [], "bccRecipients": [],
               "attachments": [ { "@odata.type": "#microsoft.graph.fileAttachment", "name": "a.pdf",
                                  "contentType": "application/pdf", "contentBytes": "<standard base64>" } ] },
  "saveToSentItems": true }
```
- 202 means accepted, not delivered. The Sent Items copy appears shortly after; do not rely on it synchronously.
- **MIME alternative**: `POST /me/sendMail` with `Content-Type: text/plain` and the body = **standard base64** of the whole RFC 822 message (malformed base64 -> `400 ErrorMimeContentInvalidBase64String`). This lets one MailComposer pipeline serve both providers. Test it against a personal account early; use it for new messages, but prefer the JSON/draft path for replies (below) so threading (`conversationId`) is handled by Exchange.
- Inline JSON attachments must be under ~3 MB each. For 3-150 MB: create a draft, then
```
POST /me/messages/{draftId}/attachments/createUploadSession
{ "AttachmentItem": { "attachmentType": "file", "name": "big.zip", "size": 3483322, "isInline": false } }
-> 201 { "uploadUrl": "https://outlook.office.com/api/v1.0/...?authtoken=...", "expirationDateTime": "...", "nextExpectedRanges": ["0-"] }
```
  then sequential `PUT <uploadUrl>` chunks of up to 4 MB with `Content-Range: bytes 0-4194303/3483322`, no Authorization header (the URL embeds a token), then `POST /me/messages/{draftId}/send`. Default message size limit is 35 MB.

**Reply / reply-all / forward / drafts**

```
POST /me/messages/{id}/createReply       -> 201 draft (isDraft:true, body includes quoted original, same conversationId)
POST /me/messages/{id}/createReplyAll
POST /me/messages/{id}/createForward     body optional {"toRecipients":[...],"comment":"..."}
PATCH /me/messages/{draftId}             {"body":{"contentType":"HTML","content":"<new html + quoted original>"},"toRecipients":[...]}
POST /me/messages/{draftId}/send         -> 202
POST /me/messages/{id}/reply             {"comment":"text"}  (one shot, 202; also /replyAll, /forward with toRecipients)
POST /me/messages                        create new draft: {"subject","body","toRecipients"} -> 201
DELETE /me/messages/{draftId}
```
`createReply` accepts either `comment` or `message.body`, not both. Patching `body` replaces the quoted history, so your composer must load the draft body and insert the user's text above the quote. Autosave = debounce `PATCH` on the draft; new draft = `POST /me/mailFolders/drafts/messages`.

**Attachments (read)**

```
GET /me/messages/{id}/attachments?$select=id,name,contentType,size,isInline,contentId
GET /me/messages/{id}/attachments/{attId}/$value        -> raw bytes
GET /me/messages/{id}/attachments/{attId}                -> {"@odata.type":"#microsoft.graph.fileAttachment","id","name","contentType","size","isInline","contentId","contentBytes":"<base64>"}
```
Inline images: `isInline: true` and `contentId` matching `cid:` refs in the HTML body. `hasAttachments` excludes inline images.

**Search / filter limits**

- `$search="from:dana subject:invoice"` on `/me/messages` or `/me/mailFolders/{id}/messages`: KQL, searchable props `attachment, bcc, body, cc, from, hasAttachments, importance, kind, participants, received, recipients, sent, size, subject, to`; default fields from/subject/body; **returns at most 1,000 results, sorted by sent date**; value must be in double quotes. Known constraint (VERIFY on your tenant): `$search` cannot be combined with `$orderby`, and `$filter`+`$search` on messages is unreliable; do not depend on it.
- `$filter`: `isRead eq false`, `receivedDateTime ge ...`, `from/emailAddress/address eq '...'`, `conversationId eq '...'`, `flag/flagStatus eq 'flagged'`, `categories/any(c:c eq 'X')`, `hasAttachments eq true`. When mixing `$filter` and `$orderby`, `$orderby` properties must also appear in `$filter`, in the same order, and before other filter properties, else `400 InefficientFilter`.
- Recommendation: full-text search runs locally on SQLite FTS5 over synced mail; fall back to provider search (`q` for Gmail, `$search` for Graph) for older mail not yet synced.

### 2.4 Throttling

- Global Graph limit: 130,000 requests / 10 s per app across tenants (irrelevant for one user).
- Outlook service limits (from prior documentation; the throttling page fetched this session returned no Outlook row, so VERIFY): 10,000 requests / 10 min per app per mailbox, **4 concurrent requests per app per mailbox**, 150 MB upload per 5 min. Practical rule: cap concurrency to 4 for Graph.
- On `429` (or `503/504`) obey `Retry-After` seconds; otherwise exponential backoff. Watch `x-ms-throttle-limit-percentage` if present.

### 2.5 Rate/size quick reference

| Item | Value |
|---|---|
| Graph `$top` for messages | 1-1000 (default 10) |
| `$batch` sub-requests | 20 |
| Inline attachment (JSON) | < 3 MB |
| Upload session file | 3-150 MB, chunks up to 4 MB |
| `$search` results | 1000 max |
| Delta with `$filter` | 5000 messages max |
| Category colors | none, preset0-preset24 |

### 2.6 Immutable IDs

Default Outlook message ids change when a message is moved between folders (archive = move, so the id changes). Opt in on every request with `Prefer: IdType="ImmutableId"`. The id then stays constant while the item stays in the same mailbox (moves between folders included); it changes only on move to an archive mailbox or export/re-import. Applies to messages and attachments (not folders, whose ids are already stable). Delta `nextLink`/`deltaLink` work with either id format. The header only affects the request it is on, so put it in your HTTP wrapper's default headers from day one; mixing formats breaks your local primary keys. `POST /me/translateExchangeIds` migrates existing ids (up to 1000 per call). Ids are case-sensitive: never lower-case them. Also send it on `createReply`, `move`, `PATCH`, and draft creation so returned ids are the immutable ones.

---

## 3. Token storage and refresh in Electron

**Where secrets live:** main process only. The renderer never sees an access or refresh token; it calls IPC (`mail:archive`, `mail:list`) and the main process attaches auth. Run the renderer with `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.

**At rest:** encrypt refresh tokens with Electron `safeStorage` (Chromium OS-crypt: on macOS the AES key is stored in the login Keychain under an item named "<App Name> Safe Storage"; only your app's code identity is on its ACL).

```ts
import { safeStorage, app } from 'electron'
// after app.whenReady():
const ok = await safeStorage.isAsyncEncryptionAvailable?.() ?? safeStorage.isEncryptionAvailable()
const blob = await safeStorage.encryptStringAsync(JSON.stringify({ refresh_token, scope, obtained_at }))  // Buffer
// store blob.toString('base64') in SQLite `accounts.secret_blob` or a JSON file in app.getPath('userData')
const plain = JSON.parse(await safeStorage.decryptStringAsync(Buffer.from(b64, 'base64')))
```
Electron docs recommend the async API (non-blocking, supports key rotation, handles temporary unavailability) and require the `ready` event first. Keep access tokens in memory only (they live ~1 hour); re-mint from the refresh token at startup.

**Ad-hoc signing and the Keychain (important interaction):** an ad-hoc signature's code identity is the binary hash, which changes on every build, and macOS Keychain ACLs are tied to code identity. Expect either a Keychain prompt ("wants to use ... Safe Storage") after each rebuild, or `decryptString` failing. Mitigations, in order of preference:
1. Create a stable local self-signed code-signing certificate (Keychain Access > Certificate Assistant > Create a Certificate > type "Code Signing") and set electron-builder `mac.identity` to its name; the designated requirement then stays stable across builds and the Keychain grants persist (click "Always Allow" once).
2. Keep ad-hoc signing but treat decrypt failure as "signed out": catch it, delete the blob, run the sign-in flow again. Also keep `appId` and `productName` constant so the Keychain item name does not change.
3. During development set the app name explicitly before `ready` (`app.setName('NotionMailClone')`) so dev and prod use one item name, or accept a separate one. (Behavior inferred from macOS/Chromium keychain design; validate in the first packaging spike.)

**Refresh flow (single-flight):**

```ts
class TokenManager {
  private inflight = new Map<string, Promise<string>>()
  async getAccessToken(acct: Account): Promise<string> {
    if (acct.access && acct.expiresAt - Date.now() > 120_000) return acct.access      // 2-minute skew
    if (!this.inflight.has(acct.id))
      this.inflight.set(acct.id, this.refresh(acct).finally(() => this.inflight.delete(acct.id)))
    return this.inflight.get(acct.id)!
  }
}
```
- 401 from the API: force one refresh, retry once.
- Google refresh: keep existing refresh_token (response omits it). Microsoft refresh: **replace stored refresh_token with the returned one immediately** (write encrypted blob before using the new access token).
- Terminal errors: `invalid_grant` (Google), `invalid_grant`/`interaction_required`/AADSTS70008/AADSTS700082 (Microsoft; expired from inactivity) -> mark account `needs_reauth`, stop syncing it, show a "Reconnect" banner, keep local cache readable. Do not loop retries.
- Sign-out: Google `POST https://oauth2.googleapis.com/revoke?token=<refresh>`; Microsoft has no revoke endpoint for personal refresh tokens (delete locally; user can revoke at account.microsoft.com/privacy/app-access or myapps).
- Google Testing mode note: refresh tokens die after 7 days; production-unverified avoids it (1.3).

---

## 4. Libraries

**Recommendation: no provider SDKs. Use plain `fetch` (Node 24 global, in the main process) plus one shared OAuth helper and a small HTTP wrapper.**

- Skip `googleapis` (very large install, wraps three lines of REST). Skip `@microsoft/microsoft-graph-client`/Graph SDK (adds Kiota/Azure deps). Optional: `@azure/msal-node` `PublicClientApplication.acquireTokenInteractive` with a cache plugin is a legitimate alternative for the Microsoft side (handles PKCE, loopback, refresh, rotation); rejected here to keep one hand-written OAuth implementation (~150 lines) shared by both providers and full control over `safeStorage`.
- HTTP wrapper responsibilities: attach `Authorization`, default `Prefer: IdType="ImmutableId"` for Graph, 401 refresh-and-retry, 429/503 backoff with `Retry-After`, per-account concurrency limiter (Gmail 8, Graph 4), request timeout via `AbortSignal.timeout`, and `x-ms-...`/`error.errors[].reason` logging. `electron.net.fetch` is the alternative if you need system proxy/cert integration.
- Loopback server: Node `http` module; no library.

**Outbound MIME:** `nodemailer`'s `MailComposer` (`import MailComposer from 'nodemailer/lib/mail-composer'`, types `@types/nodemailer`). It builds RFC 5322 with correct encodings, multipart/alternative, related inline images (`cid`), attachments, In-Reply-To/References, custom headers.

```ts
const mail = new MailComposer({
  from: 'Me <me@gmail.com>', to: ['a@x.com'], cc: [], bcc: ['b@x.com'], subject: 'Re: Hello',
  text: plainFallback, html: htmlBody,
  inReplyTo: '<orig-id@mail.gmail.com>', references: ['<root@...>', '<orig-id@...>'],
  attachments: [{ filename: 'a.pdf', content: buffer, contentType: 'application/pdf' },
                { filename: 'logo.png', content: png, cid: 'logo123', contentDisposition: 'inline' }],
}).compile()
mail.keepBcc = true                      // required for Gmail raw send
const raw: Buffer = await new Promise((res, rej) => mail.build((e, b) => e ? rej(e) : res(b)))
const gmailRaw = raw.toString('base64url')           // Gmail messages.send / drafts
const graphMime = raw.toString('base64')             // Graph sendMail text/plain MIME (standard base64)
```
Lighter alternative: `mimetext` (`createMimeMessage()`, `.asRaw()`); fewer features/edge-case coverage, so prefer MailComposer.

**Inbound MIME parsing:** not needed. Gmail returns a structured `payload`; Graph returns `body.content` + attachments endpoints. Only add `mailparser` if you later support `.eml` import or `format=raw` (Graph `GET /me/messages/{id}/$value` returns MIME).

**HTML sanitization + safe rendering** (defense in depth: DOMPurify, iframe sandbox, CSP, network blocking):

1. Sanitize with **DOMPurify** in the renderer (it needs a DOM; running it in main needs `jsdom`, which is heavy). Pin the current major, keep it updated.

```ts
import DOMPurify from 'dompurify'
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer nofollow') }
  for (const attr of ['src', 'background', 'poster']) {
    const v = node.getAttribute?.(attr)
    if (v && /^https?:/i.test(v)) { node.setAttribute('data-blocked-' + attr, v); node.removeAttribute(attr) }  // remote image blocking
    if (v && /^cid:/i.test(v)) { /* replaced below with mail-cid:// or data: */ }
  }
  node.removeAttribute?.('srcset')
})
const clean = DOMPurify.sanitize(html, {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'meta', 'link', 'base', 'audio', 'video', 'svg', 'math'],
  FORBID_ATTR: ['formaction', 'ping'],
  ALLOW_DATA_ATTR: false,
})
```
   Remote CSS: keep inline `<style>` (newsletters need it) but neutralize `url(http...)`, `@import`, `expression()` with a regex pass on style text, and rely on the CSP below as the backstop.

2. Render in a sandboxed iframe with a restrictive CSP baked into `srcdoc`:

```html
<iframe sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"
        srcdoc='<!doctype html><meta http-equiv="Content-Security-Policy"
                content="default-src &apos;none&apos;; img-src data: blob: mail-cid:; style-src &apos;unsafe-inline&apos;; font-src data:">
                <base target="_blank"><body>...sanitized html...</body>'></iframe>
```
   - No `allow-scripts`: scripts cannot run at all. `allow-same-origin` (without scripts) lets the parent read `contentDocument.documentElement.scrollHeight` to auto-size the frame via `ResizeObserver`; it is safe only because scripts are disabled; do not add both flags together.
   - "Load remote images" button: rebuild srcdoc restoring `data-blocked-src` into `src` and widen `img-src` to `https:`; per-sender allowlist in SQLite. Warn that remote loads leak IP/open-tracking.
   - Electron-level backstop: in the main process, `session.webRequest.onBeforeRequest` cancels any `http(s)` sub-resource request from the mail-content frame unless the user enabled images for that message; `webContents.setWindowOpenHandler` -> `shell.openExternal` only for `http:`/`https:`/`mailto:`; `will-navigate` prevents navigation; `session.setPermissionRequestHandler` denies all.
3. **Inline `cid:` images**: neither provider gives a browser-loadable URL. In the same pass, map each `cid:xyz` to bytes: Gmail = part with `Content-ID: <xyz>` -> `attachments.get` (or inline `body.data`); Graph = attachment with `isInline && contentId == xyz` -> `GET .../attachments/{id}/$value`. Replace `src` with a `data:` URI for small images (< ~256 KB) or `mail-cid://<account>/<messageId>/<cid>` served by `protocol.handle('mail-cid', ...)` from a disk/SQLite blob cache (register the scheme as privileged `standard`, `supportFetchAPI` before `ready`). Local `data:`/`mail-cid:` images are allowed by the CSP above; only remote is blocked.
4. Plain-text messages: escape and linkify, render in a `<pre>`-like div, no iframe needed.

---

## 5. Electron / macOS specifics

### 5.1 Version (as of 2026-09-21)

| Electron | Stable | Chromium | Node | EOL |
|---|---|---|---|---|
| 43 | 2026-06-30 | M150 | 24.17.0 | 2027-01-05 |
| **44 (recommended: 44.3.0, 2026-09-09)** | 2026-08-25 | M152 | 24.18.1 | 2027-03-02 |
| 45 | 2026-10-20 | M156 | 24.21.0 | 2027-04-27 |

Electron supports the latest 3 majors, new major every 8 weeks. Pin `electron@44.x` now; consider moving to 45 after it ships and its first patch lands.

### 5.2 Scaffolding and packaging

Recommended: **electron-vite** (main/preload/renderer with Vite; React or Svelte renderer) + **electron-builder** (dmg/zip, native-module rebuild built in). Electron Forge (with `@electron-forge/plugin-vite` and `MakerDMG`) is a fine equivalent; the ad-hoc signing setting there is `packagerConfig.osxSign: { identity: '-' }`.

`electron-builder.yml` (arm64-only, personal use):

```yaml
appId: com.anthony.notionmail
productName: NotionMailClone
directories: { output: dist }
files: ["out/**", "package.json"]
asar: true
asarUnpack: ["**/*.node"]
npmRebuild: true
mac:
  target: [{ target: dmg, arch: [arm64] }]
  category: public.app-category.productivity
  identity: "-"            # ad-hoc; replace with your self-signed cert name for stable Keychain identity
  hardenedRuntime: false   # hardened runtime + ad-hoc has caused launch/framework crashes
  gatekeeperAssess: false
  darkModeSupport: true
```
Commands: `electron-builder --mac --arm64` (host is arm64; skip `universal`, which needs lipo-merging every native module). Unsigned arm64 binaries do not launch at all ("app is damaged"), so ad-hoc signing is mandatory, not optional. A locally built app opened from /Applications runs without Gatekeeper prompts (no quarantine attribute). If you copy a downloaded DMG to another Mac: right-click > Open once, or `xattr -dr com.apple.quarantine /Applications/NotionMailClone.app`. No notarization needed for personal use, no auto-update infrastructure needed (rebuild and replace).

### 5.3 Window chrome

```ts
const win = new BrowserWindow({
  width: 1280, height: 820, minWidth: 900, minHeight: 600,
  titleBarStyle: 'hiddenInset',            // or 'hidden' + trafficLightPosition for exact placement
  trafficLightPosition: { x: 16, y: 18 },  // honored with 'hidden'; verify combined with hiddenInset on Electron 44
  vibrancy: 'sidebar',                     // sidebar | under-window | titlebar | hud | header | sheet | window | menu | popover | content | tooltip | selection | fullscreen-ui | under-page
  visualEffectState: 'followWindow',       // 'active' keeps vibrancy when unfocused
  backgroundColor: '#00000000',            // transparent so the material shows; also set CSS background: transparent on the areas that should be vibrant
  show: false,
  webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
})
win.once('ready-to-show', () => win.show())
```
Drag regions: `-webkit-app-region: drag` on the top bar, `no-drag` on buttons/inputs inside it. Define an application `Menu` including standard `editMenu` roles, or Cmd+C/V/A/Z will not work in text fields. Use `app.setBadgeCount(unread)` for the dock badge, `new Notification()` from main for new mail, `nativeTheme.themeSource = 'system'`, keep the app alive when the last window closes (macOS convention) and re-create on `activate`; trigger sync + snooze recompute on `powerMonitor` `resume` and `unlock-screen`. Use `titleBarStyle` values exactly as above; `titleBarOverlay` is Windows/Linux only.

### 5.4 SQLite

| Option | Verdict |
|---|---|
| **better-sqlite3** (main process, WAL) | **Recommended.** Synchronous, fast, FTS5 compiled in. Native module: must be built against Electron's ABI. Add `"postinstall": "electron-builder install-app-deps"` (or `npx @electron/rebuild -f -w better-sqlite3`), keep `asarUnpack: ["**/*.node"]`, re-run after every Electron bump. Use a version that ships Node 24-compatible prebuilds; on failure it compiles from source with Xcode CLT + Python. |
| `node:sqlite` (built into Node 24, so Electron 44's main process should expose it) | No native rebuild. But stability is "1.2 release candidate" and reports show some Node builds compiled **without FTS5**. Before choosing it, run `SELECT sqlite_compileoption_used('ENABLE_FTS5')` inside an Electron 44 main process. If it returns 1 and you are comfortable with an RC API, it removes the rebuild pain. |
| `sql.js` (WASM) | Not recommended: whole DB in memory, manual persistence, slow for a real mailbox. |

Storage layout: `app.getPath('userData')/mail.db`; tables `accounts, folders/labels, threads, messages, bodies (lazy), attachments, contacts, snoozes, outbox, sync_state (gmail historyId, graph deltaLink per folder), settings`; FTS5 virtual table over subject/from/to/snippet/body; outbox table for offline sends with retry.

### 5.5 Provider abstraction (design summary)

- Interface: `sync()`, `listThreads(view, cursor)`, `getThread(id)`, `archive`, `trash`, `spam`, `setRead`, `setStar`, `addLabel/removeLabel`, `snooze/unsnooze`, `saveDraft`, `send`, `getAttachment`, `search`.
- Mapping: Inbox = Gmail `INBOX` label / Graph `inbox` folder; Archive = remove `INBOX` / move to `archive`; Starred = `STARRED` / `flag.flagStatus=flagged`; Unread = `UNREAD` / `!isRead`; Labels = Gmail labels / Outlook categories (+ folders for filing); Trash = `TRASH` / `deleteditems`; Spam = `SPAM` / `junkemail`; Sent = `SENT` / `sentitems`; Snooze = label `Snoozed` / folder `Snoozed`.
- Thread key: Gmail `threadId`; Graph `conversationId` (derived, see 2.3). Local primary key `(account_id, provider_message_id)`; with ImmutableId on Graph it survives archive moves.
- Optimistic UI: apply local change, enqueue provider op in an outbox, reconcile on next sync; retry with backoff; surface persistent failures.

### 5.6 Reconciliation with 01-notion-mail-ui-spec.md

Doc 01 does not fix a renderer framework, so the framework choice above (React or Svelte with electron-vite) stays open. Points where 01 constrains this doc:

- Window chrome: 01 (section 2.3) specifies a hidden-inset titlebar with traffic lights over the sidebar and the sidebar background under the titlebar. That matches `titleBarStyle: 'hiddenInset'` + `vibrancy: 'sidebar'` (or an opaque `#F7F7F5` / `#202020` sidebar if you prefer to match Notion's flat look over native material; vibrancy is optional).
- Notion Mail was Gmail-only; Outlook support here is an addition, so the provider abstraction (5.5) must normalize Gmail labels vs Graph categories/folders.
- "Reminders" (snooze), "Views", priority groups (Important / To-do / Waiting), custom properties, snippets, and schedule-send are **local-only concepts** (Notion Mail itself did not sync snoozes/scheduled sends to Gmail). Store them in SQLite; do not try to persist them in provider state (Gmail label / Graph category is optional mirroring only). Scheduled send needs the app running at send time: keep a local `scheduled_sends` outbox and send via `messages.send` / `sendMail` at the due time (Graph has no reliable deferred-send API for delegated mail; Gmail has none either).
- Compose: 01 specifies a Notion-style block editor (slash menu, headings, to-do, quote, callout, code, colors). Any block editor (TipTap/ProseMirror or Lexical) must serialize to email-safe HTML plus a `text/plain` alternative, which feeds `MailComposer` (`html` + `text`) unchanged. Avoid block types with no email equivalent (toggles, columns).
- Keyboard model (Gmail-compatible shortcuts, `g` then `i`, `e`, `#`, `z` undo, `cmd+enter` send) runs entirely in the renderer; undo for archive/trash/star should be optimistic-with-revert against the provider calls in 1.4 / 2.3 (reverse the label or move; note Graph move with ImmutableId returns the same id so undo can move back by id).
- Undo send is undocumented in Notion Mail; implement a 5-10 s local delay queue before calling the provider send endpoint.
- Notion Mail's own service was scheduled to end 2026-09-22 (per doc 01), so there is no upstream to stay compatible with; treat 01 as a visual reference only.

---

## 6. Decision log and open items

- Auth: hand-rolled OAuth (loopback + PKCE), system browser, shared for both providers.
- Gmail publishing status: In production, unverified (avoids 7-day expiry); scope set minimal (`gmail.modify` + identity).
- Graph: `Prefer: IdType="ImmutableId"` everywhere; threads derived from `conversationId`; per-folder delta.
- Signing: ad-hoc (or self-signed cert) + hardenedRuntime off; expect a Keychain re-prompt or re-login after rebuilds unless a stable cert is used.
- DB: better-sqlite3 + FTS5, rebuilt via `install-app-deps`.
- Items marked VERIFY: Gmail unverified-production behavior with restricted scope on first login; Gmail per-method quota table; Outlook throttle numbers (10k/10min, 4 concurrent); Graph delta 410 error code name; `$search` + `$filter/$orderby` combination on messages; trafficLightPosition with `hiddenInset`; `node:sqlite` FTS5 in Electron 44; portal behavior for accounts without an Azure subscription; MIME `sendMail` on personal accounts.

## Sources

- Google OAuth 2.0 for iOS and desktop apps: https://developers.google.com/identity/protocols/oauth2/native-app
- Gmail API scopes: https://developers.google.com/gmail/api/auth/scopes
- Google Auth Platform: Manage App Audience (testing 7-day expiry, user cap): https://support.google.com/cloud/answer/15549945
- Configure OAuth consent (Google Auth Platform navigation): https://developers.google.com/workspace/guides/configure-oauth-consent
- Create credentials (Clients > Desktop app): https://developers.google.com/workspace/guides/create-credentials
- Gmail sync guide: https://developers.google.com/workspace/gmail/api/guides/sync
- Gmail history.list: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list
- Gmail threads.modify, threads.get, messages.batchModify, attachments.get, drafts, labels, messages: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/modify (and siblings)
- Gmail batch: https://developers.google.com/workspace/gmail/api/guides/batch
- Gmail usage limits: https://developers.google.com/workspace/gmail/api/reference/quota
- Microsoft Graph message delta: https://learn.microsoft.com/en-us/graph/api/message-delta and https://learn.microsoft.com/en-us/graph/delta-query-messages
- List messages: https://learn.microsoft.com/en-us/graph/api/user-list-messages
- sendMail: https://learn.microsoft.com/en-us/graph/api/user-sendmail
- createReply: https://learn.microsoft.com/en-us/graph/api/message-createreply
- message move: https://learn.microsoft.com/en-us/graph/api/message-move
- mailFolder resource (well-known names): https://learn.microsoft.com/en-us/graph/api/resources/mailfolder
- Add attachment / createUploadSession: https://learn.microsoft.com/en-us/graph/api/message-post-attachments , https://learn.microsoft.com/en-us/graph/api/attachment-createuploadsession
- Create Outlook category: https://learn.microsoft.com/en-us/graph/api/outlookuser-post-mastercategories
- $search on messages: https://learn.microsoft.com/en-us/graph/search-query-parameter
- Immutable IDs: https://learn.microsoft.com/en-us/graph/outlook-immutable-id
- Graph throttling: https://learn.microsoft.com/en-us/graph/throttling-limits
- Graph permissions reference: https://learn.microsoft.com/en-us/graph/permissions-reference
- Entra redirect URI rules: https://learn.microsoft.com/en-us/entra/identity-platform/reply-url
- Entra refresh tokens: https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens
- Entra app registration quickstart: https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app
- Electron release schedule: https://releases.electronjs.org/schedule ; timelines: https://www.electronjs.org/docs/latest/tutorial/electron-timelines
- Electron safeStorage: https://www.electronjs.org/docs/latest/api/safe-storage
- electron-builder macOS config and ad-hoc identity: https://www.electron.build/docs/mac/
- Node.js sqlite docs: https://nodejs.org/api/sqlite.html
