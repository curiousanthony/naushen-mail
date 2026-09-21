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
