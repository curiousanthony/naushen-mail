# Contributing to Naushen Mail

Thanks for helping! By contributing you agree your work is licensed under the project's [FSL-1.1-ALv2](LICENSE) terms.
Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Set up
```bash
git clone https://github.com/curiousanthony/naushen-mail.git
cd naushen-mail
npm install          # Node.js 24
npm run dev          # app with hot reload
```
Use **Settings, Accounts, Add account, Demo** for sample mail; you do not need a Google account to work on the UI.
Read [docs/00-decisions.md](docs/00-decisions.md) first, then [docs/03-design-system.md](docs/03-design-system.md) if you touch UI.

## Before opening a PR
```bash
npm run typecheck && npm test && npm run build
```
CI runs the same checks. For UI changes, run the app headless and look at the result ([docs/building.md](docs/building.md#headless-run-and-screenshot));
attach a screenshot to the PR.

## Conventions
- **No hard-coded UI strings.** Use `t()` from react-i18next (`mt()` in the main process) and add the English key under
  `src/locales/en/`. See [docs/i18n.md](docs/i18n.md), which also explains how to add or fix a language.
- **Colours only via CSS tokens** in `src/renderer/styles/tokens.css`, so dark mode works.
- Components live in `src/renderer/features/<feature>/`. Imports: `@/` = `src/renderer`, `@shared/` = `src/shared`.
- The renderer talks to the main process only through `window.api.invoke` (contract in `src/shared/api.ts`).
- Providers sit behind `ProviderAdapter`; the UI reads the local SQLite store and acts optimistically.
- Email HTML is untrusted: sanitise it and render in the sandboxed iframe. Never log tokens; never commit secrets.
- Project scope: no AI features, no Notion accounts/workspaces, no Notion logos or fonts.
- Cross-platform: don't assume macOS. Check `process.platform` where behaviour differs.
- Tests use Vitest (`tests/`); add tests for store, serializer, adapter and pure-logic changes.

## Parallel work (worktrees / "swarm")
This repo is often developed by several agents or people at once. Rules of thumb:
- One feature per branch (`feat/<name>`), in its own `git worktree`. Keep to a **disjoint set of files**; propose changes to shared
  contracts (`src/shared/`) in the PR description rather than editing them casually.
- Don't commit `package-lock.json` churn unrelated to your change; list new dependencies in the PR.
- Merge into an integration branch first and re-run typecheck, tests and a build: several bugs have only appeared after merging branches.
- Never touch git remotes or force-push shared branches.

## Reporting bugs and ideas
Use [GitHub issues](https://github.com/curiousanthony/naushen-mail/issues). Include OS, app version and steps to reproduce; never paste tokens or private mail.
Security problems: see [SECURITY.md](SECURITY.md), not a public issue.
