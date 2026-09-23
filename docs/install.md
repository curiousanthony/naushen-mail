# Installing Naushen Mail on macOS

Naushen Mail is a personal-use app: it is **ad-hoc signed** (no Apple Developer ID, no notarisation). That is enough to run
on your own Mac, but Gatekeeper will complain about copies that were downloaded or AirDropped (see below).

## Requirements
- macOS 12 or later, Apple Silicon or Intel
- Node.js 24 and npm (`node -v`), Xcode Command Line Tools (`xcode-select --install`) for `codesign`, `sips`, `iconutil`

## 1. Quick install (recommended for your own Mac)
```bash
npm install
scripts/dev-install.sh        # builds, ad-hoc signs, copies to /Applications, clears the quarantine flag
open -a "Naushen Mail"
```
`DEST=~/Applications scripts/dev-install.sh` installs somewhere else. The script uses `ditto` and never prompts; it quits
a running Naushen Mail first.

## 2. Build artefacts by hand
| Command | Output | Notes |
|---|---|---|
| `npm run pack` | `release/mac-arm64/Naushen Mail.app` | Unpacked `.app` for this arch, ~10 s after the first Electron download. Fastest way to test packaging |
| `npm run dist` | `release/Naushen Mail-<version>-{arm64,x64}.{dmg,zip}` | Both architectures. The first run downloads Electron for each arch and the DMG tooling, so it needs network access |
| `node scripts/make-icon.mjs` | `build/icon.{svg,png,icns}` | Regenerates the app icon (uses the repo's Electron to rasterise the SVG, then `sips` + `iconutil`). The results are committed; you only need this when changing the artwork |

`release/` is git-ignored. To build a single architecture: `npx electron-builder --mac --arm64` (or `--x64`).

Smoke-test a packaged build without touching your real data (isolated profile, demo accounts, screenshot, then quit):
```bash
MAILROOM_USER_DATA=$(mktemp -d) MAILROOM_DEMO=1 MAILROOM_SIZE=1280x820 MAILROOM_SHOT=/tmp/packaged.png \
  release/mac-arm64/"Naushen Mail".app/Contents/MacOS/"Naushen Mail"
```

## 3. Gatekeeper ("Naushen Mail can't be opened")
Apps you build and install locally with `dev-install.sh` open normally. A `.dmg`/`.zip` that has been *downloaded*
(browser, AirDrop, Messages) carries the `com.apple.quarantine` attribute and macOS refuses an app that is not notarised.
Either:
- **Right-click the app in `/Applications` -> Open -> Open** (once). On macOS 15+ if only "Done" is offered, open
  *System Settings -> Privacy & Security*, scroll to the message about Naushen Mail and click **Open Anyway**; or
- strip the quarantine flag:
  ```bash
  xattr -dr com.apple.quarantine "/Applications/Naushen Mail.app"
  ```

## 4. Keychain prompts after rebuilding
OAuth tokens are encrypted with Electron `safeStorage`, whose key lives in your login Keychain under
**"Naushen Mail Safe Storage"**. An ad-hoc signature is different for every build, so after installing a new build macOS may
ask *"Naushen Mail wants to use your confidential information stored in 'Naushen Mail Safe Storage'"*. Enter your login password
and choose **Always Allow**. If you click Deny, tokens cannot be decrypted and accounts must be reconnected. Signing every
build with the same Developer ID (section 6) makes the prompt go away for good.

## 5. Using Naushen Mail as the default mail app (`mailto:`)
The app bundle registers the `mailto` URL scheme (`CFBundleURLTypes` in `electron-builder.yml`), so Naushen Mail shows up as a
choice for the default mail handler once it has been installed in `/Applications`:

1. Open Apple Mail -> Settings -> General -> **Default email reader** and choose Naushen Mail
   (Mail must have been launched once; alternatively use a tool such as `duti -s com.anthony.naushenmail mailto`).
2. Clicking a `mailto:` link then launches / focuses Naushen Mail with a composer prefilled from the link's
   `to`/`cc`/`bcc`/`subject` (handled by `app.on('open-url', …)` in `src/main/index.ts`; the URL is queued if it
   arrives before the window exists, e.g. on a cold launch).

**Known gap:** a second `mailto:` click while the app is already running opens a fresh composer in the same window
(correct), but two separate app launches would each create their own process — there is no
`app.requestSingleInstanceLock()` yet. Low-impact for personal use; worth adding if this becomes the default handler
on a machine where mailto links arrive often.

## 6. Optional: real signing and notarisation
Needs a paid Apple Developer account and a *Developer ID Application* certificate. The ad-hoc hook
(`scripts/adhoc-sign.cjs`) steps aside automatically when `CSC_LINK` or `CSC_NAME` is set. To enable it:

1. In `electron-builder.yml` remove `identity: null`, set `hardenedRuntime: true` and add `notarize: true` under `mac`.
   `build/entitlements.mac.plist` already grants the entitlements Electron needs (JIT, unsigned executable memory).
2. Export the credentials (never commit them):
   ```bash
   export CSC_LINK=/path/to/DeveloperID.p12          # or CSC_NAME="Developer ID Application: Your Name (TEAMID)"
   export CSC_KEY_PASSWORD=...                       # password of the .p12
   export APPLE_ID=you@example.com
   export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx   # appleid.apple.com -> App-Specific Passwords
   export APPLE_TEAM_ID=ABCDE12345
   npm run dist
   ```
   (An App Store Connect API key via `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` also works.)

## 7. Troubleshooting
| Symptom | Fix |
|---|---|
| "Naushen Mail is damaged and can't be opened" | Quarantine flag on an ad-hoc build: `xattr -dr com.apple.quarantine "/Applications/Naushen Mail.app"` |
| App quits immediately on Apple Silicon | The bundle lost its signature (e.g. copied with a tool that strips xattrs). Re-sign: `codesign --force --deep --sign - "/Applications/Naushen Mail.app"` |
| Wrong-architecture DMG ("not supported on this Mac") | Use the `arm64` build on Apple Silicon, `x64` on Intel (`uname -m`) |
| `npm run dist` fails downloading Electron / `dmgbuild` | Needs network access to GitHub releases. `npm run pack` and `dev-install.sh` only need the Electron zip, which is cached in `~/Library/Caches/electron` after the first download |
| electron-builder logs `cannot find path for dependency` | Only happens in a git worktree whose `node_modules` is a symlink; the files are still packaged. Run from a normal checkout with a real `node_modules` to silence it |
| Blank window / crash on start | Run the binary from a terminal (`"/Applications/Naushen Mail.app/Contents/MacOS/Naushen Mail"`) to see main-process errors. Data lives in `"~/Library/Application Support/Naushen Mail"` |
| Keychain asks for a password repeatedly | See section 4; choose **Always Allow** |
| Start over with a clean profile | Quit the app, then `rm -rf "~/Library/Application Support/Naushen Mail"` (this deletes the local mail cache and stored tokens) |
