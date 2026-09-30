# Building Naushen Mail from source

## Requirements
- Node.js 24 and npm (`node -v`).
- macOS packaging additionally needs the Xcode Command Line Tools (`xcode-select --install`) for `codesign`, `sips` and `iconutil`.
- Windows and Linux installers are normally built by the release workflow (see [maintainers.md](maintainers.md)); building them locally
  needs the matching OS (or a container) and network access to download Electron.

## Develop
```bash
git clone https://github.com/curiousanthony/naushen-mail.git
cd naushen-mail
npm install
npm run dev          # Electron + Vite with hot reload
```
Other scripts: `npm run build` (bundle to `out/`), `npm run typecheck`, `npm test`.

Pick **Settings, Accounts, Add account, Demo** to explore with sample mail. To sign in with a real Gmail account from a
source build you need OAuth credentials: see [provider-setup-advanced.md](provider-setup-advanced.md).

## Package
| Command | Output | Notes |
|---|---|---|
| `npm run pack` | `release/mac-arm64/Naushen Mail.app` | Unpacked macOS app, ad-hoc signed. Fastest way to test packaging |
| `npm run dist` | `release/` installers | macOS `.dmg` and `.zip` for arm64 and x64 (see `electron-builder.yml`; Windows and Linux targets are configured there too if present) |
| `scripts/dev-install.sh` | `/Applications/Naushen Mail.app` | macOS only: build, ad-hoc sign, install, clear quarantine. `DEST=~/Applications` to change target |
| `node scripts/make-icon.mjs` | `build/icon.*` | Regenerates the icon from the SVG (macOS tools required) |

`release/` and `out/` are git-ignored. Building a single macOS architecture: `npx electron-builder --mac --arm64` (or `--x64`).

## Headless run and screenshot
Used for verification and for the README screenshots. No permissions needed:
```bash
npm run build && MAILROOM_USER_DATA=/tmp/mr-$$ MAILROOM_DEMO=1 MAILROOM_SIZE=1280x820 \
  MAILROOM_SHOT=/tmp/shot.png ./node_modules/.bin/electron .
```
`MAILROOM_STEPS` takes a JSON list of `{exec, wait, shot}` steps (`exec` runs JS in the renderer). The `MAILROOM_*`
variable names are internal and unchanged from the project's earlier name. See the header of `src/main/e2e.ts`.

## Signing and notarisation (optional)
Unsigned or ad-hoc-signed builds work but trigger OS warnings. `scripts/adhoc-sign.cjs` steps aside when `CSC_LINK` or `CSC_NAME`
is set. Required secrets are listed in [maintainers.md](maintainers.md#github-secrets).

## Troubleshooting
| Symptom | Fix |
|---|---|
| `npm run dist` fails downloading Electron | Needs network access to GitHub releases |
| electron-builder logs `cannot find path for dependency` | Happens only in a git worktree whose `node_modules` is a symlink; harmless |
| Blank window on start | Run the binary from a terminal to see main-process errors |
| Keychain prompts after rebuilding (macOS) | Ad-hoc signatures differ per build; choose **Always Allow** |
