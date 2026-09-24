# Design system (Notion-style, brand-free)

Source of truth: `src/renderer/styles/tokens.css`. Values are Notion's general design language (see research §2);
tune against real screenshots if any become available. **Never hard-code colours** — use tokens, so dark mode is free.

* **Type**: system UI stack (`-apple-system` → SF Pro). Base 14/1.5. List sender/subject 14; time/snippet 12–13 muted.
  Thread subject 24–28/600. Body 14–15. No custom font files.
* **Colour**: text `#37352F`, sidebar `#F7F7F5`, hover `rgba(55,53,47,.06)`, divider `rgba(55,53,47,.09)`, accent `#2383E2`.
  Dark: bg `#191919`, sidebar `#202020`, text `rgba(255,255,255,.81)`. Theme = system/light/dark via `nativeTheme.themeSource`.
* **Label chips** use the 9 Notion colours (`--chip-<color>-fg/-bg`): gray brown orange yellow green blue purple pink red.
* **Shape**: radius 4 (chips) / 6 (buttons, rows, inputs) / 10 (popovers) / 12 (peek). Rows are separated by whitespace
  and hover fills, not borders. Hairlines only where structure needs it.
* **Density**: sidebar row 28px; list row ~40px (comfortable) / 32px (compact); group headers 12px muted.
* **Motion**: 120ms hover fill; menus fade+scale 100–150ms; side peek slides 200ms ease-out. Respect `prefers-reduced-motion`.
* **Chrome**: `titleBarStyle: hiddenInset`, traffic lights at (16,16), sidebar under the titlebar with `-webkit-app-region: drag`
  across the top 40px; interactive children `no-drag`.
* **Icons**: lucide, 16px in rows / 18px in toolbars, stroke 1.5.
* **Selection**: selected/open row `--c-bg-selected`; keyboard cursor = hover fill + 2px left accent bar.
* **Shadows**: popover `--shadow-popover`, peek `--shadow-peek`.
* **Microcopy**: sentence case, calm. Toasts: "Conversation archived", "Moved to trash", "Reminder set for Tue, 9:00 AM", "Message sent" + Undo.
  Empty inbox: "You're all caught up."

## Addendum: motion, elevation, density, accent (design-polish)

* **Motion tokens** (`tokens.css`): `--ease-out` (decelerating default), `--ease-spring` (tiny overshoot: toasts, checkbox, unread dot,
  swatches), `--ease-in` (exits); `--dur-1..4` = 120 / 160 / 200 / 220ms. `--t-fast` / `--t-med` are kept as shorthand
  (`duration easing`) built from them. Popovers scale in from `--pop-origin` (default top left); the palette drops in 8px;
  the toast rises with a spring and leaves with `--ease-in`. Rows that stay glide into place when a thread is archived or arrives
  (`threadlist/useListFlip.ts`, WAAPI transform only, 200ms, skipped on mailbox switch, when windowed, or under reduced motion).
  `global.css` collapses every animation and transition to 1ms under `prefers-reduced-motion` (1ms, not `none`, so `animationend` still fires).
* **Elevation ladder** (dark surfaces get lighter as they rise): base `--c-bg` < `--c-bg-sidebar` < `--c-bg-raised` (side peek, composer,
  settings, message body) < `--c-bg-popover` (menus, palette, pickers) < toast (`--c-bg-inverse`). Light mode keeps raised/popover white and
  uses shadow. Dark shadows add a 1px lighter outline and an inset top highlight (`--c-highlight`). Scrims are `--c-scrim` / `--c-scrim-strong`.
* **Hairlines**: `--hairline` is 1px, 0.5px at >= 2dppx. Use `var(--hairline) solid var(--c-divider)` for structural lines.
* **Density**: `data-density="comfortable|compact"` is mirrored onto `<html>` (`settings/lib/appearance.ts`); overrides live in `styles/density.css`
  (`--sb-row-h` 30 / 26, `--sb-sec-gap`, `--msg-pad-y`, list type 13.5 / 13, avatar 22 / 18). Thread-list row heights (44 / 32) stay in
  `threadlist.css` and must match `DENSITY` in `threadlist/index.tsx`, because windowing maths uses those numbers.
* **Accent**: `data-accent` on `<html>` (blue is the default and needs none): violet, pink, orange, green, teal, neutral (`styles/accents.css`).
  Only `--c-accent` (+ `--c-accent-text` where white would fail) is set per swatch and per colour scheme; hover, selection tint, focus ring,
  `::selection`, unread dot and the sidebar's active icon are derived with `color-mix()` in `tokens.css`. Persisted as `accent` through
  `settings-ext.ts` (same `settings.set` path as `threadStyle`).
* **Type / detail**: `-apple-system` first so macOS switches SF Text / Display by optical size; `text-rendering: optimizeLegibility`; tabular
  numerals on times, counts and badges; thread subject 24px / -0.021em; `--c-text-2/-3` raised to keep secondary text readable in both themes;
  keyboard focus is an accent ring (`:focus-visible`), the list cursor is a faint fill plus a 2px bar (hover is a stronger fill, no bar);
  thin overlay scrollbars that appear on hover.
* **Empty states**: Inbox zero draws a low sun (moon after dark) over two hills from tokens, with a line chosen by time of day
  (`threadlist/emptyLines.ts`, two per period, stable within a day). Other mailboxes get a quiet glyph; search adds a hint. The loading
  skeleton is a slow shimmer.
