# Notion Mail: UI / UX Spec (non-AI, non-workspace)

Research date: 2026-09-21. Method: WebFetch/WebSearch of Notion help center pages, Notion's release notes and blog, third-party reviews (Zapier, Engadget, Thomas Frank, Matthias Frank, Simone Smerilli, TemplatesForNotion, Apps'n'Tips) and public Notion design-token references. I could not open the app itself, so no screenshots and no pixel measurements were taken.

Confidence tags used throughout:
- **[V]** verified: stated on an official Notion page or in 2+ independent sources.
- **[R]** reported: a single third-party source.
- **[I]** inferred: not documented for Mail. It is Notion's general design language or a reasoned default. Treat as a starting value to tune against a real screenshot.
- **[?]** unknown / could not be found.

---

## 0. Corrections to the brief, and product status

1. **Notion Mail is shutting down on 2026-09-22 (tomorrow).** [V] The help center says the desktop, web and iOS inbox goes away on that date. Export window opened 2026-06-25, last day to save is 2026-09-21. Notion's reason: more than half of email users never opened the inbox; it is replaced by Notion agents plus a Gmail/Outlook connector. Consequence: official help pages, the app and mail.notion.com may vanish soon. **Capture screenshots and pages now if visual fidelity matters.** Wayback fetch was blocked for me.
2. **Gmail only, no Outlook.** [V] Reviews (Zapier, Yahoo/Engadget) and the help center onboarding say sign-in is "Sign up with Google" (Gmail or Google Workspace). Outlook was "planned" but never shipped in Mail (the "Gmail or Outlook" mention in the shutdown notice refers to Notion agents / connectors, not the Mail app). Multi-account is Gmail accounts only. Windows was "coming soon", Android "pending".
3. **"Skiff-derived" means team, not code or UI.** [V] Notion acquired Skiff (Feb 2024); the Skiff team (Andrew Milich) built Notion Mail. Notion Mail is a Gmail client with Notion's own design system. No evidence it reuses Skiff's UI. Skiff's look (privacy, purple accent) should not be used as a reference.
4. **No true "split inbox" or classic folders.** The equivalent of split inbox is **Views** (saved filter+group+sort). Reviewers note: no side-by-side inbox+reading pane (Zapier), no nested labels, no label management sidebar, no drag-and-drop to labels (TemplatesForNotion, Mar 2025).
5. **Not synced from Gmail:** blocked senders, snoozed emails, scheduled emails, drafts, spam. [V] (help: Get started). Reminders set in Mail do not transfer to Gmail. [V]
6. Launched 2025-04-15 (Notion 2.50). [V] iOS app v1.13.5 last seen. Mac app: Apple Silicon/Intel/Universal. Web at mail.notion.com. [V]

---

## 1. Layout

### 1.1 Overall shell [V]
Three zones, Notion-like: left **sidebar**, central **list area** (with a top bar), and a **thread pane** that appears in one of three "thread styles". (Zapier: "left-side menu holding the profile card, compose button, search, views, and settings" and "a list view of all your emails, grouped by date by default".)

### 1.2 Sidebar

Items, in order (composite from Navigate-your-inbox help page, Zapier, TemplatesForNotion; ordering within the older UI is a best fit):

| # | Item | Notes | Tag |
|---|------|-------|-----|
| 1 | **Account / user name row** (profile avatar + name + chevron) | Click opens menu: Settings, switch accounts, add account, log out. Account switcher is a dropdown next to your name. Shortcut `ctrl+1..9` switches accounts. Jan 2026 added an "account picker" for multiple Gmail accounts. | V |
| 2 | **Compose** (pencil/"write" icon button, top of sidebar; help says "pencil icon at the top of the Notion Mail sidebar") | Shortcut `c`. In the original April 2025 UI it was a labeled button; later a pencil icon. | V |
| 3 | **Search** | Opens with `/`. Also `cmd+K`/`cmd+P` palette. | V |
| 4 | **Views** section header with `+` (New view) | Contains user views. Default views: **Inbox** (cannot be deleted) and **Important**. Each has emoji/icon, customizable icon and color. Also "Templates" shortcut for pre-built views (e.g., priority views). | V |
| 5 | **Mail** section: **All Mail**, **Sent**, **Drafts**, (**Reminders**, only appears when at least one exists), **Trash** | Spam reachable but not prominent. No Starred/Scheduled/Snoozed/Archive entries in the sidebar: Archive == "All Mail" (includes archived); Starred is a group/filter property; Scheduled sends live in a "Scheduled" location reachable from Drafts area [?]. Engadget: Drafts and Sent are "deliberately de-emphasized". | V for names, I for order |
| 6 | Labels | Gmail labels sync automatically (e.g. Updates, Important). They appear as filter/group/property options, and can appear in the sidebar as color-coded label rows with icon options (Simone Smerilli). No nested labels/subfolders. New label: Properties -> Label, type name, Enter. | V/R |
| 7 | Bottom: Settings, Templates/Snippets entry, Help, app switcher (Notion icon at the very bottom of Notion's own sidebar was the entry to Mail) | | R |

Collapsible sections: Views and Mail sections use the Notion pattern of a header that collapses on click with a hover chevron [I] (Notion sidebar convention; not documented for Mail).

**Sidebar shell behavior**
- Toggle sidebar: `cmd + \` (Notion convention, reported by search summary) [R].
- Default width: 224 px, resizable by drag (Notion default; Mail unverified) [I].

### 1.3 Top bar over the list [V]
Notion Mail's "tabs of Views" are **not** horizontal tabs over the inbox in the shipped app. Views are picked in the **sidebar**; the list area's top bar holds the current view title plus **Filter**, **Group**, **Sort**, an **edit view** icon and (AI) auto-label controls (Matthias Frank: "Filters, Grouping, Sorting options"). Filter icon sits top right. Edit-view icon at top opens Group -> Group by etc. Inbox with a horizontal tab strip is a Superhuman/Gmail-categories idiom, so keep it as an optional design choice, not a fidelity requirement. If you want the brief's tab bar, put the view names as tabs above the list and mirror them in the sidebar.

### 1.4 Thread list [V unless noted]
- Default grouping: **by date** (Zapier). Other group-bys: Date, Starred, Important, Email or domain, Priority, Label, Unread. Group by Priority uses default statuses: **Important / To-do / Waiting / No status** (Zapier lists Priority as Important, To-do, Waiting, No status; TemplatesForNotion lists Todo, Waiting, Important, No status).
- Row anatomy (composite): sender, subject, time, and any properties added to the view (Matthias Frank: "sender, subject, time, and any properties you add later"). Snippet/preview text is [I] (most reviews imply a single-line row; snippet presence unconfirmed). Label chips render as property chips in the row [I]. Unread state is shown by bolder text and an unread indicator [I]; "High contrast mode" setting exists for **read** emails (Settings -> Inbox), implying read rows are dimmed by default. [V]
- **Hover actions** (a customizable set): Star, Archive/Unarchive, Trash/Untrash, Mark read/unread, Set reminder (TemplatesForNotion). Zapier adds: unsubscribe, spam, reply, label, command bar. Hover actions appear at the right of the row and replace the time. [R]
- Checkbox for selection: `x` while hovering toggles select (Notion Mail shortcut table). Multi-select: `shift + up/down`. A bulk action bar appears with archive/trash/label/mark unread etc. [I]
- Filter is additive (AND). Filters: Unread, Read, Attachment, Calendar event, From, To, CC, BCC, Subject, Date, mailbox type, Gmail category (Promotions/Social/Forums), plus property-based filters (select etc.). [V]
- Drag-and-drop between groups reported by Apps'n'Tips but contradicted by TemplatesForNotion. Treat as [?].
- Views apply to existing and incoming email simultaneously. [V]
- Custom **properties** (per-view; not shared across views): text, number, select, multi-select, status, date, person, checkbox, URL, file. [R]

### 1.5 Reading / thread view [V]
Settings -> Inbox -> **Thread style**:
- **Side peek** (default): panel slides in from the right edge, over the list, width adjustable; arrow keys navigate between emails.
- **Center peek**: centered modal popup that obscures the list.
- **Full page**: replaces the inbox.
No persistent three-pane (list + reader always visible) layout.

Thread pane contents:
- Subject at top, then messages as stacked cards/blocks, expandable/collapsible. Shortcuts: `o` expand/collapse selected, `shift+o` expand/collapse all, `n`/`p` next/previous message in thread. [V]
- Top actions when open: Set reminder (clock icon), toggle unread, label, archive, delete (trash icon), "..." menu with report spam / report phishing. [V]
- Inline reply: `r` (reply), `a` (reply all), `f` (forward) opens a composer at the bottom of the thread pane [I: docs say Compose is a separate pencil-triggered composer; inline reply box placement inferred].
- Quoted text collapsed behind "..." [I] (standard, Gmail-like). Attachments as file chips, `cmd+O` opens attachments [R].
- Esc closes thread. [V]
- Unsubscribe: `cmd/ctrl + U`, also hover action. [R]

### 1.6 Command menu [V]
`cmd+K` or `cmd+P`. Lists actions, context-aware (archive thread, start reply, search email, create snippet, switch views), and shows the keyboard shortcut next to each item. `?` shows shortcut list (TemplatesForNotion).

---

## 2. Visual design

Notion Mail exposes no official token sheet. Everything below is **[I]** unless it says [V]. The values are Notion web-app values, which reviewers consistently say Mail matches ("a lot more like Notion than Notion Calendar does"; "generous white space and a focus on typography").

### 2.1 Fonts
- Family: Notion UI stack: `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif` (notion.so app). Marketing site uses "NotionInter" (Inter variant) [V for marketing]. In-app on Mac it renders SF Pro. Use Inter as web fallback.
- Sizes: base UI 14 px / line-height 1.5; sidebar items 14 px; list sender 14 px (medium weight if unread), subject 14 px, snippet/time 12-13 px muted; thread subject 24-28 px, weight 600-700; email body 14-16 px. Settings offers "font size adjustment" (Matthias Frank) [R].

### 2.2 Colors
Light (default text `#373530`/`rgb(55,53,47)` and white bg are [V] from hex tables):
| Token | Value |
|---|---|
| Page bg | `#FFFFFF` [V] |
| Text primary | `#37352F` [V] (`#373530` in one table) |
| Text secondary | `rgba(55,53,47,0.65)` [I] |
| Text tertiary / placeholder | `rgba(55,53,47,0.4)` [I] |
| Sidebar bg | `#F7F7F5` [given in brief, matches Notion `rgb(247,247,245)`] |
| Hover | `rgba(55,53,47,0.08)` [given] |
| Pressed | `rgba(55,53,47,0.16)` [I] |
| Selected row | `rgba(35,131,226,0.07)` bg [I] or hover-gray |
| Divider | `rgba(55,53,47,0.09)` [I] |
| Accent / focus | `#2383E2` (Notion blue), focus ring `rgba(35,131,226,0.35)` [V for ring] |
| Destructive | `#EB5757` [I] |

Dark (bg `#191919`, text `#D4D4D4` [V]; Notion also uses `rgba(255,255,255,0.81)` text):
| Token | Value |
|---|---|
| Page bg | `#191919` [V] |
| Sidebar bg | `#202020` [I] |
| Text primary | `rgba(255,255,255,0.81)` or `#D4D4D4` |
| Text secondary | `rgba(255,255,255,0.46)` [I] |
| Hover | `rgba(255,255,255,0.055)` [I] |
| Divider | `rgba(255,255,255,0.094)` [I] |
| Popover/menu bg | `#252525` [I] |

Theme setting: **Light / Dark / System** (Settings -> Inbox -> Theme mode). [V]

**Label / property chip palette** (Notion's 10 colors: default, gray, brown, orange, yellow, green, blue, purple, pink, red [V]). Text / background hex from a public table [V]:
| Color | Light text | Light bg | Dark text | Dark bg |
|---|---|---|---|---|
| Gray | #787774 | #F1F1EF | #9B9B9B | #252525 |
| Brown | #976D57 | #F3EEEE | #A27763 | #2E2724 |
| Orange | #CC782F | #F8ECDF | #CB7B37 | #36291F |
| Yellow | #C29343 | #FAF3DD | #C19138 | #372E20 |
| Green | #548164 | #EEF3ED | #4F9768 | #242B26 |
| Blue | #487CA5 | #E9F3F7 | #447ACB | #1F282D |
| Purple | #8A67AB | #F6F3F8 | #865DBB | #2A2430 |
| Pink | #B35488 | #F9F2F5 | #BA4A78 | #2E2328 |
| Red | #C4554D | #FAECEC | #BE524B | #332523 |
(These are text/page-background tints. Notion's select-tag chip fills are somewhat stronger, for example light gray tag `rgb(227,226,224)`, blue `rgb(211,229,239)`, red `rgb(255,226,221)` [I, recalled from Notion CSS].)

### 2.3 Shape, spacing, chrome [I]
- Radii: rows/menu items 4-6 px, buttons and inputs 6 px, popovers/menus 8-10 px, center-peek modal 12 px, chips 3-4 px (Notion tags are 3 px radius). Avatars circular.
- Sidebar row height ~28 px, horizontal padding 8-10 px inside a 6 px inset; icon 18-20 px, gap 8 px. Section headers 12 px, weight 500, muted, uppercase not used.
- Thread list row height ~36-40 px; group headers 12-13 px muted with count. Compact by design ("lightweight").
- Popover shadow: `rgba(15,15,15,0.05) 0 0 0 1px, rgba(15,15,15,0.1) 0 3px 6px, rgba(15,15,15,0.2) 0 9px 24px` (Notion menu shadow) [I].
- Borders: 1 px hairlines, extremely low contrast; minimal use of boxes, layout is separated by whitespace and hover fills.
- Icons: thin-stroke outline icons, Notion's own set, 16-20 px, stroke ~1.5 px; emoji allowed as view icons. Views have icon + color customization. [R]
- macOS window: standard hidden-inset titlebar with traffic lights at top-left over the sidebar [I]; the sidebar bg extends under the titlebar; drag region across the top.
- Animation: ~120-200 ms ease-out for hover fills, menus fade+scale in 100-150 ms, side peek slides in from right ~200 ms [I].

---

## 3. Keyboard shortcuts (official help center list) [V]

Mac keys. Windows: `cmd` -> `ctrl`. Notion Mail "retains all of Gmail's keyboard shortcuts" (Thomas Frank) in addition to these. No custom key remapping; no AZERTY support.

**Inbox / navigation**
| Action | Keys |
|---|---|
| Switch email accounts | `ctrl` + `1-9` |
| Close open thread | `esc` |
| Reply | `r` |
| Open thread | `enter` |
| Go to Inbox | `g` then `i` |
| Go to Sent | `g` then `t` |
| Go to Drafts | `g` then `d` |
| Go to Archive (All Mail) | `g` then `a` |
| Compose | `c` |
| Multi-select | `shift` + up/down |
| Command palette | `cmd+k` or `cmd+p` |
| Search | `/` |
| Jump to top/bottom | `cmd` + up/down |
| Scroll down / up | `space` / `shift+space` |
| Toggle sidebar | `cmd+\` [R] |

**Threads and messages**
| Action | Keys |
|---|---|
| Select/unselect conversation | hover + `x` |
| Archive | `e` |
| Report spam | `!` |
| Delete | `#` or `delete` |
| Reply / Reply all / Forward | `r` / `a` / `f` |
| Mark as unread | `u` |
| Move to Inbox | `shift+e` |
| Undo | `z` |
| Set reminder | `h` |
| Next / Previous thread | `j` / `k` |
| Back | `esc` |
| Label / remove label | `l` |
| Expand/collapse all | `shift+o` |
| Next / previous message in thread | `n` / `p` |
| Expand/collapse selected message | `o` |
| Unsubscribe | `cmd+u` [R] |
| Open attachments | `cmd+o` [R] |
| Send + archive | `cmd+shift+enter` |

**Compose**
| Action | Keys |
|---|---|
| Send | `cmd+enter` |
| Send and archive | `cmd+shift+enter` |
| Exit draft | `esc` |
| Discard draft | `cmd+shift+d` |
| Add Cc / Bcc | `cmd+shift+c` / `cmd+shift+b` |
| Edit From | `cmd+shift+f` |
| Edit subject | `cmd+shift+p` |
| Edit recipient | `cmd+shift+o` |
| Focus message body | `cmd+shift+y` |
| Add attachment | `cmd+shift+a` |
| Align right / center | `cmd+shift+r` / `cmd+shift+e` |
| Text / H1-H3 | `cmd+opt+0` / `cmd+opt+1-3` |
| Checkbox / bullets / numbered / quote | `cmd+opt+4` / `5` / `6` / `7` |
| Indent less / more | `cmd+[` / `cmd+]` |
| Emoji | type `:` + description |

(Note: a third-party table lists reply as `cmd+shift+P`, view filters `ctrl+F`, edit view `ctrl+E`. These conflict with the official list; treat as [?].)

---

## 4. Compose experience

**Window type** [V-ish]: opened via pencil icon / `c`. A dedicated composer (help says the composer "requires recipient, subject, body", with a bottom toolbar). Whether it is a floating bottom-right popover or a modal is not stated in docs. Best inference from how thread styles work: the composer opens as a **centered peek/modal-style panel** or a right/bottom sheet, `esc` "exits draft" (saves it). Draft autosave: implied by "Exit draft" and Drafts folder (drafts do not sync from Gmail, so they are Notion-side). Auto-save timing [?].

**Fields** [V]: From (editable, `cmd+shift+f`), To ("recipient"), Cc, Bcc (revealed by shortcut or links), Subject, body. Attachments via paperclip.

**Bottom toolbar** (left to right, from help center): `{}` Snippets, paperclip Attach, calendar Availability, trash (discard draft), and on the right the **Send** button with a `v` dropdown for **Schedule send**. Schedule send options (Zapier): "tomorrow morning, tomorrow afternoon, a week from now, or a custom time", with timezone adjustment. [V]

**Body editor** = Notion block editor [V]:
- Slash menu `/` opens "a menu of blocks that you can use to create your email". Confirmed in sources: text, headings 1-3 (`/h1 /h2 /h3`), image, callout, quote, checkbox (to-do), code block, divider, text color / background color, and Mail-specific `/schedule` (Notion Calendar booking link) and `/<snippet name>` (inserts snippet). Markdown shortcuts are supported (`[]` to-do confirmed).
- **Full block list is not documented** for Mail. The following is **[I]** based on Notion editor conventions; do not assume all exist:
  | Block | Slash aliases | Markdown |
  |---|---|---|
  | Text | `/text`, `/p` | none |
  | Heading 1-3 | `/h1 /h2 /h3 /heading` | `# `, `## `, `### ` |
  | Bulleted list | `/bullet`, `/ul` | `- `, `* `, `+ ` |
  | Numbered list | `/numbered`, `/ol` | `1. ` |
  | To-do | `/todo`, `/checkbox`, `/[]` | `[] ` |
  | Toggle | `/toggle` | `> ` (uncertain in email; toggles don't survive most clients) |
  | Quote | `/quote` | `" ` |
  | Divider | `/divider`, `/---` | `---` |
  | Callout | `/callout` | none |
  | Code | `/code` | ` ``` ` |
  | Image | `/image` | none |
  | Link / mention | `@` (Notion pages, dropped in your rebuild), `cmd+k` link | |
  | Emoji | `:` + name | |
  | Table, columns, embeds, page/database blocks | likely not offered [?] |
  | Colors | `/red`, `/blue` (text), `/red background` | |
- Inline formatting shortcuts (Notion): `cmd+b`, `cmd+i`, `cmd+u`, `cmd+shift+s` strike, `cmd+e` code, `cmd+k` link, `**bold**`, `*italic*`, `` `code` ``, `~strike~`. [V from Notion general help]
- Floating selection toolbar (Notion style) on text select: Turn-into dropdown, bold/italic/underline/strike/code, link, text color. [I]
- Formatting is rendered to email-safe HTML; "formatting remains intact in other email clients" (Zapier). [R]
- `{` in body inserts a **snippet variable** (e.g. first name of recipient), format `{first_name}`; snippet panel shows dynamic fields. [R]

**Snippets** [V]: `{}` icon -> "+ New snippet" -> title + content -> Save. Also created from Settings -> Snippets or command palette, or by converting a draft. Snippets can have an icon, a keyboard shortcut/slash name (e.g. `/website link`), attachments, scheduling links. Search and manage in Settings.

**Signature** [V, with drift]: Settings -> Signature: toggle default signature on/off, choose whether to include in replies/forwards; the signature is edited via Gmail settings (imported from Gmail). Earlier (Mar 2025) no signature support existed; workaround was a signature snippet.

**Send later** [V]: dropdown beside Send (see above). Desktop/web only (mobile can't schedule).
**Undo send** [?]: not documented in help or reviews. Global `z` shortcut undoes last action (archive etc.) and toasts appear, but an undo-send delay window is unverified; reviewers list "no Send and Snooze", "no auto-archive after send". Recommend implementing a 5-10 s undo-send toast anyway [I].
**Reminders** [V]: "temporarily hide emails until you need them": email leaves inbox, appears in Reminders section, resurfaces at the time. Options include "Remind if no reply" vs "Remind regardless" (TemplatesForNotion) [R]. `h` opens the picker; exact preset list [?] (Gmail-like: later today, tomorrow, next week, custom [I]).

---

## 5. Features summary

| Feature | Status in Notion Mail |
|---|---|
| Labels | Gmail labels sync; created via Properties -> Label; color and icon customizable; no nesting; label-based views; `l` shortcut |
| Views | Saved filter+group+sort+properties; create by "description (AI), configure manually, or use a template"; "New view" in sidebar; unlimited; Inbox cannot be deleted; notification toggle per view |
| Split inbox | Emulated via Views (no side-by-side reader) |
| Snooze | Called **Reminders** (`h`); not synced to Gmail |
| Send later | Yes (dropdown on Send), desktop/web only, not synced from Gmail |
| Follow-ups | "Remind if no reply" option on reminders [R] |
| Multi-account | Multiple Gmail accounts; account switcher; `ctrl+1-9` |
| Search | `/` opens search; supports `label:` syntax [R]; filter UI covers From/To/Cc/Bcc/Subject/Date/Attachment/Calendar event/Unread/Read. Full Gmail operator support unverified |
| Bulk actions | `shift+up/down`, `x`; mobile tap-and-hold multi-select |
| Unsubscribe | `cmd+u`, hover action [R] |
| Undo toast | `z` undo for last action [V]; toast text unknown |
| Auto-advance | Setting: after archive go to next thread / previous thread / close thread [R] |
| Notifications | macOS desktop notifications; per-view toggles (Inbox on by default, others off); per-sender/VIP overrides |
| Mobile | iOS 17+, customizable swipe left/right (Archive, Trash, Add label, Read/unread), profile photo top, bulk via tap-and-hold |
| Gmail Filters | Settings screen to list/edit/delete existing Gmail filters; create only in Gmail |
| Themes | Light/Dark/System; High contrast mode toggle for read emails |
| Languages | 15-18 |

### Settings screens (official list) [V]
Settings sidebar sections: **Inbox** (Language, Theme mode, Thread style, Auto-advance, High contrast mode), **Account** (associated Notion email, export data, Connected addresses: disconnect removes account "and all views, AI labels, and notification preferences"), **Notifications**, **Notion AI** (skip), **Gmail Filters**, **Snippets**, **Signature**.

---

## 6. Empty states, onboarding, microcopy

Onboarding [V]: download (Mac/Web/iOS) -> "Sign up with Google" -> connect Gmail/Workspace (Notion account auto-created) -> customize notifications. The very first experience offers suggested AI labels (skip).

Microcopy known [V/R]: "New view", "Views", "Mail", "All Mail", "Group by", "Thread style", "Side peek / Center peek / Full page", "Auto-advance", "Connected addresses", "Create snippet", "+ New snippet", "Remind if no reply", "Remind regardless", "Schedule here" (availability link text), "Set a reminder", "Report spam", "Report phishing".

Empty-state and toast wording: **not documented** [?]. Suggested (invented, keep clearly in Notion's calm, sentence-case voice) [I]: "Inbox zero" style: "You're all caught up." Toasts: "Conversation archived. Undo", "Moved to trash. Undo", "Reminder set for Tue, 9:00 AM", "Message sent. Undo".

---

## 7. Gaps and how to close them
1. No pixel-level data: if Notion Mail still runs tonight, open mail.notion.com and take screenshots plus DevTools computed styles (sidebar width, row heights, font stack, chip colors, dark tokens). The web app is a Notion-style React app, so its CSS variables will mirror Notion.so.
2. Compose window geometry, exact slash-menu block list, undo-send behavior, reminder presets and empty-state text remain unverified.
3. Do not implement Notion workspace features (push to Notion, `@` page mentions, Mail blocks, database properties beyond simple label/status chips).

## Sources
- notion.com/help/notion-mail-keyboard-shortcuts
- notion.com/help/navigate-your-inbox
- notion.com/help/notion-mail-settings
- notion.com/help/get-started-with-notion-mail
- notion.com/help/views-groups-filters-and-properties
- notion.com/help/compose-an-email
- notion.com/help/notion-mail-for-mobile
- notion.com/help/notion-mail-inbox-is-going-away-what-to-do-next
- notion.com/releases/2025-04-15 ; notion.com/blog/introducing-notion-mail
- zapier.com/blog/notion-mail ; matthiasfrank.de/en/notion-features/notion-mail ; thomasjfrank.com/notion-mail-is-notions-new-email-app-for-you ; templatesfornotion.com/blog/notion-mail-tutorial-2025 ; appsntips.com/first-look-at-notion-mail ; simonesmerilli.com/life/notion-mail-features ; engadget.com (Notion Mail lightweight email client)
- matthiasfrank.de/en/notion-colors ; designmd.cc/benchmarks/notion ; notion.com/help/keyboard-shortcuts (editor markdown shortcuts)
