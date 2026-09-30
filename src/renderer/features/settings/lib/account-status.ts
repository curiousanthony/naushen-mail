import i18n from 'i18next'
import type { Account } from '@shared/types'

export type StatusTone = 'ok' | 'busy' | 'warn' | 'error'

const t = (key: string, options?: Record<string, unknown>): string => i18n.t(key, { ns: 'settings', ...options }) as string

/** "5 minutes ago", in the UI language. */
function ago(from: number, now: number): string {
  const s = Math.max(0, Math.round((now - from) / 1000))
  const rtf = new Intl.RelativeTimeFormat(i18n.language || 'en', { numeric: 'always' })
  if (s < 60) return rtf.format(-s, 'second')
  const m = Math.round(s / 60)
  if (m < 60) return rtf.format(-m, 'minute')
  const h = Math.round(m / 60)
  if (h < 24) return rtf.format(-h, 'hour')
  const d = Math.round(h / 24)
  if (d < 30) return rtf.format(-d, 'day')
  const mo = Math.round(d / 30)
  return mo < 12 ? rtf.format(-mo, 'month') : rtf.format(-Math.round(d / 365), 'year')
}

export function accountStatus(a: Pick<Account, 'status' | 'statusMessage' | 'lastSyncAt'>, now = Date.now()): { text: string; tone: StatusTone } {
  switch (a.status) {
    case 'syncing': return { text: t('accounts.status.syncing'), tone: 'busy' }
    case 'reauth': return { text: t('accounts.status.reauth'), tone: 'warn' }
    case 'error': return { text: a.statusMessage || t('accounts.status.error'), tone: 'error' }
    default: {
      if (!a.lastSyncAt) return { text: t('accounts.status.never'), tone: 'ok' }
      const diff = now - a.lastSyncAt
      return { text: diff < 45_000 ? t('accounts.status.justNow') : t('accounts.status.synced', { time: ago(a.lastSyncAt, now) }), tone: 'ok' }
    }
  }
}
