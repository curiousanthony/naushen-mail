# Connecting Gmail and Outlook (one-time setup, ~10 min each)

Naushen Mail has no backend, so **you own the OAuth apps**. Nothing here is billed. Paste the IDs into
**Settings → Accounts → OAuth setup**; they are stored locally, never sent anywhere but Google/Microsoft.
(Use the **Demo** account to explore the app before doing this.)

## Google (Gmail)
1. <https://console.cloud.google.com> → **New Project** (e.g. "Naushen Mail").
2. **APIs & Services → Library** → enable **Gmail API**.
3. **Google Auth Platform → Get started** → app name "Naushen Mail", your email, audience **External**.
4. **Data Access → Add scopes**: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `.../auth/gmail.modify`
   (`gmail.modify` already covers send, drafts and labels).
5. **Audience → Test users → Add users** → your own Gmail address(es). **Leave the app in *Testing* — do not Publish.**
   `gmail.modify` is a Google **restricted** scope; removing the 7-day refresh-token expiry requires full
   verification, including a paid third-party security audit (CASA) — meant for real multi-user products, not a
   personal app. Google's own guidance for personal/known-users apps is to stay in Testing. The tradeoff: your
   refresh token expires roughly every **7 days**, so you'll occasionally click **Reauthorize** in
   Settings → Accounts (a quick Google sign-in, not a redo of this setup). You'll also see a one-time
   "Google hasn't verified this app" screen on each sign-in — click **Advanced → Go to Naushen Mail**.
6. **Clients → Create client → Desktop app** → copy **Client ID** and **Client secret** into Naushen Mail
   (for desktop apps Google treats the secret as non-confidential; it is still required by the token endpoint).

## Microsoft (Outlook.com / Microsoft 365)
1. <https://entra.microsoft.com> → **App registrations → New registration**.
2. Name "Naushen Mail"; supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
3. Redirect URI: platform **Public client/native (mobile & desktop)**, value `http://localhost`.
4. Copy the **Application (client) ID** into Naushen Mail.
5. **Authentication → Allow public client flows = Yes**.
6. **API permissions → Add → Microsoft Graph → Delegated**: `Mail.ReadWrite`, `Mail.Send`, `MailboxSettings.ReadWrite`,
   `User.Read`, `offline_access`, `openid`, `profile`, `email`.
7. Do **not** create a client secret (public client + PKCE).
   Work/school tenants may require admin consent for some permissions; personal accounts do not.

## Notes
* Tokens are encrypted with the macOS Keychain (Electron `safeStorage`). Ad-hoc-signed rebuilds change the app's
  code identity, so macOS may re-prompt for Keychain access after you rebuild — expected.
* Full API details and caveats: `docs/research/02-provider-apis-and-electron.md`.
