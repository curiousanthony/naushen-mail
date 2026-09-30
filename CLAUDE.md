# Naushen Mail — agent notes

Electron + React + TypeScript mail client (Notion-Mail ergonomics; no AI). Cross-platform: macOS, Windows, Linux. Gmail is live; Outlook is implemented but hidden behind `OUTLOOK_ENABLED` (`src/shared/features.ts`). Public repo: github.com/curiousanthony/naushen-mail (leave the remotes alone). Read `docs/00-decisions.md` first.

License: Functional Source License FSL-1.1-ALv2 (source-available, not OSI open source). Keep the `LICENSE` file and do not add code under an incompatible license.

## Commands
- `npm run dev` — dev app (HMR). `npm run build` — bundle to `out/`. `npm run typecheck`. `npm test`.
- Run built app headless + screenshot (no permissions needed):
  ```
  npm run build && MAILROOM_USER_DATA=/tmp/mr-$$ MAILROOM_DEMO=1 MAILROOM_SIZE=1280x820 \
    MAILROOM_SHOT=/tmp/shot.png ./node_modules/.bin/electron .
  ```
  Multi-step: `MAILROOM_STEPS='[{"exec":"document.querySelector(\"button\").click()","wait":600,"shot":"/tmp/a.png"}]'`.
  `exec` runs JS in the renderer; read PNGs with the Read tool. `MAILROOM_DEMO=1` adds two mock accounts on first launch.
- Docs: `README.md`, `docs/install.md` (end users), `docs/building.md`, `docs/maintainers.md` (releases, secrets, Google verification), `docs/i18n.md`. Release = tag `vX.Y.Z`. Keep `CHANGELOG.md` updated.
- Renderer talks to main only via `window.api.invoke('ns.method', …)` (contract: `src/shared/api.ts`).

## Rules
- **i18n: no hard-coded UI strings.** Use `t()` (`mt()` in main), add English keys in `src/locales/en/`; all 9 locales must keep the same keys (`npm test` checks). See `docs/i18n.md`.
- Do not assume macOS: check `process.platform`; `mod` = Cmd on macOS, Ctrl elsewhere.
- Colours only via CSS tokens (`src/renderer/styles/tokens.css`). Components in `src/renderer/features/<feature>/`.
- Renderer imports: `@/…` = `src/renderer`, `@shared/…` = `src/shared`.
- The UI reads the SQLite store and acts optimistically; providers are behind `ProviderAdapter`.
- Email HTML is untrusted: sanitise + sandboxed iframe. Never log tokens. No secrets in the repo.
- No AI features, no Notion accounts/workspace/database concepts, no Notion logos/fonts.
- `MAILROOM_*` env var names and the `mailroom.db` file name are internal legacy names and stay; user-facing branding is "Naushen Mail" only.
