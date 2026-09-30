/// <reference types="vite/client" />
import i18n from 'i18next'
import { app } from 'electron'
import { DEFAULT_LANGUAGE, LANGUAGES, resolveLanguage, type LanguagePref } from '@shared/languages'

/** Main-process strings (native notifications, menus, errors that reach the UI). Messages live in the `main` namespace. */
const files = import.meta.glob('../locales/*/main.json', { eager: true, import: 'default' }) as Record<string, Record<string, unknown>>
const resources: Record<string, { main: Record<string, unknown> }> = {}
for (const [path, main] of Object.entries(files)) {
  const lng = /locales\/([^/]+)\/main\.json$/.exec(path)?.[1]
  if (lng) resources[lng] = { main }
}

const instance = i18n.createInstance()
// Synchronous init so `mt()` works (in English) before `setMainLanguage` is ever called, and in unit tests.
void instance.init({
  initAsync: false, resources, lng: DEFAULT_LANGUAGE, fallbackLng: DEFAULT_LANGUAGE, supportedLngs: LANGUAGES.map((l) => l.code),
  defaultNS: 'main', ns: ['main'], interpolation: { escapeValue: false }, returnNull: false
})

const listeners = new Set<() => void>()
/** Run `cb` after the main-process language changes (menus rebuild their labels here). Returns an unsubscribe. */
export function onMainLanguageChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export function setMainLanguage(pref: LanguagePref | undefined): void {
  const locale = typeof app?.getLocale === 'function' ? app.getLocale() : 'en'
  void instance.changeLanguage(resolveLanguage(pref, locale)).then(() => { for (const cb of listeners) cb() })
}
/** Translate a main-process string: `mt('notify.newMail', { count })`. */
export const mt = (key: string, options?: Record<string, unknown>): string => instance.t(key, options) as string
