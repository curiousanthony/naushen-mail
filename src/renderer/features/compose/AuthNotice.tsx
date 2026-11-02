import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldAlert } from 'lucide-react'
import { authExpiresAt, type Account } from '@shared/types'
import { useApp } from '@/lib/store'

const SOON_MS = 24 * 3_600_000

/** What (if anything) to tell the user about an account's authorization: expired, or about to. */
export function authState(a: Account | undefined, now = Date.now()): { kind: 'expired' } | { kind: 'soon'; at: number } | null {
  if (!a) return null
  if (a.status === 'reauth') return { kind: 'expired' }
  const at = authExpiresAt(a)
  if (at === null) return null
  if (at <= now) return { kind: 'expired' }
  return at - now <= SOON_MS ? { kind: 'soon', at } : null
}

/** Banner shown before the user commits to sending / while looking at mail: reconnect now, not after Send. */
export function AuthNotice({ account, className }: { account: Account | undefined; className?: string }): JSX.Element | null {
  const { t } = useTranslation('common')
  const [busy, setBusy] = useState(false)
  const st = authState(account)
  if (!account || !st) return null
  const reconnect = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.invoke('accounts.connect', account.provider)
      await useApp.getState().refreshMeta()
    } catch { /* the user closed the browser window: the notice simply stays */ } finally { setBusy(false) }
  }
  const when = st.kind === 'soon' ? new Date(st.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''
  return (
    <div className={className ?? 'auth-notice'} role="alert">
      <ShieldAlert size={14} />
      <span>{st.kind === 'expired' ? t('authNotice.expired', { email: account.email }) : t('authNotice.soon', { email: account.email, when })}</span>
      <button type="button" className="auth-notice__btn" disabled={busy} onClick={() => void reconnect()}>{t('authNotice.reauthorize')}</button>
    </div>
  )
}
