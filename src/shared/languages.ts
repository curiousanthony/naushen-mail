/** Languages Naushen Mail is translated into. `code` is a BCP-47 tag and the folder name under `src/locales/`. */
export const LANGUAGES = [
  { code: 'en', native: 'English' },
  { code: 'fr', native: 'Français' },
  { code: 'es', native: 'Español' },
  { code: 'de', native: 'Deutsch' },
  { code: 'pt-BR', native: 'Português (Brasil)' },
  { code: 'ru', native: 'Русский' },
  { code: 'zh-CN', native: '简体中文' },
  { code: 'ja', native: '日本語' },
  { code: 'hi', native: 'हिन्दी' }
] as const

export type LanguageCode = (typeof LANGUAGES)[number]['code']
/** What is stored in settings: an explicit language, or follow the operating system. */
export type LanguagePref = 'system' | LanguageCode
export const DEFAULT_LANGUAGE: LanguageCode = 'en'

/** Map any locale tag ("fr-CA", "pt-PT", "zh-Hans-CN", "en_US") to the closest supported language. */
export function matchLanguage(tag: string | undefined | null): LanguageCode {
  if (!tag) return DEFAULT_LANGUAGE
  const t = tag.replace('_', '-').toLowerCase()
  const exact = LANGUAGES.find((l) => l.code.toLowerCase() === t)
  if (exact) return exact.code
  const base = t.split('-')[0]
  if (base === 'zh') return 'zh-CN'
  if (base === 'pt') return 'pt-BR'
  return LANGUAGES.find((l) => l.code.toLowerCase() === base)?.code ?? DEFAULT_LANGUAGE
}

export const resolveLanguage = (pref: LanguagePref | undefined, systemTag: string | undefined | null): LanguageCode =>
  !pref || pref === 'system' ? matchLanguage(systemTag) : pref
