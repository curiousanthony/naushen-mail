import { useRef, useState } from 'react'
import clsx from 'clsx'
import { AlertCircle, CircleUserRound, FlaskConical, Mail, RefreshCw, ShieldAlert } from 'lucide-react'
import type { Account, ProviderKind } from '@shared/types'
import { useApp } from '@/lib/store'
import { Avatar, Button, ConfirmBar, EmptyState, Group, SectionTitle, Spinner } from '../ui'
import { OAuthSetup } from './OAuthSetup'
import { accountStatus } from '../lib/account-status'
import { friendlyConnectError, missingCredentials, PROVIDER_LABEL, type FriendlyError } from '../lib/errors'
import { useNow } from '../lib/hooks'

const PROVIDER_ICON: Record<ProviderKind, JSX.Element> = {
  gmail: <Mail size={16} strokeWidth={1.5} />, outlook: <Mail size={16} strokeWidth={1.5} />, mock: <FlaskConical size={16} strokeWidth={1.5} />
}

function AccountRow({ account, now, onConnect, connecting }: { account: Account; now: number; onConnect: (p: ProviderKind) => void; connecting: boolean }): JSX.Element {
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
            <span className={clsx('st-badge', `st-badge--${account.provider}`)}>{PROVIDER_LABEL[account.provider]}</span>
          </div>
          <div className="st-account__email">{account.email}</div>
        </div>
        <div className={clsx('st-account__status', `is-${status.tone}`)}>
          {status.tone === 'busy' || busy ? <Spinner size={12} /> : status.tone === 'ok' ? <span className="st-dot" /> : <AlertCircle size={13} strokeWidth={1.75} />}
          <span>{busy && status.tone !== 'busy' ? 'Syncing…' : status.text}</span>
        </div>
      </div>
      {!confirming && (
        <div className="st-account__actions">
          {account.status === 'reauth' && (
            <Button size="sm" variant="primary" busy={connecting} icon={<ShieldAlert size={13} />} onClick={() => onConnect(account.provider)}>Reauthorize</Button>
          )}
          <Button size="sm" busy={busy} icon={<RefreshCw size={13} />} onClick={() => void sync()}>Sync now</Button>
          <Button size="sm" variant="ghost" className="st-danger-text" onClick={() => setConfirming(true)}>Disconnect</Button>
        </div>
      )}
      {err && <div className="st-inline-error" role="alert"><AlertCircle size={13} />{err}</div>}
      {confirming && (
        <ConfirmBar busy={removing} confirmLabel="Disconnect" onCancel={() => setConfirming(false)} onConfirm={() => void remove()}
          message={<><strong>Disconnect {account.email}?</strong> Its mail, labels and local reminders are removed from Mailroom on this Mac. Nothing is deleted from {PROVIDER_LABEL[account.provider]}.</>} />
      )}
    </li>
  )
}

export function AccountsSection(): JSX.Element {
  const accounts = useApp((s) => s.accounts)
  const oauth = useApp((s) => s.settings.oauth)
  const now = useNow()
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
    const missing = missingCredentials(provider, oauth)
    if (missing) { setError(missing); return }
    setConnecting(provider)
    try {
      const account = await window.api.invoke('accounts.connect', provider)
      const s = useApp.getState()
      await s.refreshMeta(); void s.refreshThreads()
      s.toast({ message: `Connected ${account.email}`, duration: 3500 })
    } catch (e) { setError(friendlyConnectError(provider, e)) }
    finally { setConnecting(null) }
  }

  const providers: { kind: ProviderKind; title: string; sub: string }[] = [
    { kind: 'gmail', title: 'Connect Gmail', sub: 'Google account' },
    { kind: 'outlook', title: 'Connect Outlook', sub: 'Microsoft account' },
    { kind: 'mock', title: 'Add demo account', sub: 'Sample mail, offline' }
  ]

  return (
    <div>
      <SectionTitle title="Accounts" description="Mail accounts connected to Mailroom. Threads are never merged across accounts." />

      <Group title="Connected accounts">
        {accounts.length === 0 ? (
          <EmptyState icon={<CircleUserRound size={22} strokeWidth={1.5} />} title="No accounts connected">
            Connect Gmail or Outlook to start reading mail, or add a demo account to explore Mailroom offline.
          </EmptyState>
        ) : (
          <ul className="st-accounts">
            {accounts.map((a) => <AccountRow key={a.id} account={a} now={now} connecting={connecting === a.provider} onConnect={(p) => void connect(p)} />)}
          </ul>
        )}
      </Group>

      <Group title="Add account">
        <div className="st-connect">
          {providers.map((p) => (
            <button key={p.kind} type="button" className={clsx('st-connect__btn', connecting === p.kind && 'is-busy')} disabled={connecting !== null} onClick={() => void connect(p.kind)}>
              <span className={clsx('st-connect__icon', `st-connect__icon--${p.kind}`)}>{connecting === p.kind ? <Spinner size={16} /> : PROVIDER_ICON[p.kind]}</span>
              <span className="st-connect__text"><strong>{connecting === p.kind ? 'Waiting for sign-in…' : p.title}</strong><span>{connecting === p.kind ? 'Finish in your browser' : p.sub}</span></span>
            </button>
          ))}
        </div>
        {connecting && connecting !== 'mock' && (
          <p className="st-muted st-muted--small st-connect__note">A browser window opened for sign-in. Come back here when you are done; this times out after five minutes.</p>
        )}
        {error && (
          <div className="st-alert" role="alert">
            <AlertCircle size={16} strokeWidth={1.5} aria-hidden />
            <div>
              <p>{error.message}</p>
              {error.hint === 'oauth-setup' && <button type="button" className="st-link" onClick={showOAuth}>Open the OAuth setup guide</button>}
            </div>
          </div>
        )}
      </Group>

      <Group>
        <OAuthSetup ref={oauthRef} open={oauthOpen} onToggle={setOauthOpen} />
      </Group>
    </div>
  )
}
