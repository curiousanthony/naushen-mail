# Mailroom — agent notes

Electron + React + TypeScript mail client (Notion-Mail ergonomics; Gmail + Outlook; no AI). Read `docs/00-decisions.md` first.

## Commands
- `npm run dev` — dev app (HMR). `npm run build` — bundle to `out/`. `npm run typecheck`. `npm test`.
- Run built app headless + screenshot (no permissions needed):
  ```
  npm run build && MAILROOM_USER_DATA=/tmp/mr-$$ MAILROOM_DEMO=1 MAILROOM_SIZE=1280x820 \
    MAILROOM_SHOT=/tmp/shot.png ./node_modules/.bin/electron .
  ```
  Multi-step: `MAILROOM_STEPS='[{"exec":"document.querySelector(\"button\").click()","wait":600,"shot":"/tmp/a.png"}]'`.
  `exec` runs JS in the renderer; read PNGs with the Read tool. `MAILROOM_DEMO=1` adds two mock accounts on first launch.
- Renderer talks to main only via `window.api.invoke('ns.method', …)` (contract: `src/shared/api.ts`).

## Rules
- Colours only via CSS tokens (`src/renderer/styles/tokens.css`). Components in `src/renderer/features/<feature>/`.
- Renderer imports: `@/…` = `src/renderer`, `@shared/…` = `src/shared`.
- The UI reads the SQLite store and acts optimistically; providers are behind `ProviderAdapter`.
- Email HTML is untrusted: sanitise + sandboxed iframe. Never log tokens. No secrets in the repo.
- No AI features, no Notion accounts/workspace/database concepts, no Notion logos/fonts.
