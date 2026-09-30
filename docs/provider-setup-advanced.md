# Advanced: use your own Google or Microsoft OAuth client

> **Most people do not need this.** Official release builds ship with a Google OAuth client and you just click **Sign in with
> Google**. This guide is for people who **build from source** or want to run with their **own** cloud project, so their
> mail access never goes through the project's OAuth app.

Naushen Mail has no backend, so a self-built copy needs OAuth credentials that you own. Nothing here is billed. Paste the IDs
into **Settings, Accounts, OAuth setup**; they are stored locally and only ever sent to Google or Microsoft. Use the **Demo**
account to explore first.

## Google (Gmail), about 10 minutes
1. <https://console.cloud.google.com>, **New Project** (for example "Naushen Mail").
2. **APIs & Services, Library**: enable **Gmail API**.
3. **Google Auth Platform, Get started**: app name, your email, audience **External**.
4. **Data Access, Add scopes**: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `.../auth/gmail.modify`
   (`gmail.modify` covers send, drafts and labels).
5. **Audience, Test users, Add users**: your own Gmail address(es). **Leave the app in Testing.**
   `gmail.modify` is a Google *restricted* scope. In Testing status, refresh tokens expire after about **7 days**, so you will
   click **Reauthorize** in Settings, Accounts now and then (a quick Google sign-in). You will also see "Google hasn't verified
   this app": click **Advanced, Go to Naushen Mail**. Publishing does not avoid this for a restricted scope; see
   [maintainers.md](maintainers.md#google-oauth-verification).
6. **Clients, Create client, Desktop app**: copy the **Client ID** and **Client secret** into Naushen Mail. For desktop apps
   Google treats the secret as non-confidential, but its token endpoint still requires it.

(These limits come from Google's documentation and may change; check the current docs.)

## Microsoft (Outlook.com / Microsoft 365)

> Outlook support is implemented but **hidden in the app** until a Microsoft app registration exists for official builds
> (`OUTLOOK_ENABLED` in `src/shared/features.ts`). The steps below are for developers working on that adapter.

1. <https://entra.microsoft.com>, **App registrations, New registration**.
2. Name "Naushen Mail"; supported account types: **any organizational directory and personal Microsoft accounts**.
3. Redirect URI: platform **Public client / native (mobile & desktop)**, value `http://localhost`.
4. Copy the **Application (client) ID** into Naushen Mail.
5. **Authentication, Allow public client flows = Yes**.
6. **API permissions, Add, Microsoft Graph, Delegated**: `Mail.ReadWrite`, `Mail.Send`, `MailboxSettings.ReadWrite`, `User.Read`,
   `offline_access`, `openid`, `profile`, `email`.
7. Do **not** create a client secret (public client with PKCE). Work or school tenants may require admin consent.

## Notes
- Tokens are encrypted with the OS secure store (Electron `safeStorage`). On macOS, ad-hoc-signed rebuilds change the app
  identity, so the Keychain may re-prompt after a rebuild.
- Provider API details and caveats: [research/02-provider-apis-and-electron.md](research/02-provider-apis-and-electron.md).
