import { memo, useState, type MouseEvent } from 'react'
import { AlarmClock, Archive, Check, MailOpen, Mail, Paperclip, Star, Trash2 } from 'lucide-react'
import type { Account, Label, Thread } from '@shared/types'
import { useApp } from '@/lib/store'
import { initials, listTime } from '@/lib/format'
import { chipStyle } from '@/lib/labels'
import { gravatarUrl } from '@/lib/avatar'
import { Tooltip } from '@/features/tooltip'
import { rowLabels, senderText } from './lib'

export interface RowProps {
  thread: Thread
  labels: Label[]
  account?: Account
  /** Tint the avatar with the account colour (only meaningful when viewing all accounts). */
  showAccount: boolean
  myEmails: Set<string>
  selected: boolean
  focused: boolean
  open: boolean
  /** Id is passed back so the list can keep these callbacks stable and `memo` effective. */
  onSelect(id: string, e: MouseEvent): void
  onOpen(id: string, e: MouseEvent): void
}

function Action({ label, on, onClick, children }: {
  label: string; on?: boolean; onClick(): void; children: React.ReactNode
}): JSX.Element {
  return (
    <Tooltip label={label}>
      <button
        className="trow__act" data-on={!!on} aria-label={label}
        // Out of the tab order: a 300-row list would otherwise be ~1500 stops, and these
        // actions are all reachable from the keyboard through the commands feature.
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); onClick() }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </button>
    </Tooltip>
  )
}

/** One conversation. ~40px comfortable / 32px compact; hover actions replace the time. */
function RowImpl({
  thread: t, labels, account, showAccount, myEmails, selected, focused, open, onSelect, onOpen
}: RowProps): JSX.Element {
  const act = useApp((s) => s.act)
  const focus = useApp((s) => s.focus)
  const setOverlay = useApp((s) => s.setOverlay)
  const showAvatars = useApp((s) => s.settings.showAvatars)
  const chips = rowLabels(t, labels, 2)
  const sender = senderText(t, myEmails)
  const lead = t.participants.find((p) => !myEmails.has(p.email.toLowerCase())) ?? t.participants[0]
  // The row instance can be reused for a different thread (list re-sort, windowing), so track
  // which email a load failure applies to -- a stale failure must not suppress a new avatar.
  const [failedFor, setFailedFor] = useState<string | null>(null)
  const avatarEmail = lead?.email ?? null
  const avatarFailed = failedFor === avatarEmail

  const remind = (): void => { focus(t.id); setOverlay('snooze') }

  return (
    <div
      className="trow" role="option" aria-selected={selected} id={`trow-${t.id}`}
      data-unread={t.unread} data-selected={selected} data-focused={focused} data-open={open}
      onClick={(e) => onOpen(t.id, e)}
      onDoubleClick={(e) => onOpen(t.id, e)}
    >
      <span className="trow__lead">
        <span className="trow__unread" data-on={t.unread} aria-label={t.unread ? 'Unread' : undefined} />
        <span
          className="trow__avatar"
          style={showAccount && account ? { background: account.color, color: '#fff' } : undefined}
          title={account ? account.email : undefined}
        >
          {lead ? initials(lead) : '—'}
          {showAvatars && avatarEmail && !avatarFailed && (
            <img
              className="trow__avatarimg" src={gravatarUrl(avatarEmail, 44)} alt=""
              loading="lazy" onError={() => setFailedFor(avatarEmail)}
            />
          )}
        </span>
        {/* Overlays the avatar on hover / when selected. */}
        <button
          className="trow__box" role="checkbox" aria-checked={selected}
          aria-label={selected ? 'Deselect conversation' : 'Select conversation'}
          onClick={(e) => { e.stopPropagation(); onSelect(t.id, e) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {selected && <Check size={12} strokeWidth={3} />}
        </button>
      </span>

      <span className="trow__sender">{sender || t.subject}</span>

      <span className="trow__text">
        <span className="trow__subject">{t.subject || '(no subject)'}</span>
        {t.messageCount > 1 && <span className="trow__count">{t.messageCount}</span>}
        {t.snippet && <span className="trow__snippet">{t.snippet}</span>}
      </span>

      <span className="trow__meta">
        {chips.map((l) => (
          <span key={l.id} className="trow__chip" style={chipStyle(l.color)}>{l.name}</span>
        ))}
        {t.hasAttachments && <Paperclip size={12} className="trow__clip" aria-label="Has attachments" />}
        {t.starred && <Star size={12} className="trow__starred" fill="currentColor" aria-label="Starred" />}
      </span>

      <span className="trow__right">
        <span className="trow__time">{listTime(t.lastMessageAt)}</span>
        <span className="trow__actions">
          <Action label={t.starred ? 'Unstar' : 'Star'} on={t.starred} onClick={() => void act(t.starred ? { type: 'unstar' } : { type: 'star' }, [t.id])}>
            <Star size={14} fill={t.starred ? 'currentColor' : 'none'} />
          </Action>
          <Action label={t.unread ? 'Mark as read' : 'Mark as unread'} onClick={() => void act(t.unread ? { type: 'markRead' } : { type: 'markUnread' }, [t.id])}>
            {t.unread ? <MailOpen size={14} /> : <Mail size={14} />}
          </Action>
          <Action label="Set reminder" onClick={remind}><AlarmClock size={14} /></Action>
          <Action label="Archive" onClick={() => void act({ type: 'archive' }, [t.id], 'Conversation archived')}><Archive size={14} /></Action>
          <Action label="Move to trash" onClick={() => void act({ type: 'trash' }, [t.id], 'Moved to trash')}><Trash2 size={14} /></Action>
        </span>
      </span>
    </div>
  )
}

export const Row = memo(RowImpl)
