import { de, enUS, es, fr, hi, ja, ptBR, ru, zhCN } from 'date-fns/locale'
import type { Locale } from 'date-fns'
import type { LanguageCode } from '@shared/languages'
import { currentLocale } from './index'

const MAP: Record<LanguageCode, Locale> = { en: enUS, fr, es, de, 'pt-BR': ptBR, ru, 'zh-CN': zhCN, ja, hi }

/** date-fns locale matching the UI language: pass as `{ locale: dateLocale() }` to `format`, `formatDistance`, … */
export const dateLocale = (): Locale => MAP[currentLocale() as LanguageCode] ?? enUS
