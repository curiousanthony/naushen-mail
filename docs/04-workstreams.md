# Parallel workstreams

Foundation lives on `main` (contracts: `src/shared/types.ts`, `src/shared/api.ts`, `ProviderAdapter`, store, IPC, UI store, design tokens).
Each workstream is a feature branch that owns a **disjoint file tree** and is delivered as a PR.

| Branch | Owns | Depends on |
|---|---|---|
| `feat/sidebar-list` | `src/renderer/features/{sidebar,threadlist}/**` | store, tokens |
| `feat/reader` | `src/renderer/features/reader/**`, `src/shared/sanitize/**` | store, compose (calls `openComposer`) |
| `feat/compose-blocks` | `src/renderer/features/compose/**`, `src/shared/emailhtml/**`, `src/main/mime/**` | `OutgoingMessage` |
| `feat/commands-shortcuts` | `src/renderer/features/commands/**` (palette, toasts, shortcuts, snooze/label pickers) | store |
| `feat/settings-accounts` | `src/renderer/features/settings/**` | `accounts.*`, `settings.*` API |
| `feat/provider-gmail` | `src/main/providers/gmail/**` | `ProviderAdapter`, `main/auth/*` |
| `feat/provider-outlook` | `src/main/providers/outlook/**` | `ProviderAdapter`, `main/auth/*` |
| `feat/packaging` | `electron-builder.yml`, `build/**`, `scripts/**`, `resources/**`, `docs/install.md` | – |

Rules: don't edit files outside your tree (propose contract changes in the PR body); don't commit `package-lock.json`
changes (list new deps in the PR); verify with `npm run typecheck && npm test`, and UI with the screenshot hook
(`src/main/e2e.ts`; see CLAUDE.md).
