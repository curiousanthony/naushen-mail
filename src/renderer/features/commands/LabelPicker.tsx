import { useEffect, useMemo, useState } from 'react'
import { Command } from 'cmdk'
import { Check, CornerDownLeft, Minus, Plus, Tag } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { currentLocale } from '@/i18n'
import type { Label, Thread } from '@shared/types'
import { useApp } from '@/lib/store'
import { filterRank } from './filter'
import { nextLabelColor, perform, targetThreads } from './runner'
import { checkState, type CheckState } from './selection'
import { Overlay } from './Overlay'
import './commands.css'

/** Label picker, `l`: searchable multi-select of the account's user labels, plus inline create. */
export function LabelPicker(): JSX.Element | null {
  const open = useApp((s) => s.overlay === 'label-picker')
  return open ? <LabelBody /> : null
}

function LabelBody(): JSX.Element {
  const { t } = useTranslation('commands')
  const close = (): void => useApp.getState().setOverlay(null)
  const allLabels = useApp((s) => s.labels)
  const { ids, threads: known } = targetThreads()
  const [fetched, setFetched] = useState<Thread[]>([])
  const [query, setQuery] = useState('')
  const [override, setOverride] = useState<Record<string, CheckState>>({})

  // The open thread may not be in the visible list (e.g. opened from search); fetch what is missing.
  const missing = ids.filter((i) => !known.some((t) => t.id === i))
  useEffect(() => {
    if (!missing.length) return
    let dead = false
    void Promise.all(missing.map((i) => window.api.invoke('threads.get', i))).then((r) => { if (!dead) setFetched(r.filter((t): t is NonNullable<typeof t> => !!t)) })
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing.join('|')])

  const threads = useMemo(() => [...known, ...fetched], [known, fetched])
  // Labels belong to one account; scope to the first thread's account (mixed-account selections only touch that account's threads).
  const accountId = threads[0]?.accountId
  const scoped = useMemo(() => threads.filter((t) => t.accountId === accountId), [threads, accountId])
  const labels: Label[] = useMemo(() => allLabels.filter((l) => l.kind === 'user' && l.accountId === accountId).sort((a, b) => a.name.localeCompare(b.name, currentLocale())), [allLabels, accountId])

  const q = query.trim()
  const shown = filterRank(labels, q, (l) => ({ label: l.name }))
  const exact = labels.some((l) => l.name.toLowerCase() === q.toLowerCase())
  const canCreate = q.length > 0 && !exact && !!accountId

  const stateOf = (l: Label): CheckState => override[l.id] ?? checkState(scoped, l.id)

  const toggle = async (l: Label): Promise<void> => {
    const on = stateOf(l) === 'on'
    setOverride((o) => ({ ...o, [l.id]: on ? 'off' : 'on' }))
    const idsHere = scoped.map((t) => t.id)
    await perform(on ? { type: 'removeLabel', labelId: l.id } : { type: 'addLabel', labelId: l.id }, on ? t('labels.removed', { name: l.name }) : t('labels.added', { name: l.name }), { ids: idsHere })
    void useApp.getState().refreshThreads()
  }

  const create = async (): Promise<void> => {
    if (!canCreate || !accountId) return
    const label = await window.api.invoke('labels.create', accountId, q, nextLabelColor(labels.length))
    await useApp.getState().refreshMeta()
    setQuery('')
    await toggle(label)
  }

  return (
    <Overlay onClose={close} width={340} top="16vh" label={t('labels.title')} className="cmd-labels">
      <Command shouldFilter={false} loop label={t('labels.commandLabel')} className="cmd-root">
        <div className="cmd-inputrow cmd-inputrow--sm">
          <Tag size={16} strokeWidth={1.5} className="cmd-inputrow__icon" />
          <Command.Input autoFocus value={query} onValueChange={setQuery} placeholder={t('labels.placeholder')} className="cmd-input cmd-input--sm" />
        </div>
        <Command.List className="cmd-list cmd-list--sm">
          {!shown.length && !canCreate && <div className="cmd-empty">{labels.length ? t('labels.noMatch') : t('labels.none')}</div>}
          {shown.map((l) => {
            const st = stateOf(l)
            return (
              <Command.Item key={l.id} value={`label:${l.id}`} onSelect={() => void toggle(l)} className="cmd-item">
                <span className={`cmd-check cmd-check--${st}`} aria-hidden>
                  {st === 'on' && <Check size={12} strokeWidth={2.5} />}
                  {st === 'mixed' && <Minus size={12} strokeWidth={2.5} />}
                </span>
                <span className="cmd-dot cmd-dot--lg" style={{ background: `var(--chip-${l.color ?? 'gray'}-fg)` }} />
                <span className="cmd-item__label">{l.name}</span>
              </Command.Item>
            )
          })}
          {canCreate && (
            <Command.Item value={`create:${q}`} onSelect={() => void create()} className="cmd-item">
              <span className="cmd-item__icon"><Plus size={16} strokeWidth={1.5} /></span>
              <span className="cmd-item__label">{t('labels.create', { name: q })}</span>
            </Command.Item>
          )}
        </Command.List>
        <div className="cmd-footer">
          <span><kbd className="cmd-key">↑</kbd><kbd className="cmd-key">↓</kbd> {t('common.navigate')}</span>
          <span><kbd className="cmd-key"><CornerDownLeft size={10} strokeWidth={2} /></kbd> {t('labels.toggle')}</span>
          <span><kbd className="cmd-key cmd-key--word">esc</kbd> {t('labels.done')}</span>
        </div>
      </Command>
    </Overlay>
  )
}
