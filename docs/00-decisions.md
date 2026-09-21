# Mailroom — decisions & definition of done

Mailroom is a personal-use, keyboard-first desktop mail client for macOS that clones the *ergonomics* of Notion Mail
(which shuts down 2026-09-22) for Gmail and Outlook accounts. **No AI features. No Notion accounts, databases or
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
| Shell | **Electron 44** (macOS `.app`, universal arm64/x64) | Notion Mail itself is Electron; proven native chrome (`hiddenInset` titlebar, vibrancy, traffic lights). Tauri rejected: no Rust toolchain on the machine, WebKit rich-text quirks. Swift/AppKit rejected: multi-week cost, no block editor ecosystem |
| Language | TypeScript (strict) everywhere | shared types between main/preload/renderer (`src/shared`) |
| Build | **electron-vite 5 + Vite 7** | one config, HMR, main/preload/renderer |
| UI | **React 19 + Zustand** + hand-written CSS with design tokens (`styles/tokens.css`) | tokens give exact light/dark parity with Notion's palette; no Tailwind to keep CSS auditable |
| Icons | lucide-react (thin outline, 1.5px stroke) | closest open set to Notion's outline icons |
| Editor | **TipTap 3 (ProseMirror)** + `@tiptap/suggestion` for `/` | block model + slash menu is a solved path; from-scratch editor is where this project would sink |
| Local store | **`node:sqlite`** (built into Electron's Node 24) with **FTS5** | zero native modules → no ABI rebuild step (`better-sqlite3` rejected); verified FTS5 works in Electron |
| Providers | **Gmail REST API** and **Microsoft Graph** via `fetch`, OAuth2 **PKCE + loopback redirect** | no backend server, no client secret for Microsoft; Google Desktop clients need a (non-confidential) secret. IMAP rejected: Microsoft removed basic auth for personal accounts, Gmail needs app passwords |
| Tokens | Electron `safeStorage` (Keychain-backed) in the local DB | never in plaintext, never bundled |
| Outgoing MIME | `nodemailer/lib/mail-composer` | robust RFC 5322 + multipart/alternative + inline cid images |
| HTML safety | DOMPurify → **sandboxed iframe** (`sandbox=""`, no scripts), remote images blocked until allowed | untrusted email HTML |
| Packaging | electron-builder → `.dmg`/`.zip`, ad-hoc signed | no Apple Developer account assumed; see `docs/install.md` |
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
`gmail.modify` is a **restricted scope**. With the OAuth consent screen in **Testing**, Google issues refresh tokens that
**expire after 7 days**. Publishing the consent screen to **In production** (no verification needed for personal use;
users see an "unverified app" warning once) removes the 7-day expiry. Both the Google Cloud and Azure app registrations
must be created by the user — the app reads the client IDs from Settings → Accounts. See `docs/06-provider-setup.md`.

## Definition of done
- [ ] Launches as a real macOS `.app`; window chrome matches Notion Mail (hidden inset titlebar, sidebar, traffic lights)
- [ ] Connect Gmail and Outlook accounts (OAuth) + a Demo provider that exercises the whole UI offline
- [ ] Sidebar: account switcher, compose, search, Views (create/edit/delete), Mail folders, labels with colours, unread counts
- [ ] Thread list: date groups, hover actions, unread styling, multi-select, keyboard nav (`j/k/x/e/#/…`), bulk actions
- [ ] Reader: side peek, message cards, quoted-text collapse, attachments (download), sanitised HTML, inline reply/forward
- [ ] Compose: To/Cc/Bcc chips w/ autocomplete, subject, block editor with `/` menu + markdown shortcuts + floating toolbar, attachments, signature, drafts autosave, send / send-later / undo-send, HTML output valid in real mail clients
- [ ] Archive, trash, spam, star, read/unread, labels, reminders(snooze), unsubscribe, undo toasts, auto-advance
- [ ] Command palette (`cmd+k`), shortcut help (`?`), light/dark/system theme
- [ ] Settings: accounts, appearance, thread style, signature, views/labels, OAuth client setup guide
- [ ] Documented: research, decisions, design system, provider setup, install; tests green; PRs reviewed-ready
