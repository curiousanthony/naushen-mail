import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlarmClock, Archive, FolderInput, Mail, MailOpen, ShieldCheck, Tag, Trash2, X } from 'lucide-react'
import type { Label, Thread } from '@shared/types'
import { useApp } from '@/lib/store'
import { Tooltip } from '@/features/tooltip'
import { Popover, useAnchor } from '@/features/sidebar/Popover'
import { performSteps } from '@/features/commands/runner'
import '@/features/gestures/gestures.css'

export interface BulkBarProps {
  selected: Thread[]
  labels: Label[]
}

/** A quiet keycap after a button label: the shortcut is discoverable without adding chrome. */
function Hint({ children }: { children: ReactNode }): JSX.Element {
  return <kbd className="bulk__kbd" aria-hidden>{children}</kbd>
}

/** Actions for the current multi-selection. Slides up while anything is selected. */
export function BulkBar({ selected, labels }: BulkBarProps): JSX.Element | null {
  const { t: tr } = useTranslation('threadlist')
  const act = useApp((s) => s.act)
  const clearSelection = useApp((s) => s.clearSelection)
  const setOverlay = useApp((s) => s.setOverlay)
  const inSpam = useApp((s) => s.nav.kind === 'role' && s.nav.role === 'spam')
  const [anchor, toggle, close] = useAnchor()
  if (!selected.length) return null

  const ids = selected.map((t) => t.id)
  const n = ids.length
  const anyUnread = selected.some((t) => t.unread)
  // Labels can only be applied within the accounts the selection belongs to.
  const accountIds = new Set(selected.map((t) => t.accountId))
  const applicable = labels.filter((l) => l.kind === 'user' && accountIds.has(l.accountId))

  return (
    <div className="bulk" role="toolbar" aria-label={tr('bulk.selectedAria', { count: n })}>
      <span className="bulk__count">{tr('bulk.selected', { count: n })}</span>
      <span className="bulk__sep" />
      {inSpam && (
        <button className="bulk__btn" onClick={() => void act({ type: 'notSpam' }, ids, tr('bulk.movedToInbox', { count: n }))}>
          <ShieldCheck size={14} /> {tr('bulk.notSpam')} <Hint>⇧E</Hint>
        </button>
      )}
      <button className="bulk__btn" onClick={() => void act({ type: 'archive' }, ids, tr('bulk.archived', { count: n }))}>
        <Archive size={14} /> {tr('bulk.archive')} <Hint>E</Hint>
      </button>
      <button className="bulk__btn" onClick={() => void act({ type: 'trash' }, ids, tr('bulk.trashed', { count: n }))}>
        <Trash2 size={14} /> {tr('bulk.trash')} <Hint>#</Hint>
      </button>
      <button className="bulk__btn" onClick={() => void act(anyUnread ? { type: 'markRead' } : { type: 'markUnread' }, ids)}>
        {anyUnread ? <MailOpen size={14} /> : <Mail size={14} />} {anyUnread ? tr('bulk.markRead') : tr('bulk.markUnread')} <Hint>{anyUnread ? '⇧I' : 'U'}</Hint>
      </button>
      <button className="bulk__btn" onClick={toggle} aria-haspopup="menu" aria-expanded={!!anchor} disabled={!applicable.length}>
        <Tag size={14} /> {tr('bulk.label')} <Hint>L</Hint>
      </button>
      <button className="bulk__btn" onClick={() => setOverlay('move-picker')}>
        <FolderInput size={14} /> {tr('bulk.move')} <Hint>V</Hint>
      </button>
      <button className="bulk__btn" onClick={() => setOverlay('snooze')}>
        <AlarmClock size={14} /> {tr('bulk.remind')} <Hint>H</Hint>
      </button>
      <span className="bulk__sep" />
      <Tooltip label={tr('bulk.clearSelection')} shortcut="Esc">
        <button className="bulk__btn bulk__btn--icon" onClick={clearSelection} aria-label={tr('bulk.clearSelection')}>
          <X size={14} />
        </button>
      </Tooltip>

      {anchor && (
        <Popover anchor={anchor} onClose={close} width={220} label={tr('bulk.applyLabel')}>
          <div className="menu__grouplabel">{tr('bulk.applyLabel')}</div>
          {applicable.map((l) => (
            <button
              key={l.id} className="menu__item" data-menuitem
              onClick={() => {
                close()
                // A label belongs to one account: only that account's conversations get it.
                const mine = selected.filter((t) => t.accountId === l.accountId).map((t) => t.id)
                void performSteps([{ ids: mine, action: { type: 'addLabel', labelId: l.id } }], tr('bulk.labelled', { name: l.name }))
              }}
            >
              <span className="menu__icon"><span className="dot" style={{ background: `var(--chip-${l.color ?? 'gray'}-fg)` }} /></span>
              <span className="menu__label"><span className="menu__title">{l.name}</span></span>
            </button>
          ))}
        </Popover>
      )}
    </div>
  )
}
