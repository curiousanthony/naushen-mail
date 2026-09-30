import { useRef, useState } from 'react'
import clsx from 'clsx'
import { Trans, useTranslation } from 'react-i18next'
import { AlertCircle, CircleUserRound, FlaskConical, Mail, RefreshCw, ShieldAlert } from 'lucide-react'
import { OUTLOOK_ENABLED } from '@shared/features'
import type { Account, ProviderKind } from '@shared/types'
import { useApp } from '@/lib/store'
import { Avatar, Button, ConfirmBar, EmptyState, Group, SectionTitle, Spinner } from '../ui'
import { OAuthSetup } from './OAuthSetup'
import { accountStatus } from '../lib/account-status'
import { friendlyConnectError, missingCredentials, providerLabel, type FriendlyError } from '../lib/errors'
import { useNow } from '../lib/hooks'
import { getPlatformInfo, hasBuiltInGoogle, providerCtx, usePlatformInfo } from '../lib/project'

const PROVIDER_ICON: Record<ProviderKind, JSX.Element> = {
  gmail: <Mail size={16} strokeWidth={1.5} />, outlook: <Mail size={16} strokeWidth={1.5} />, mock: <FlaskConical size={16} strokeWidth={1.5} />
}

function AccountRow({ account, now, onConnect, connecting }: { account: Account; now: number; onConnect: (p: ProviderKind) => void; connecting: boolean }): JSX.Element {
  const { t } = useTranslation('settings')
  const refreshMeta = useApp((s) => s.refreshMeta)
  const [syncing, setSyncing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const status = accountStatus(account, now)
  const busy = syncing || account.status === 'syncing'

  const sync = async (): Promise<void> => {
    setSyncing(true); setErr(null)
    try { await window.api.invoke('sync.now', account.id) }
    catch (e) { setErr(friendlyConnectError(account.provider, e).message) }
    finally { setSyncing(false); void refreshMeta() }
  }
  const remove = async (): Promise<void> => {
    setRemoving(true)
    try {
      await window.api.invoke('accounts.remove', account.id)
      const s = useApp.getState()
      if (s.accountId === account.id) s.setAccount('all')
      await s.refreshMeta(); void s.refreshThreads()
    } catch (e) { setErr(friendlyConnectError(account.provider, e).message); setRemoving(false); setConfirming(false) }
  }

  return (
    <li className={clsx('st-account', account.status === 'reauth' && 'is-reauth')}>
      <div className="st-account__main">
        <Avatar account={account} size={36} />
        <div className="st-account__who">
          <div className="st-account__name">
            <span>{account.name || account.email}</span>
            <span className={clsx('st-badge', `st-badge--${account.provider}`)}>{providerLabel(account.provider)}</span>
          </div>
          <div className="st-account__email">{account.email}</div>
          {!account.avatarUrl && account.provider !== 'mock' && account.status !== 'reauth' && (
            <div className="st-account__hint">{t('accounts.row.noPhoto', { company: account.provider === 'gmail' ? 'Google' : 'Microsoft' })}</div>
          )}
        </div>
        <div className={clsx('st-account__status', `is-${status.tone}`)}>
          {status.tone === 'busy' || busy ? <Spinner size={12} /> : status.tone === 'ok' ? <span className="st-dot" /> : <AlertCircle size={13} strokeWidth={1.75} />}
          <span>{busy && status.tone !== 'busy' ? t('accounts.status.syncing') : status.text}</span>
        </div>
      </div>
      {!confirming && (
        <div className="st-account__actions">
          {(account.status === 'reauth' || (!account.avatarUrl && account.provider !== 'mock')) && (
            <Button size="sm" variant={account.status === 'reauth' ? 'primary' : 'default'} busy={connecting} icon={<ShieldAlert size={13} />} onClick={() => onConnect(account.provider)}>{t('accounts.row.reauthorize')}</Button>
          )}
          <Button size="sm" busy={busy} icon={<RefreshCw size={13} />} onClick={() => void sync()}>{t('accounts.row.syncNow')}</Button>
          <Button size="sm" variant="ghost" className="st-danger-text" onClick={() => setConfirming(true)}>{t('accounts.row.disconnect')}</Button>
        </div>
      )}
      {err && <div className="st-inline-error" role="alert"><AlertCircle size={13} />{err}</div>}
      {confirming && (
        <ConfirmBar busy={removing} confirmLabel={t('accounts.row.disconnect')} onCancel={() => setConfirming(false)} onConfirm={() => void remove()}
          message={<Trans t={t} i18nKey="accounts.row.disconnectConfirm" values={{ email: account.email, provider: providerLabel(account.provider) }} components={{ b: <strong /> }} />} />
      )}
    </li>
  )
}

export function AccountsSection(): JSX.Element {
  const { t } = useTranslation('settings')
  const accounts = useApp((s) => s.accounts)
  const now = useNow()
  const info = usePlatformInfo()
  const builtIn = hasBuiltInGoogle(info)
  const [connecting, setConnecting] = useState<ProviderKind | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [oauthOpen, setOauthOpen] = useState(false)
  const oauthRef = useRef<HTMLDivElement>(null)

  const showOAuth = (): void => {
    setOauthOpen(true)
    requestAnimationFrame(() => oauthRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const connect = async (provider: ProviderKind): Promise<void> => {
    setError(null)
    // With a built-in Google client (release builds) Gmail needs no setup, so the missing-client check is skipped.
    const builtInGoogle = hasBuiltInGoogle(await getPlatformInfo())
    const missing = missingCredentials(provider, useApp.getState().settings.oauth, builtInGoogle)
    if (missing) { setError(missing); showOAuth(); return }
    setConnecting(provider)
    try {
      const account = await window.api.invoke('accounts.connect', provider)
      const s = useApp.getState()
      await s.refreshMeta(); void s.refreshThreads()
      s.toast({ message: t('accounts.connected', { email: account.email }), duration: 3500 })
    } catch (e) { setError(friendlyConnectError(provider, e)) }
    finally { setConnecting(null) }
  }

  // Outlook is implemented but hidden until OUTLOOK_ENABLED (see @shared/features).
  const providers: { kind: ProviderKind; title: string; sub: string }[] = [
    { kind: 'gmail', title: t('accounts.providers.gmail.title'), sub: t('accounts.providers.gmail.sub') },
    ...(OUTLOOK_ENABLED ? [{ kind: 'outlook' as const, title: t('accounts.providers.outlook.title'), sub: t('accounts.providers.outlook.sub') }] : []),
    { kind: 'mock', title: t('accounts.providers.mock.title'), sub: t('accounts.providers.mock.sub') }
  ]

  return (
    <div>
      <SectionTitle title={t('accounts.title')} description={t('accounts.description')} />

      <Group title={t('accounts.connectedTitle')}>
        {accounts.length === 0 ? (
          <EmptyState icon={<CircleUserRound size={22} strokeWidth={1.5} />} title={t('accounts.empty.title')}>
            {t('accounts.empty.body', { ...providerCtx })}
          </EmptyState>
        ) : (
          <ul className="st-accounts">
            {accounts.map((a) => <AccountRow key={a.id} account={a} now={now} connecting={connecting === a.provider} onConnect={(p) => void connect(p)} />)}
          </ul>
        )}
      </Group>

      <Group title={t('accounts.addTitle')}>
        <div className="st-connect">
          {providers.map((p) => (
            <button key={p.kind} type="button" className={clsx('st-connect__btn', connecting === p.kind && 'is-busy')} disabled={connecting !== null} onClick={() => void connect(p.kind)}>
              <span className={clsx('st-connect__icon', `st-connect__icon--${p.kind}`)}>{connecting === p.kind ? <Spinner size={16} /> : PROVIDER_ICON[p.kind]}</span>
              <span className="st-connect__text"><strong>{connecting === p.kind ? t('accounts.waiting') : p.title}</strong><span>{connecting === p.kind ? t('accounts.finishInBrowser') : p.sub}</span></span>
            </button>
          ))}
        </div>
        {connecting && connecting !== 'mock' && (
          <p className="st-muted st-muted--small st-connect__note">{t('accounts.browserNote')}</p>
        )}
        {error && (
          <div className="st-alert" role="alert">
            <AlertCircle size={16} strokeWidth={1.5} aria-hidden />
            <div>
              <p>{error.message}</p>
              {error.hint === 'oauth-setup' && <button type="button" className="st-link" onClick={showOAuth}>{t(builtIn ? 'accounts.openAdvanced' : 'accounts.openGuide')}</button>}
            </div>
          </div>
        )}
      </Group>

      <Group>
        <OAuthSetup ref={oauthRef} open={oauthOpen} onToggle={setOauthOpen} builtIn={builtIn}
          connecting={connecting === 'gmail'} onConnect={() => void connect('gmail')} />
      </Group>
    </div>
  )
}
