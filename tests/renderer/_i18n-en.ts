/** Test helper: initialise the global i18next instance with the English bundles, so pure lib code that calls `i18n.t` works under vitest (node, no DOM). */
import i18n from 'i18next'
import common from '../../src/locales/en/common.json'
import settings from '../../src/locales/en/settings.json'
import rules from '../../src/locales/en/rules.json'

if (!i18n.isInitialized) {
  void i18n.init({
    resources: { en: { common, settings, rules } },
    lng: 'en', fallbackLng: 'en', defaultNS: 'common', ns: ['common', 'settings', 'rules'],
    interpolation: { escapeValue: false }, returnNull: false, initAsync: false
  })
}
