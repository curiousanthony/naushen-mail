# Block model → email HTML contract

Composer documents are TipTap/ProseMirror JSON (stored in `Draft.doc`). Sending serialises to **email-safe HTML**
(`serializeToEmailHtml(doc, opts) -> { html, text }` in `src/shared/emailhtml/`). Email clients strip `<style>`, ignore
JS, and disagree about CSS, so: **inline styles only, table-based layout for anything structural, system font stack,
no external assets, always a text/plain alternative.**

| Block | `/` aliases | Markdown | Email HTML | Round-trips? |
|---|---|---|---|---|
| Text | text, p | – | `<p style="margin:0 0 12px">` | ✔ |
| Heading 1–3 | h1 h2 h3 | `#` `##` `###` | `<h1..3>` inline sized/weighted | ✔ |
| Bulleted list | bullet, ul | `- ` `* ` | `<ul>` with inline margins | ✔ |
| Numbered list | numbered, ol | `1. ` | `<ol>` | ✔ |
| To-do | todo, checkbox, `[]` | `[] ` | `<p>` prefixed with `☐`/`☑` (checkboxes can't be interactive) | degrades |
| Toggle | toggle | – (see note) | flattened: bold summary line + indented children | degrades |
| Quote | quote | `" ` or `> ` | `<blockquote>` with left border inline | ✔ |
| Divider | divider, `---` | `---` | `<hr>` inline styled | ✔ |
| Callout | callout | – | 1×1 `<table>` with tinted `bgcolor`, emoji cell | ✔ |
| Code block | code | ``` | `<pre>` monospace, grey bg, inline styles (no highlighting) | ✔ |
| Table | table | – | real `<table>` with cell borders | ✔ |
| Image | image | paste/drop | `<img>` as inline `cid:` attachment (max-width 100%) | ✔ |
| Link | `cmd+k` | `[t](u)` | `<a>` | ✔ |
| Emoji | `:name` | – | unicode | ✔ |
| Text/background colour | red, blue… | – | inline `color` / `background-color` | ✔ |
| Snippet | `/<snippet name>` | – | expands inline into blocks | ✔ |

Notes: `> ` makes a **quote** (standard markdown, bound by StarterKit); a toggle has no markdown trigger —
use `/toggle` or `⌥⌘7`. Strikethrough accepts both `~s~` and `~~s~~`. Inline images are stored in the document as
`data:` URIs and rewritten to `cid:` references by `serializeToEmailHtml`, which returns them in `inlineImages`;
the composer appends those to `OutgoingMessage.attachments` as `{ inline: true, contentId }` — nothing else in the
app deals with content-ids.

Rules: escape all text; whitelist URL schemes (`http https mailto tel`); wrap in a 100%-wide container `<div>` (max 640px);
signature appended after a spacer; reply quoting appended as `<blockquote type="cite">` with attribution line
("On <date>, <name> wrote:"). Text alternative: blocks → plain text with `- `, `1.`, `[ ]`, `> ` conventions.
