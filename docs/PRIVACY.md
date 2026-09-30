# Privacy Policy

**Naushen Mail** is a desktop email client made by Anthony (GitHub: [curiousanthony](https://github.com/curiousanthony)).
Effective date: 2026-09-30. Questions: open an issue at <https://github.com/curiousanthony/naushen-mail/issues>.

## The short version
- Naushen Mail runs entirely on **your computer**. There is **no Naushen server, no account, no analytics and no telemetry**.
- Your mail travels only **between your device and Google** (Gmail API). The developer never receives, sees, stores or sells it.
- Mail and settings are stored locally, and sign-in tokens are encrypted with your operating system's secure store.

## What the app accesses
Naushen Mail signs in with an OAuth client that you create in your own Google Cloud project, so your mail access is
granted to your own client, not to a shared app run by the developer. When you sign in with Google, you grant the app these permissions:

| Permission (scope) | Why |
|---|---|
| `https://www.googleapis.com/auth/gmail.modify` | Read your messages, labels and threads; send mail; create drafts; archive, trash, star, label and mark as read. Needed for a full mail client |
| `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` | Show which account is signed in (address, name, picture) |

## What is stored, and where
- **On your device only:** a local database (SQLite) with a cache of your messages, labels, contacts seen in your mail, drafts,
  reminders and settings; and your OAuth tokens, encrypted with the OS secure store (macOS Keychain, Windows DPAPI, or the Linux
  secret service through Electron `safeStorage`). On Linux without a running secret service, encryption may not be available; use disk encryption.
- **Nowhere else.** No copy is sent to the developer or any third party. Remote images in emails are **blocked by default**;
  when you choose to load them, your device fetches them from the sender's servers like any mail client.

## Sharing
The app does not share, sell or transfer your data. The only network destinations are Google's APIs (and, once supported,
Microsoft's), plus links or images you choose to open. Release downloads are hosted on GitHub.

## Google API Services User Data Policy (Limited Use)
Naushen Mail's use and transfer to any other app of information received from Google APIs will adhere to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the
Limited Use requirements. In particular:
- Data is used only to provide and improve the user-facing email features you see in the app.
- Data is not transferred to others, except as needed to provide those features at your request, for security, or to comply with law.
- Data is not used for advertising, and not sold.
- Humans (including the developer) do not read your data; it never leaves your device.
- Data is not used to develop, improve or train generalised AI/ML models. The app contains no AI features.

## Your controls
- **Revoke access** at any time: <https://myaccount.google.com/permissions>, choose Naushen Mail, **Delete all connections**.
  You can also remove the account inside the app (Settings, Accounts).
- **Delete local data:** quit the app and delete its data folder (see [install.md](install.md#5-where-your-data-lives)), or uninstall.
- Because the developer holds no data about you, there is nothing to request or erase on a server.

## Children
The app is not directed at children under 13.

## Changes
Changes to this policy are published in this file and noted in [CHANGELOG.md](../CHANGELOG.md); the history is public in git.
