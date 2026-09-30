import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { DEFAULT_LANGUAGE, LANGUAGES, resolveLanguage, type LanguageCode, type LanguagePref } from '@shared/languages'

/**
 * Message files live in `src/locales/<lng>/<namespace>.json` (one namespace per feature folder, so parallel work never
 * touches the same file). English is the source of truth and the fallback for any missing key.
 */
const files = import.meta.glob('../../locales/*/*.json', { eager: true, import: 'default' }) as Record<string, Record<string, unknown>>

const resources: Record<string, Record<string, Record<string, unknown>>> = {}
for (const [path, messages] of Object.entries(files)) {
  const m = /locales\/([^/]+)\/([^/]+)\.json$/.exec(path)
  if (m) (resources[m[1]] ??= {})[m[2]] = messages
}
const namespaces = Object.keys(resources[DEFAULT_LANGUAGE] ?? { common: {} })

void i18n.use(initReactI18next).init({
  resources,
  lng: resolveLanguage('system', navigator.language),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: LANGUAGES.map((l) => l.code),
  ns: namespaces,
  defaultNS: 'common',
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false
})

let current: LanguageCode = i18n.language as LanguageCode
/** BCP-47 tag of the active UI language, for `Intl.*` and `toLocale*String`. */
export const currentLocale = (): string => current

/** Apply the user's language preference: i18next, `<html lang>`, and every `Intl` consumer via `currentLocale()`. */
export function applyLanguage(pref: LanguagePref | undefined): void {
  current = resolveLanguage(pref, navigator.language)
  document.documentElement.lang = current
  if (i18n.language !== current) void i18n.changeLanguage(current)
}

export default i18n
