import { memo, useEffect, useRef, useState, type MouseEvent } from 'react'
import { TimeChips } from '@/features/time/TimeChips'
import { AlarmClock, Archive, Check, MailOpen, Mail, Paperclip, RotateCcw, Star, Trash2 } from 'lucide-react'
import type { Account, Label, Thread } from '@shared/types'
import { useApp } from '@/lib/store'
import { initials, listTime } from '@/lib/format'
import { chipStyle } from '@/lib/labels'
import { gravatarUrl } from '@/lib/avatar'
import { Tooltip } from '@/features/tooltip'
import { usePreviewStore } from '@/features/preview'
import { perform } from '@/features/commands/runner'
import { toastText } from '@/features/commands/undo'
import { HOVER_INTENT_MS, warmThread } from '@/features/gestures/threadCache'
import { useRowSwipe } from '@/features/gestures/useRowSwipe'
import { dragPayload, endThreadDrag, startThreadDrag } from '@/features/gestures/dnd'
import { swipeArchiveAction } from '@/features/gestures/plan'
import { rowLabels, senderText } from './lib'
import { CodeChip, useActiveCode } from '@/features/reader/CodeChip'
import '@/features/gestures/gestures.css'

export interface RowProps {
  thread: Thread
  labels: Label[]
  account?: Account
  /** In "All accounts", shown as a quiet tooltip on the avatar (never a colour — see decisions.md). */
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
  // Extension setting (see settings/lib/settings-ext.ts): absent means on.
  const swipeOn = useApp((s) => (s.settings as unknown as { swipeGestures?: boolean }).swipeGestures !== false)
  const chips = rowLabels(t, labels, 2)
  const sender = senderText(t, myEmails)
  // Verification code (<10 min old): a "Copy 482913" chip shown on hover / focus.
  const code = useActiveCode(() => `${t.subject}\n${t.snippet}`, t.lastMessageAt)
  const lead = t.participants.find((p) => !myEmails.has(p.email.toLowerCase())) ?? t.participants[0]
  // The row instance can be reused for a different thread (list re-sort, windowing), so track
  // which email a load failure applies to -- a stale failure must not suppress a new avatar.
  const [failedFor, setFailedFor] = useState<string | null>(null)
  const avatarEmail = lead?.email ?? null
  const avatarFailed = failedFor === avatarEmail

  const remind = (): void => { focus(t.id); setOverlay('snooze') }

  // ---- swipe (trackpad two-finger): left = archive (or restore in Trash/Spam), right = remind.
  const wrapRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const navRole = (): 'trash' | 'spam' | null => {
    const n = useApp.getState().nav
    return n.kind === 'role' && (n.role === 'trash' || n.role === 'spam') ? n.role : null
  }
  const leftKind = swipeArchiveAction(navRole())
  /** A row inside a multi-selection swipes the whole selection; otherwise just itself. */
  const swipeIds = (): string[] => {
    const sel = useApp.getState().selectedIds
    return sel.length > 1 && sel.includes(t.id) ? sel : [t.id]
  }
  const swipe = useRowSwipe({
    enabled: swipeOn,
    rowRef, wrapRef,
    slidesOut: (side) => side === 'left',
    onCommit: (side) => {
      const ids = swipeIds()
      if (side === 'left') {
        const k = swipeArchiveAction(navRole())
        const n = ids.length
        const msg = k.action.type === 'archive' ? toastText('archive', n) : k.action.type === 'untrash' ? toastText('untrash', n) : toastText('notSpam', n)
        void perform(k.action, msg, { ids })
      } else {
        // The reminder picker targets the selection, so make this row (or its selection) the target.
        const before = useApp.getState().selectedIds
        // Targets resolve selection > open thread > cursor: only force a selection when another
        // thread is open (or several are selected), otherwise the cursor alone is enough.
        const open = useApp.getState().openThreadId
        useApp.setState({ focusedId: t.id, selectedIds: ids.length > 1 || (open && open !== t.id) ? ids : [] })
        setOverlay('snooze')
        // Cancelling the picker must not leave this row selected (and the bulk bar up).
        const off = useApp.subscribe((s) => {
          if (s.overlay === 'snooze') return
          off()
          if (s.selectedIds.length === ids.length && ids.every((i) => s.selectedIds.includes(i))) useApp.setState({ selectedIds: before })
        })
      }
    }
  })

  // ---- warm the thread body so opening it is instant: on hover intent and when the j/k cursor lands.
  const warmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!focused) return undefined
    const id = setTimeout(() => warmThread(t.id), 60) // skip the rows a held j/k flies past
    return () => clearTimeout(id)
  }, [focused, t.id])
  useEffect(() => () => { if (warmTimer.current) clearTimeout(warmTimer.current) }, [])

  // Row preview: hover this row for a moment and a floating card tracking the cursor shows a
  // richer preview (see features/preview). Cursor updates are coalesced to one per animation
  // frame so a fast mousemove sweep doesn't hammer the shared store while the card is following.
  const rafRef = useRef<number | null>(null)
  const pendingRef = useRef<number | null>(null)
  const flushCursor = (): void => {
    rafRef.current = null
    const x = pendingRef.current
    if (x !== null) usePreviewStore.getState().updateCursor(t.id, x)
  }
  const onRowMouseEnter = (e: MouseEvent): void => {
    // The card is anchored to the row, not the cursor, vertically: it never bobs up and down as
    // you move within a tall row, only left/right (see PreviewHost.tsx / position.ts).
    const rowY = rowRef.current?.getBoundingClientRect().top ?? e.clientY
    usePreviewStore.getState().scheduleShow(t.id, e.clientX, rowY)
    if (warmTimer.current) clearTimeout(warmTimer.current)
    warmTimer.current = setTimeout(() => warmThread(t.id), HOVER_INTENT_MS)
  }
  const onRowMouseMove = (e: MouseEvent): void => {
    pendingRef.current = e.clientX
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(flushCursor)
  }
  const onRowMouseLeave = (): void => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (warmTimer.current) { clearTimeout(warmTimer.current); warmTimer.current = null }
    usePreviewStore.getState().hide(t.id)
  }
  // A row can unmount mid-hover (the list is virtualized — see threadlist/index.tsx's
  // WINDOW_THRESHOLD/windowRange comments), which skips mouseleave entirely. Guard the preview
  // from getting stuck on a thread whose row is gone.
  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    usePreviewStore.getState().hide(t.id)
  }, [t.id])

  return (
    <div className="trow-wrap" role="presentation" ref={wrapRef} data-swipe={swipe?.side} data-armed={swipe?.armed || undefined}>
      {swipe && (
        <div
          className="trow__reveal" data-side={swipe.side} data-armed={swipe.armed} aria-hidden
          data-kind={swipe.side === 'right' ? 'remind' : leftKind.action.type === 'archive' ? 'archive' : 'restore'}
        >
          <span className="trow__revealbody">
            {swipe.side === 'right'
              ? <><AlarmClock size={16} /><span>Remind</span></>
              : <>{leftKind.action.type === 'archive' ? <Archive size={16} /> : <RotateCcw size={16} />}<span>{leftKind.label}</span></>}
          </span>
        </div>
      )}
    <div
      ref={rowRef}
      className="trow" role="option" aria-selected={selected} id={`trow-${t.id}`}
      data-unread={t.unread} data-selected={selected} data-focused={focused} data-open={open}
      onClick={(e) => onOpen(t.id, e)}
      onDoubleClick={(e) => onOpen(t.id, e)}
      onMouseEnter={onRowMouseEnter}
      onMouseMove={onRowMouseMove}
      onMouseLeave={onRowMouseLeave}
      // Opening/selecting the row should dismiss the preview immediately, even if the click
      // happens without the cursor ever leaving the row. The select checkbox and hover actions
      // stop propagation on their own mousedown, so this only fires for the row body itself.
      onMouseDown={() => usePreviewStore.getState().hide(t.id)}
      draggable
      onDragStart={(e) => {
        usePreviewStore.getState().hide()
        const s = useApp.getState()
        startThreadDrag(e, dragPayload(t, s.selectedIds, s.threads))
      }}
      onDragEnd={endThreadDrag}
    >
      <span className="trow__lead">
        <span className="trow__unread" data-on={t.unread} aria-label={t.unread ? 'Unread' : undefined} />
        {showAvatars && (
          // No account colour here (removed — a different colour per account read as visual
          // noise, not signal, across a long list). The account is still one hover away: the
          // title tooltip below.
          <span className="trow__avatar" title={showAccount && account ? account.email : undefined}>
            {lead ? initials(lead) : '—'}
            {avatarEmail && !avatarFailed && (
              <img
                className="trow__avatarimg" src={gravatarUrl(avatarEmail, 44)} alt=""
                loading="lazy" onError={() => setFailedFor(avatarEmail)}
              />
            )}
          </span>
        )}
        {/* Avatars off: no circle is rendered at all, so the checkbox doesn't overlay anything
            -- it's a normal flush-left flex item (trow__box--bare in threadlist.css) instead of
            reserving a blank 22px circle's worth of space for nothing. */}
        <button
          className="trow__box" data-bare={!showAvatars || undefined} role="checkbox" aria-checked={selected}
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
        <TimeChips thread={t} />
        {code && <CodeChip code={code.code} variant="row" />}
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
    </div>
  )
}

export const Row = memo(RowImpl)
