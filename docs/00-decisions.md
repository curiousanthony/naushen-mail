# Naushen Mail — decisions & definition of done

Naushen Mail is a keyboard-first, cross-platform (macOS, Windows, Linux) desktop mail client that clones the *ergonomics*
of Notion Mail (which shut down 2026-09-22). **Gmail is supported today; Outlook is implemented but hidden
(`OUTLOOK_ENABLED` in `src/shared/features.ts`) until a Microsoft app registration exists.** It is published under
the Functional Source License (FSL-1.1-ALv2; source-available, converts to Apache-2.0 after two years). **No AI features. No Notion accounts, databases or
workspaces.** No Notion logos or proprietary fonts are used; only the general design language (spacing, neutrals,
block-editor behaviour).

## Research findings that changed the brief (see `research/01-notion-mail-ui-spec.md`)
| Finding | Consequence |
|---|---|
| Notion Mail was **Gmail-only**; Outlook is the user's addition | Outlook is a first-class adapter here, built to the same interface |
| **No horizontal tab strip / split inbox.** Views are saved filter+group+sort chosen in the **sidebar** | Sidebar "Views" section; no top tab bar |
| Thread opens in a **side peek** (default), centre peek or full page; no persistent 3-pane reader | Reader is an overlay panel; setting for the 3 styles |
| List is **grouped by date** by default; hover actions replace the time on the right | Implemented in `threadlist` |
| Snooze is called **Reminders** (`h`), not synced to the provider | Local-only snooze/reminder columns |
| Full shortcut list is public (Gmail-style + `cmd+k`) | Implemented verbatim in `commands` |
| Only some slash blocks are documented; rest is standard Notion editor convention | See `05-email-html-contract.md` |

## Tech stack (and why)
| Layer | Choice | Why / rejected alternatives |
|---|---|---|
| Shell | **Electron 44** (macOS arm64/x64, Windows, Linux) | Notion Mail itself is Electron; proven native chrome (`hiddenInset` titlebar, vibrancy, traffic lights). Tauri rejected: no Rust toolchain on the machine, WebKit rich-text quirks. Swift/AppKit rejected: multi-week cost, no block editor ecosystem |
| Language | TypeScript (strict) everywhere | shared types between main/preload/renderer (`src/shared`) |
| Build | **electron-vite 5 + Vite 7** | one config, HMR, main/preload/renderer |
| UI | **React 19 + Zustand** + hand-written CSS with design tokens (`styles/tokens.css`) | tokens give exact light/dark parity with Notion's palette; no Tailwind to keep CSS auditable |
| Icons | lucide-react (thin outline, 1.5px stroke) | closest open set to Notion's outline icons |
| Editor | **TipTap 3 (ProseMirror)** + `@tiptap/suggestion` for `/` | block model + slash menu is a solved path; from-scratch editor is where this project would sink |
| Local store | **`node:sqlite`** (built into Electron's Node 24) with **FTS5** | zero native modules → no ABI rebuild step (`better-sqlite3` rejected); verified FTS5 works in Electron |
| Providers | **Gmail REST API** and **Microsoft Graph** via `fetch`, OAuth2 **PKCE + loopback redirect** | no backend server, no client secret for Microsoft; Google Desktop clients need a (non-confidential) secret. IMAP rejected: Microsoft removed basic auth for personal accounts, Gmail needs app passwords |
| Tokens | Electron `safeStorage` (Keychain / DPAPI / Linux secret service) in the local DB | never in plaintext, never bundled |
| Outgoing MIME | `nodemailer/lib/mail-composer` | robust RFC 5322 + multipart/alternative + inline cid images |
| HTML safety | DOMPurify → **sandboxed iframe** (`sandbox=""`, no scripts), remote images blocked until allowed | untrusted email HTML |
| Packaging | electron-builder → `.dmg`, `Setup.exe`, AppImage/deb; unsigned or ad-hoc until certificates exist | see `docs/install.md`, `docs/maintainers.md` |
| Tests | Vitest (store, query builder, serializers, adapters w/ mocked fetch) + headless Electron screenshot hook (`src/main/e2e.ts`) | |

## Architecture
```
Renderer (React) ──window.api.invoke──▶ main/ipc.ts ──▶ Repo (SQLite, source of truth for UI)
        ▲  push events                                        ▲
        └────────── SyncEngine ◀── ProviderAdapter (gmail | outlook | mock)
```
* The UI **only** reads the local store and acts **optimistically**; `SyncEngine.act` applies locally, then pushes to
  the provider and re-syncs on failure.
* Adapters implement one incremental-sync interface (`sync(cursor)`), not either API's vocabulary.
* Threads are never merged across accounts. RFC 822 `Message-ID`/`References` are stored for future cross-account use.
* Snooze/reminders/scheduled-send/undo-send/drafts-in-progress are **local** (providers don't sync them either).
* Local IDs: `${accountId}:${remoteId}`.

## Gmail authentication constraint (needs the user)
`gmail.modify` is a **restricted scope** (confirmed against Google's own restricted-scopes list, along with
`gmail.readonly`/`compose`/`insert`/`metadata`/`mail.google.com` — any scope that can read mail content is
restricted; there is no unrestricted alternative for a mail client that needs to display messages). Removing
the 7-day refresh-token expiry requires full Google verification, including a paid third-party security audit
(CASA) — not reasonable for a personal, single-user app. **Publishing the consent screen does not avoid this**
for a restricted scope (an earlier version of this doc, and the in-app guide, said otherwise — corrected
2026-09-24). The correct, Google-sanctioned path for personal use: stay in **Testing**, add yourself as a
**test user**, and expect to click **Reauthorize** roughly every 7 days (a quick Google sign-in, not a full
re-setup — the app already surfaces a `reauth` account status for this). **Update (owner decision):** the project will not pay for CASA/verification, so the public path is *bring your own Google OAuth client* (`docs/google-setup.md`, guided wizard in Settings → Accounts) with the consent screen set to **In production**, unverified. The 2026-09-24 note above that publishing does not avoid the 7-day expiry conflicts with this; the setup guide tells users to fall back to Testing + Reauthorize if tokens still expire. Built-in client + verification stays an optional maintainer path (`docs/maintainers.md`).

## Definition of done

Status as of 2026-09-23, after 11 PRs merged to `main` in two rounds (8 feature branches, then a
3-branch polish round) plus direct fixes for cross-branch integration bugs the merge surfaced.
Verified means: exercised in the built app via the headless screenshot hook (`docs/…`/CLAUDE.md),
not just read in the diff. 532 tests pass, typecheck and the packaged `.app` build are clean.

- [x] Launches as a real desktop app; on macOS the window chrome matches Notion Mail (hidden inset titlebar, sidebar, traffic lights) — verified: `npm run pack` produces an ad-hoc-signed, launchable `.app`
- [x] Demo provider exercises the whole UI offline — verified extensively
- [ ] Connect Gmail and Outlook accounts (OAuth) — code complete (adapters, PKCE loopback flow, token refresh/reauth, 193 adapter tests against mocked HTTP) and the setup doc's scopes match the code exactly, but **not exercised against a real account**: that needs OAuth apps only the user can create (`docs/google-setup.md`)
- [x] Sidebar: account switcher, compose, search, Views (create/edit/delete), Mail folders, labels with colours, unread counts (including "All Mail", fixed) — verified
- [x] Thread list: date groups, hover actions, unread styling, multi-select, keyboard nav (`j/k/x/e/#/…`), bulk actions, reachable loading skeleton — verified
- [x] Reader: side/centre/full peek, message cards, quoted-text collapse, sanitised HTML incl. resolved `cid:` inline images, inline reply/forward (dedup + Escape-to-close fixed) — verified. Attachment *download* is wired (`attachments.save`) but not exercised against a real account
- [x] Compose: To/Cc/Bcc chips w/ autocomplete, subject, block editor with `/` menu + markdown shortcuts + floating toolbar, attachments, signature, drafts autosave, send / send-later / undo-send, multiple composers no longer clip at narrow widths — verified. Email HTML validity is covered by the serializer's own test suite; not yet checked by actually opening a sent message in a real external mail client
- [x] Archive, trash, spam, star, read/unread, labels, reminders (snooze), undo toasts, auto-advance — verified. Unsubscribe is implemented (`List-Unsubscribe` parsing) but not click-tested end to end
- [x] Command palette (`cmd+k`), shortcut help (`?`), light/dark/system theme — verified
- [x] Settings: accounts, appearance, thread style, signature, views/labels, OAuth client setup guide, keyboard focus trap — verified
- [x] Documented: research, decisions, design system, provider setup, install; tests green; CI green on `main`

**What's left for a fully "no more intervention needed" app**: only the user's ~20 minutes in
Google Cloud Console + Azure (`docs/google-setup.md`) — everything downstream of that is
built and tested against mocked provider responses.
