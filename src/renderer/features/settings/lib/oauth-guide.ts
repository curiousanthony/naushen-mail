/** Checklist text mirrored from docs/06-provider-setup.md. Keep the two in sync. */
export interface GuideStep { text: string; code?: string[] }

export const GOOGLE_CONSOLE_URL = 'https://console.cloud.google.com/'
export const MICROSOFT_ENTRA_URL = 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade'

export const GOOGLE_STEPS: GuideStep[] = [
  { text: 'In Google Cloud Console create a New Project (for example “Naushen Mail”).' },
  { text: 'APIs & Services → Library → enable the Gmail API.' },
  { text: 'Google Auth Platform → Get started: app name “Naushen Mail”, your email, audience External.' },
  { text: 'Data Access → Add scopes:', code: ['openid', '.../auth/userinfo.email', '.../auth/userinfo.profile', '.../auth/gmail.modify'] },
  { text: 'Audience → Publish app, to move it from Testing to In production. Do not submit it for verification.' },
  { text: 'Clients → Create client → Desktop app. Copy the Client ID and Client secret into the fields above.' }
]

export const GOOGLE_PUBLISH_NOTE =
  'Publish the app. While the consent screen is in Testing, Google expires refresh tokens after 7 days for a restricted scope like gmail.modify, so you would have to sign in again every week. An unverified production app has no such expiry; you click through a one-time “Google hasn’t verified this app” screen (Advanced → Go to Naushen Mail).'

export const MICROSOFT_STEPS: GuideStep[] = [
  { text: 'In Microsoft Entra: App registrations → New registration.' },
  { text: 'Name it “Naushen Mail”. Supported account types: Accounts in any organizational directory and personal Microsoft accounts.' },
  { text: 'Redirect URI: platform Public client/native (mobile & desktop), value:', code: ['http://localhost'] },
  { text: 'Copy the Application (client) ID into the field above.' },
  { text: 'Authentication → Allow public client flows → Yes.' },
  { text: 'API permissions → Add → Microsoft Graph → Delegated:', code: ['Mail.ReadWrite', 'Mail.Send', 'MailboxSettings.ReadWrite', 'User.Read', 'offline_access', 'openid', 'profile', 'email'] },
  { text: 'Do not create a client secret. Naushen Mail is a public client and uses PKCE.' }
]
