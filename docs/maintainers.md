# Maintainer guide

For the project owner and release managers.

## Cutting a release
1. Update `CHANGELOG.md` (move items from *Unreleased* to a new version heading) and bump `version` in `package.json`.
2. Merge to `main` with CI green.
3. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. The **release workflow** (`.github/workflows/`, triggered by `v*` tags) builds macOS, Windows and Linux installers and attaches
   them to a GitHub Release. Artifact names: `Naushen-Mail-<version>-mac-arm64.dmg`, `-mac-x64.dmg`,
   `Naushen-Mail-<version>-<arch>-Setup.exe`, plus AppImage and deb for Linux.
5. Edit the release notes (copy from the changelog) and mark it as the latest release.

Each release converts to Apache-2.0 two years after its publication date (see [LICENSE](../LICENSE)); there is nothing to do,
but do not delete old tags or releases.

## GitHub secrets
Set under *Settings, Secrets and variables, Actions*.

| Secret | Required | Purpose |
|---|---|---|
| `MAIN_VITE_GOOGLE_CLIENT_ID` | only for a built-in client (optional) | Google OAuth desktop client ID baked into builds; leave unset so users bring their own |
| `MAIN_VITE_GOOGLE_CLIENT_SECRET` | only for a built-in client (optional) | Its (non-confidential for desktop apps, but required) client secret |
| `CSC_LINK` | optional | macOS Developer ID certificate (`.p12`, base64 or URL) for signing |
| `CSC_KEY_PASSWORD` | optional | Password of that certificate |
| `APPLE_ID` | optional | Apple ID used for notarisation |
| `APPLE_APP_SPECIFIC_PASSWORD` | optional | App-specific password for that Apple ID |
| `APPLE_TEAM_ID` | optional | Apple Developer Team ID |
| `WIN_CSC_LINK` | optional | Windows code-signing certificate |
| `WIN_CSC_KEY_PASSWORD` | optional | Password of that certificate |

Without the signing secrets, builds are unsigned (macOS ad-hoc) and users see Gatekeeper / SmartScreen warnings (documented in
[install.md](install.md)). Never commit these values. Anything embedded in a shipped app can be extracted, which is why only
the desktop client ID/secret (which Google documents as non-confidential for installed apps) belongs in the build.

## Appendix (optional): built-in Google client and Google verification

The public path is **bring your own Google OAuth client** ([google-setup.md](google-setup.md)); the project does **not** pay for
Google verification. Everything below is optional and only relevant if the owner later decides to ship a built-in client
(`MAIN_VITE_GOOGLE_CLIENT_ID` / `MAIN_VITE_GOOGLE_CLIENT_SECRET`, see `.env.example`) and pursue verification.

### Google OAuth verification

> Everything in this section is taken from Google's documentation as understood when this was written. **Re-check the current
> Google docs before applying**; limits, wording and fees change.

Naushen Mail requests `gmail.modify`, a **restricted** scope (any scope that reads mail content is restricted). Consequences:

| Consent screen status | What happens |
|---|---|
| **Testing** | Capped at 100 test users. Refresh tokens expire after 7 days, so users must re-authorise weekly |
| **In production, unverified** | A lifetime cap of 100 users and a big "Google hasn't verified this app" warning |
| **In production, verified** | No cap, no warning, no 7-day expiry |

To become verified you generally need:
1. **Brand verification / OAuth verification** of the app: a public homepage on a domain you control (see [index.md](index.md), for
   example via GitHub Pages or a custom domain), a public **privacy policy URL** ([PRIVACY.md](PRIVACY.md) is written for this),
   justification for each scope, and a **demo video** showing the OAuth flow and how each scope is used.
2. A **security assessment (CASA, Cloud Application Security Assessment)** performed by a Google-approved third party, repeated
   **annually**, because the scope is restricted. Fees are set by the assessor, not Google: **check current pricing** with the
   approved assessors before committing. Local-only apps that never send data to a server may qualify for a lighter path; ask
   Google and the assessor.
3. The app must comply with the Google API Services User Data Policy, including Limited Use (see PRIVACY.md).

If pursued: keep the OAuth consent screen accurate, keep the privacy policy URL live, and tell users in the README that a warning
is expected (it is).

## Microsoft (Outlook)
Outlook support is implemented but hidden by `OUTLOOK_ENABLED` in `src/shared/features.ts`. To enable it: create a Microsoft Entra
app registration (public client, PKCE, redirect `http://localhost`, scopes in [google-setup.md](google-setup.md)),
wire its client ID into the build, complete publisher verification if required, then flip the flag and update the README.

## GitHub Pages
`docs/index.md` can serve as the homepage (Settings, Pages, deploy from `main` `/docs`), giving a stable public URL for the
Google verification and a privacy policy link at `.../PRIVACY`.
