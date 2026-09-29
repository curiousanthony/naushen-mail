import { TimeChips } from '@/features/time/TimeChips'
import {
  Archive, BellOff, ChevronsRight, Clock, MailOpen, ShieldAlert, Star, Tag, Trash2
} from 'lucide-react'
import type { Label, ThreadWithMessages } from '@shared/types'
import { useApp } from '@/lib/store'
import { chipStyle } from '@/lib/labels'
import { Tooltip } from '@/features/tooltip'
import { findUnsubscribe } from './unsubscribe'

interface Props {
  thread: ThreadWithMessages
  labels: Label[]
  onClose(): void
}

/**
 * Subject, label chips and the action row.
 *
 * Actions go through `useApp().act`, which is optimistic and raises the undo toast; the reader
 * never talks to the provider itself.
 *
 * Every action is a plain button here -- there used to also be a "..." menu repeating four of
 * them, plus a second "Close" button doing exactly what "Collapse" already does (both just call
 * `onClose`). Esc already collapses the reader (see commands/shortcuts.ts's 'nav.back' and this
 * button's own tooltip), so neither ever did anything a keystroke or the collapse button didn't.
 */
export function ThreadHeader({ thread, labels, onClose }: Props): JSX.Element {
  const act = useApp((s) => s.act)
  const setOverlay = useApp((s) => s.setOverlay)

  const unsub = findUnsubscribe(thread.messages)
  const threadLabels = thread.labelIds
    .map((id) => labels.find((l) => l.id === id))
    .filter((l): l is Label => !!l && l.kind === 'user')

  const ids = [thread.id]

  const unsubscribe = (): void => {
    if (!unsub) return
    void window.api.invoke('app.openExternal', unsub.url)
  }

  return (
    <header className="reader__header">
      <div className="reader__header-inner">
        <div className="reader__actions no-drag">
          <Tooltip label="Collapse" shortcut="Esc">
            <button className="reader__btn reader__btn--collapse" onClick={onClose} aria-label="Collapse thread">
              <ChevronsRight size={17} aria-hidden />
            </button>
          </Tooltip>

          {/* Pushes everything below to the right edge -- the collapse control is the one thing
              that reads naturally at the leading edge, Mac-panel style; every action on the
              message itself lines up along the trailing edge instead, in the same order the
              (now-removed) "..." menu used to list them. */}
          <span className="reader__actions-spacer" />

          <Tooltip label="Mark as unread" shortcut="U">
            <button className="reader__btn" onClick={() => void act({ type: 'markUnread' }, ids, 'Marked as unread')} aria-label="Mark as unread">
              <MailOpen size={17} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip label="Label" shortcut="L">
            <button className="reader__btn" onClick={() => setOverlay('label-picker')} aria-label="Label">
              <Tag size={17} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip label="Set reminder" shortcut="H">
            <button className="reader__btn" onClick={() => setOverlay('snooze')} aria-label="Set reminder">
              <Clock size={17} aria-hidden />
            </button>
          </Tooltip>
          {unsub && (
            <Tooltip label={unsub.kind === 'http' ? 'Opens in your browser' : 'Sends an email'}>
              <button className="reader__btn" onClick={unsubscribe}>
                <BellOff size={17} aria-hidden />
                <span className="reader__btn-label">Unsubscribe</span>
              </button>
            </Tooltip>
          )}
          <Tooltip label="Report spam" shortcut="!">
            <button className="reader__btn" onClick={() => void act({ type: 'spam' }, ids, 'Reported as spam')} aria-label="Report spam">
              <ShieldAlert size={17} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip label="Move to trash" shortcut="#">
            <button className="reader__btn is-danger" onClick={() => void act({ type: 'trash' }, ids, 'Moved to trash')} aria-label="Move to trash">
              <Trash2 size={17} aria-hidden />
            </button>
          </Tooltip>

          {/* Archive and Star aren't in that menu's list (they never were menu-only), so they
              keep their long-standing spot at the trailing end, most-reached-for first. */}
          <Tooltip label={thread.starred ? 'Unstar' : 'Star'} shortcut="S">
            <button
              className="reader__btn"
              onClick={() => void act({ type: thread.starred ? 'unstar' : 'star' }, ids)}
              aria-pressed={thread.starred}
              aria-label={thread.starred ? 'Unstar' : 'Star'}
            >
              <Star
                size={17}
                aria-hidden
                fill={thread.starred ? 'var(--c-star)' : 'none'}
                color={thread.starred ? 'var(--c-star)' : undefined}
              />
            </button>
          </Tooltip>
          <Tooltip label="Archive" shortcut="E">
            <button className="reader__btn" onClick={() => void act({ type: 'archive' }, ids, 'Conversation archived')} aria-label="Archive">
              <Archive size={17} aria-hidden />
            </button>
          </Tooltip>
        </div>

        <h1 className="reader__subject selectable">{thread.subject || '(no subject)'}</h1>

        {(threadLabels.length > 0 || thread.messageCount > 1 || thread.snoozedUntil || thread.reminderAt || thread.followUpFiredAt) && (
          <div className="reader__meta">
            <TimeChips thread={thread} />
            {threadLabels.map((l) => (
              <span key={l.id} className="reader__chip" style={chipStyle(l.color)}>{l.name}</span>
            ))}
            {thread.messageCount > 1 && (
              <span className="reader__count">{thread.messageCount} messages</span>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
