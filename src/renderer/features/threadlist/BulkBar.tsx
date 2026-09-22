import { AlarmClock, Archive, Mail, MailOpen, Tag, Trash2, X } from 'lucide-react'
import type { Label, Thread } from '@shared/types'
import { useApp } from '@/lib/store'
import { Popover, useAnchor } from '@/features/sidebar/Popover'

export interface BulkBarProps {
  selected: Thread[]
  labels: Label[]
}

/** Actions for the current multi-selection. Slides up while anything is selected. */
export function BulkBar({ selected, labels }: BulkBarProps): JSX.Element | null {
  const act = useApp((s) => s.act)
  const clearSelection = useApp((s) => s.clearSelection)
  const setOverlay = useApp((s) => s.setOverlay)
  const [anchor, toggle, close] = useAnchor()
  if (!selected.length) return null

  const ids = selected.map((t) => t.id)
  const n = ids.length
  const plural = `${n} conversation${n === 1 ? '' : 's'}`
  const anyUnread = selected.some((t) => t.unread)
  // Labels can only be applied within the accounts the selection belongs to.
  const accountIds = new Set(selected.map((t) => t.accountId))
  const applicable = labels.filter((l) => l.kind === 'user' && accountIds.has(l.accountId))

  return (
    <div className="bulk" role="toolbar" aria-label={`${plural} selected`}>
      <span className="bulk__count">{n} selected</span>
      <span className="bulk__sep" />
      <button className="bulk__btn" onClick={() => void act({ type: 'archive' }, ids, `${plural} archived`)}>
        <Archive size={14} /> Archive
      </button>
      <button className="bulk__btn" onClick={() => void act({ type: 'trash' }, ids, `${plural} moved to trash`)}>
        <Trash2 size={14} /> Trash
      </button>
      <button className="bulk__btn" onClick={() => void act(anyUnread ? { type: 'markRead' } : { type: 'markUnread' }, ids)}>
        {anyUnread ? <MailOpen size={14} /> : <Mail size={14} />} {anyUnread ? 'Mark read' : 'Mark unread'}
      </button>
      <button className="bulk__btn" onClick={toggle} aria-haspopup="menu" aria-expanded={!!anchor} disabled={!applicable.length}>
        <Tag size={14} /> Label
      </button>
      <button className="bulk__btn" onClick={() => setOverlay('snooze')}>
        <AlarmClock size={14} /> Remind
      </button>
      <span className="bulk__sep" />
      <button className="bulk__btn bulk__btn--icon" onClick={clearSelection} title="Clear selection" aria-label="Clear selection">
        <X size={14} />
      </button>

      {anchor && (
        <Popover anchor={anchor} onClose={close} width={220} label="Apply label">
          <div className="menu__grouplabel">Apply label</div>
          {applicable.map((l) => (
            <button
              key={l.id} className="menu__item" data-menuitem
              onClick={() => { close(); void act({ type: 'addLabel', labelId: l.id }, ids, `Labelled “${l.name}”`) }}
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
