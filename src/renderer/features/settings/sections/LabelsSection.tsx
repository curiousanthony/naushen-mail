import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Plus, Tag, Trash2 } from 'lucide-react'
import type { Account, Label, LabelColor } from '@shared/types'
import { useApp } from '@/lib/store'
import { chipStyle } from '@/lib/labels'
import { Avatar, Button, ColorPicker, ConfirmBar, EmptyState, IconButton, SectionTitle, TextInput } from '../ui'
import { cleanIpcError } from '../lib/errors'

function LabelRow({ label, onError }: { label: Label; onError: (m: string | null) => void }): JSX.Element {
  const { t } = useTranslation('settings')
  const refreshMeta = useApp((s) => s.refreshMeta)
  const [name, setName] = useState(label.name)
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)
  useEffect(() => setName(label.name), [label.name])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    onError(null)
    try { await fn() } catch (e) { onError(cleanIpcError(e)); setName(label.name) }
    finally { await refreshMeta() }
  }
  const commit = (): void => {
    const n = name.trim()
    if (!n) { setName(label.name); return }
    if (n !== label.name) void run(() => window.api.invoke('labels.update', label.id, { name: n }))
  }

  return (
    <li className="st-label">
      <div className="st-label__row">
        <ColorPicker value={label.color} onChange={(color) => void run(() => window.api.invoke('labels.update', label.id, { color }))} />
        <input className="st-label__name" value={name} aria-label={t('labels.rename', { name: label.name })} spellCheck={false}
          onChange={(e) => setName(e.target.value)} onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setName(label.name); (e.target as HTMLInputElement).blur() }
          }} />
        <span className="st-chip" style={chipStyle(label.color)}>{name.trim() || label.name}</span>
        <IconButton className="st-label__del" label={t('labels.deleteLabel', { name: label.name })} onClick={() => setConfirming(true)}><Trash2 size={15} strokeWidth={1.5} /></IconButton>
      </div>
      {confirming && (
        <ConfirmBar busy={removing} confirmLabel={t('labels.delete')} onCancel={() => setConfirming(false)}
          onConfirm={() => { setRemoving(true); void run(() => window.api.invoke('labels.delete', label.id)).finally(() => { setRemoving(false); setConfirming(false) }) }}
          message={<Trans t={t} i18nKey="labels.deleteConfirm" values={{ name: label.name }} components={{ b: <strong /> }} />} />
      )}
    </li>
  )
}

function NewLabel({ account, onError }: { account: Account; onError: (m: string | null) => void }): JSX.Element {
  const { t } = useTranslation('settings')
  const refreshMeta = useApp((s) => s.refreshMeta)
  const [name, setName] = useState('')
  const [color, setColor] = useState<LabelColor>('blue')
  const [busy, setBusy] = useState(false)
  const add = async (): Promise<void> => {
    const n = name.trim()
    if (!n) return
    setBusy(true); onError(null)
    try { await window.api.invoke('labels.create', account.id, n, color); setName(''); await refreshMeta() }
    catch (e) { onError(cleanIpcError(e)) }
    finally { setBusy(false) }
  }
  return (
    <div className="st-label__new">
      <ColorPicker value={color} onChange={setColor} label={t('labels.newColour')} />
      <TextInput value={name} placeholder={t('labels.new')} aria-label={t('labels.newFor', { email: account.email })} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add() } }} />
      <Button size="sm" busy={busy} disabled={!name.trim()} icon={<Plus size={14} />} onClick={() => void add()}>{t('labels.create')}</Button>
    </div>
  )
}

export function LabelsSection(): JSX.Element {
  const { t } = useTranslation('settings')
  const accounts = useApp((s) => s.accounts)
  const labels = useApp((s) => s.labels)
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const setErr = (id: string) => (m: string | null): void => setErrors((e) => ({ ...e, [id]: m }))

  return (
    <div>
      <SectionTitle title={t('labels.title')} description={t('labels.description')} />
      {accounts.length === 0 && <EmptyState icon={<Tag size={22} strokeWidth={1.5} />} title={t('labels.noAccounts')}>{t('labels.noAccountsBody')}</EmptyState>}
      {accounts.map((a) => {
        const mine = labels.filter((l) => l.accountId === a.id && l.kind === 'user').sort((x, y) => x.name.localeCompare(y.name))
        return (
          <section key={a.id} className="st-group">
            <div className="st-group__head st-group__head--account"><Avatar account={a} size={18} /><h3>{a.email}</h3><span className="st-count">{mine.length}</span></div>
            {mine.length === 0 && <p className="st-muted st-muted--pad">{t('labels.none')}</p>}
            <ul className="st-labels">{mine.map((l) => <LabelRow key={l.id} label={l} onError={setErr(a.id)} />)}</ul>
            {errors[a.id] && <div className="st-inline-error" role="alert">{errors[a.id]}</div>}
            <NewLabel account={a} onError={setErr(a.id)} />
          </section>
        )
      })}
    </div>
  )
}
