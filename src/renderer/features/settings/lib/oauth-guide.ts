/** Checklist text mirrored from docs/06-provider-setup.md. Keep the two in sync. */
export interface GuideStep { text: string; code?: string[] }

export const GOOGLE_CONSOLE_URL = 'https://console.cloud.google.com/'
export const MICROSOFT_ENTRA_URL = 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade'

export const GOOGLE_STEPS: GuideStep[] = [
  { text: 'In Google Cloud Console create a New Project (for example “Naushen Mail”).' },
  { text: 'APIs & Services → Library → enable the Gmail API.' },
  { text: 'Google Auth Platform → Get started: app name “Naushen Mail”, your email, audience External.' },
  { text: 'Data Access → Add scopes:', code: ['openid', '.../auth/userinfo.email', '.../auth/userinfo.profile', '.../auth/gmail.modify'] },
  { text: 'Audience → Test users → Add users → your own Gmail address(es). Leave publishing status as Testing — see the note below.' },
  { text: 'Clients → Create client → Desktop app. Copy the Client ID and Client secret into the fields above.' }
]

export const GOOGLE_PUBLISH_NOTE =
  'Stay in Testing — do not Publish. gmail.modify is a Google "restricted" scope: removing the 7-day refresh-token ' +
  'expiry needs full verification, including a paid third-party security audit, which only makes sense for a real ' +
  'multi-user product. For personal use, Google’s own guidance is to stay in Testing with yourself as a test ' +
  'user. The tradeoff: your refresh token expires about every 7 days, so you will occasionally need to click ' +
  '"Reauthorize" in Settings → Accounts (a quick Google sign-in, not a redo of this setup). You will also see ' +
  'a one-time "Google hasn’t verified this app" screen on each sign-in — click Advanced → Go to Naushen Mail.'

export const MICROSOFT_STEPS: GuideStep[] = [
  { text: 'In Microsoft Entra: App registrations → New registration.' },
  { text: 'Name it “Naushen Mail”. Supported account types: Accounts in any organizational directory and personal Microsoft accounts.' },
  { text: 'Redirect URI: platform Public client/native (mobile & desktop), value:', code: ['http://localhost'] },
  { text: 'Copy the Application (client) ID into the field above.' },
  { text: 'Authentication → Allow public client flows → Yes.' },
  { text: 'API permissions → Add → Microsoft Graph → Delegated:', code: ['Mail.ReadWrite', 'Mail.Send', 'MailboxSettings.ReadWrite', 'User.Read', 'offline_access', 'openid', 'profile', 'email'] },
  { text: 'Do not create a client secret. Naushen Mail is a public client and uses PKCE.' }
]
