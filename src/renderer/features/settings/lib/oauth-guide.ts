import i18n from 'i18next'

/** Checklist text for the (hidden unless OUTLOOK_ENABLED) Microsoft setup. Mirrors docs/google-setup.md. */
export interface GuideStep { text: string; code?: string[] }

const t = (key: string): string => i18n.t(key, { ns: 'settings' }) as string

/** Deep links into Google Cloud Console for each wizard step (they open in the project the person last used). */
export const GOOGLE_LINKS = {
  createProject: 'https://console.cloud.google.com/projectcreate',
  enableGmail: 'https://console.cloud.google.com/apis/library/gmail.googleapis.com',
  consent: 'https://console.cloud.google.com/auth/overview',
  scopes: 'https://console.cloud.google.com/auth/scopes',
  audience: 'https://console.cloud.google.com/auth/audience',
  createClient: 'https://console.cloud.google.com/auth/clients/create'
} as const

export const MICROSOFT_ENTRA_URL = 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade'

/** The OAuth app name to type into the consent screen. A product name: not translated. */
export const GOOGLE_APP_NAME = 'Naushen Mail'

/** Scopes to paste under "Manually add scopes" (one per line). */
export const GOOGLE_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/gmail.modify'
] as const

export const microsoftSteps = (): GuideStep[] => [
  { text: t('guide.microsoft.register') },
  { text: t('guide.microsoft.name') },
  { text: t('guide.microsoft.redirect'), code: ['http://localhost'] },
  { text: t('guide.microsoft.copyId') },
  { text: t('guide.microsoft.public') },
  { text: t('guide.microsoft.permissions'), code: ['Mail.ReadWrite', 'Mail.Send', 'MailboxSettings.ReadWrite', 'User.Read', 'offline_access', 'openid', 'profile', 'email'] },
  { text: t('guide.microsoft.noSecret') }
]
