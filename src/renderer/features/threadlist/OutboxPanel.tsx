import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, CheckCircle2, Clock, FileText } from 'lucide-react'
import type { Draft, ScheduledSend } from '@shared/types'
import { retriedSends, useApp } from '@/lib/store'
import { AuthNotice } from '@/features/compose/AuthNotice'

const DAY = 86_400_000

const who = (m: { to: { name?: string; email: string }[] }): string => m.to.map((a) => a.name || a.email).join(', ')

/**
 * Everything the app holds locally that is not yet (or just was) a provider message: autosaved
 * drafts and the send outbox with an honest status each. In Drafts it lists all of them; in other
 * views it only surfaces sends that are waiting or failed so they can never go unnoticed.
 */
export function OutboxPanel({ full }: { full: boolean }): JSX.Element | null {
  const { t } = useTranslation('threadlist')
  const accountId = useApp((s) => s.accountId)
  const accounts = useApp((s) => s.accounts)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [sends, setSends] = useState<ScheduledSend[]>([])

  const load = useCallback(async () => {
    const [d, s] = await Promise.all([
      full ? window.api.invoke('drafts.list') : Promise.resolve([] as Draft[]),
      window.api.invoke('compose.listScheduled')
    ])
    setDrafts(d)
    setSends(s)
  }, [full])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 2000)
    const off = window.api.onEvent((e) => { if (e.type === 'outbox') void load() })
    return () => { clearInterval(id); off() }
  }, [load])

  const inScope = (id: string): boolean => accountId === 'all' || id === accountId
  const now = Date.now()
  const items = sends
    .filter((s) => inScope(s.message.accountId))
    .filter((s) => (full ? s.status !== 'cancelled' && (s.status !== 'sent' || now - (s.doneAt ?? s.sendAt) < DAY) : s.status === 'failed'))
    .sort((a, b) => b.sendAt - a.sendAt)
  const myDrafts = drafts.filter((d) => inScope(d.accountId))
  const scope = accounts.find((a) => a.id === (accountId === 'all' ? items[0]?.message.accountId ?? myDrafts[0]?.accountId : accountId))

  if (!items.length && !myDrafts.length) return null

  const fmt = (ts: number): string => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const statusText = (s: ScheduledSend): string =>
    s.status === 'failed' ? t('outbox.failed', { error: s.error ?? '' })
      : s.status === 'sent' ? t('outbox.sent', { time: fmt(s.doneAt ?? s.sendAt) })
      : s.sendAt > now + 5000 ? t('outbox.scheduled', { time: fmt(s.sendAt) }) : t('outbox.sending')

  return (
    <div className="outbox" role="region" aria-label={t('outbox.title')}>
      <AuthNotice account={scope} />
      {items.length > 0 && <div className="outbox__head">{t('outbox.title')}</div>}
      {items.map((s) => (
        <div key={s.id} className={`outbox__row is-${s.status}`}>
          {s.status === 'failed' ? <AlertCircle size={14} /> : s.status === 'sent' ? <CheckCircle2 size={14} /> : <Clock size={14} />}
          <div className="outbox__main">
            <div className="outbox__subject">{s.message.subject || t('common:noSubject')} <span className="outbox__to">→ {who(s.message)}</span></div>
            <div className="outbox__status">{statusText(s)}</div>
          </div>
          {s.status === 'failed' && (
            <button type="button" className="outbox__btn" onClick={() => { retriedSends.add(s.id); void window.api.invoke('compose.retry', s.id).then(load) }}>{t('common:actions.retry')}</button>
          )}
          {(s.status === 'failed' || s.status === 'pending') && (
            <button type="button" className="outbox__btn" onClick={() => void window.api.invoke('compose.cancelScheduled', s.id).then(load)}>{t('outbox.discard')}</button>
          )}
        </div>
      ))}
      {myDrafts.length > 0 && <div className="outbox__head">{t('outbox.drafts')}</div>}
      {myDrafts.map((d) => (
        <div key={d.id} className="outbox__row">
          <FileText size={14} />
          <button type="button" className="outbox__main outbox__open" onClick={() => useApp.getState().openComposer({ accountId: d.accountId, draftId: d.id, mode: 'new', placement: 'window' })}>
            <div className="outbox__subject">{d.subject || t('common:noSubject')} <span className="outbox__to">{d.to.length ? `→ ${who(d)}` : ''}</span></div>
            <div className="outbox__status">{t('outbox.draftSaved', { time: fmt(d.updatedAt) })}</div>
          </button>
          <button type="button" className="outbox__btn" onClick={() => void window.api.invoke('drafts.delete', d.id).then(load)}>{t('outbox.discard')}</button>
        </div>
      ))}
    </div>
  )
}
