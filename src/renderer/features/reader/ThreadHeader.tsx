import { useEffect, useRef, useState } from 'react'
import {
  Archive, BellOff, Clock, MailOpen, MoreHorizontal, ShieldAlert, Star, Tag, Trash2, X
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
 */
export function ThreadHeader({ thread, labels, onClose }: Props): JSX.Element {
  const act = useApp((s) => s.act)
  const setOverlay = useApp((s) => s.setOverlay)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuWrap = useRef<HTMLDivElement>(null)

  const unsub = findUnsubscribe(thread.messages)
  const threadLabels = thread.labelIds
    .map((id) => labels.find((l) => l.id === id))
    .filter((l): l is Label => !!l && l.kind === 'user')

  // Close the "..." menu on an outside click or Escape, without stealing Escape from the reader.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (!menuWrap.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopPropagation(); setMenuOpen(false) }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [menuOpen])

  const ids = [thread.id]

  const unsubscribe = (): void => {
    if (!unsub) return
    setMenuOpen(false)
    void window.api.invoke('app.openExternal', unsub.url)
  }

  return (
    <header className="reader__header">
      <div className="reader__header-inner">
        <div className="reader__actions no-drag">
          <Tooltip label="Archive" shortcut="E">
            <button
              className="reader__btn"
              onClick={() => void act({ type: 'archive' }, ids, 'Conversation archived')}
              aria-label="Archive"
            >
              <Archive size={17} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip label="Move to trash" shortcut="#">
            <button
              className="reader__btn is-danger"
              onClick={() => void act({ type: 'trash' }, ids, 'Moved to trash')}
              aria-label="Move to trash"
            >
              <Trash2 size={17} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip label="Mark as unread" shortcut="U">
            <button
              className="reader__btn"
              onClick={() => void act({ type: 'markUnread' }, ids, 'Marked as unread')}
              aria-label="Mark as unread"
            >
              <MailOpen size={17} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip label="Label" shortcut="L">
            <button
              className="reader__btn"
              onClick={() => setOverlay('label-picker')}
              aria-label="Label"
            >
              <Tag size={17} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip label="Set reminder" shortcut="H">
            <button
              className="reader__btn"
              onClick={() => setOverlay('snooze')}
              aria-label="Set reminder"
            >
              <Clock size={17} aria-hidden />
            </button>
          </Tooltip>
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
          <Tooltip label="Report spam" shortcut="!">
            <button
              className="reader__btn"
              onClick={() => void act({ type: 'spam' }, ids, 'Reported as spam')}
              aria-label="Report spam"
            >
              <ShieldAlert size={17} aria-hidden />
            </button>
          </Tooltip>
          {unsub && (
            <Tooltip label={unsub.kind === 'http' ? 'Opens in your browser' : 'Sends an email'}>
              <button
                className="reader__btn"
                onClick={unsubscribe}
              >
                <BellOff size={17} aria-hidden />
                <span className="reader__btn-label">Unsubscribe</span>
              </button>
            </Tooltip>
          )}

          <span className="reader__actions-spacer" />

          <div className="reader__menu-wrap" ref={menuWrap}>
            <Tooltip label="More actions">
              <button
                className="reader__btn"
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="More actions"
              >
                <MoreHorizontal size={17} aria-hidden />
              </button>
            </Tooltip>
            {menuOpen && (
              <div className="reader__menu" role="menu">
                <button
                  className="reader__menu-item"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); void act({ type: 'markUnread' }, ids, 'Marked as unread') }}
                >
                  <MailOpen size={15} aria-hidden /> Mark as unread <span className="reader__menu-key">u</span>
                </button>
                <button
                  className="reader__menu-item"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); setOverlay('label-picker') }}
                >
                  <Tag size={15} aria-hidden /> Add label <span className="reader__menu-key">l</span>
                </button>
                <button
                  className="reader__menu-item"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); setOverlay('snooze') }}
                >
                  <Clock size={15} aria-hidden /> Set reminder <span className="reader__menu-key">h</span>
                </button>
                {unsub && (
                  <button className="reader__menu-item" role="menuitem" onClick={unsubscribe}>
                    <BellOff size={15} aria-hidden /> Unsubscribe
                  </button>
                )}
                <div className="reader__menu-sep" />
                <button
                  className="reader__menu-item is-danger"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); void act({ type: 'spam' }, ids, 'Reported as spam') }}
                >
                  <ShieldAlert size={15} aria-hidden /> Report spam <span className="reader__menu-key">!</span>
                </button>
                <button
                  className="reader__menu-item is-danger"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); void act({ type: 'trash' }, ids, 'Moved to trash') }}
                >
                  <Trash2 size={15} aria-hidden /> Move to trash <span className="reader__menu-key">#</span>
                </button>
              </div>
            )}
          </div>

          <Tooltip label="Close" shortcut="Esc">
            <button className="reader__btn" onClick={onClose} aria-label="Close thread">
              <X size={17} aria-hidden />
            </button>
          </Tooltip>
        </div>

        <h1 className="reader__subject selectable">{thread.subject || '(no subject)'}</h1>

        {(threadLabels.length > 0 || thread.messageCount > 1) && (
          <div className="reader__meta">
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
