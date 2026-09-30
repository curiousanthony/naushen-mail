# Connect your Gmail account (one-time setup, about 10 minutes)

Naushen Mail has no server and the project does not pay for Google's app verification. So Gmail sign-in needs a **one-time
personal Google setup**: you create a small, free OAuth client in your own Google Cloud project and paste two values into the
app. After that, sign-in works as usual. The credentials are stored on your computer only and are sent to nobody but Google.
No billing account or credit card is needed. The in-app wizard (**Settings, Accounts, Add account, Gmail**) walks through the
same steps and has copy buttons.

> Want to look around first? Add the **Demo** account (Settings, Accounts, Add account, Demo); no setup needed.
>
> Coming later: IMAP / app-password accounts (no Google Cloud needed) and Outlook. See the [roadmap](../README.md#roadmap).

Google's console wording changes from time to time; if a label differs slightly, follow the closest match.

## Steps
1. **Create a project.** Open <https://console.cloud.google.com>, sign in with the Google account you want to read mail from,
   click the project picker, then **New Project**. Name it "Naushen Mail" and create it.
2. **Enable the Gmail API.** Menu, **APIs & Services, Library**, search "Gmail API", click **Enable**.
3. **Set up the consent screen.** Menu, **Google Auth Platform** (or **APIs & Services, OAuth consent screen**), **Get started**.
   App name "Naushen Mail", user support email = yours, Audience = **External**, contact email = yours, accept the terms, **Create**.
4. **Add the scopes.** **Data Access, Add or remove scopes**. Add:
   `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` and `https://www.googleapis.com/auth/gmail.modify`
   (paste that last one into "Manually add scopes" if it is not listed). **Save.**
5. **Publish to production (important).** **Audience**, then **Publish app**, and confirm. Leave it unverified.
   - While an app stays in **Testing**, Google expires its refresh tokens after about **7 days**, so you would have to re-sign-in weekly.
   - In **production** the app is *unverified*, which is fine for personal use: Google shows a "Google hasn't verified this app"
     screen at sign-in (click **Advanced**, then **Go to Naushen Mail (unsafe)**), and unverified apps are limited to about 100
     users over their lifetime, far more than you need. Do **not** submit the app for verification.
   - This behaviour is from Google's documentation and can change. If your refresh tokens still expire weekly, switch back to
     Testing, add your address under **Audience, Test users**, and simply click **Reauthorize** in the app when asked.
6. **Create the OAuth client.** **Clients, Create client**, type **Desktop app**, name "Naushen Mail desktop", **Create**.
   Copy the **Client ID** and the **Client secret**. For desktop apps Google treats the secret as non-confidential, but its
   token endpoint still requires it.
7. **Paste them into the app.** Settings, Accounts, Add account, Gmail: paste both values, then **Sign in with Google**.
   In the browser, choose your account, click through the unverified-app screen (step 5) and allow access. Done.

## If something goes wrong
| Problem | Fix |
|---|---|
| "Access blocked: app has not completed verification" or "Error 403 access_denied" | The app is in Testing and you are not a test user. Add your address under **Audience, Test users**, or publish (step 5) |
| "Google hasn't verified this app" | Expected. **Advanced**, then **Go to Naushen Mail (unsafe)** |
| Asked to reauthorize every week | The app is still in Testing. Publish it (step 5) or accept the weekly Reauthorize |
| `redirect_uri_mismatch` | The client type must be **Desktop app**, not "Web application" |
| Gmail API disabled error | Redo step 2 in the same project as your client |

## Microsoft (Outlook), not available yet
Outlook support is implemented but hidden (`OUTLOOK_ENABLED` in `src/shared/features.ts`) until a Microsoft app registration exists.
Developers working on it: register an app at <https://entra.microsoft.com> (public client, redirect `http://localhost`, "any
organizational directory and personal accounts", "Allow public client flows"), with delegated Graph permissions `Mail.ReadWrite`,
`Mail.Send`, `MailboxSettings.ReadWrite`, `User.Read`, `offline_access`, `openid`, `profile`, `email`, and no client secret.

## Notes
- Tokens are encrypted with the OS secure store (Electron `safeStorage`). On macOS, ad-hoc-signed rebuilds change the app
  identity, so the Keychain may re-prompt after a rebuild.
- Provider API details: [research/02-provider-apis-and-electron.md](research/02-provider-apis-and-electron.md).
