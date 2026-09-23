import { useState } from 'react'
import { ChevronDown, ChevronRight, Paperclip } from 'lucide-react'
import type { Address, Message } from '@shared/types'
import { useApp } from '@/lib/store'
import { displayName, fullDate, initials, listTime } from '@/lib/format'
import { gravatarUrl } from '@/lib/avatar'
import { MessageBody } from './MessageBody'
import { Attachments } from './Attachments'
import { visibleAttachments } from './fileKinds'
import { InviteCard, findInvite } from './InviteCard'

const AVATAR_TINTS = ['blue', 'green', 'orange', 'purple', 'pink', 'red', 'yellow', 'brown'] as const

/**
 * Stable per-sender avatar colour. A hash, not a counter, so the same person keeps the same
 * colour in every thread and across launches.
 */
function avatarTint(email: string): string {
  let h = 0
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0
  return AVATAR_TINTS[h % AVATAR_TINTS.length]
}

const addressList = (list: Address[]): string =>
  list.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(', ')

interface Props {
  message: Message
  expanded: boolean
  onToggle(): void
  blockRemoteImages: boolean
}

/**
 * One message in the thread stack: a one-line row when collapsed, a full card when expanded.
 * The recipient detail (`from`/`to`/`cc`) is a second, independent toggle inside the card.
 */
export function MessageCard({ message, expanded, onToggle, blockRemoteImages }: Props): JSX.Element {
  const [showDetail, setShowDetail] = useState(false)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const showAvatars = useApp((s) => s.settings.showAvatars)
  const tint = avatarTint(message.from.email)
  const name = displayName(message.from)
  const recipients = [...message.to, ...message.cc]
  const attachments = visibleAttachments(message.attachments)
  const invite = findInvite(message.attachments)

  const head = (
    <>
      <span
        className="msg__avatar"
        style={{ background: `var(--chip-${tint}-fg)` }}
        aria-hidden
      >
        {initials(message.from)}
        {showAvatars && !avatarFailed && (
          <img
            className="msg__avatarimg" src={gravatarUrl(message.from.email, 64)} alt=""
            loading="lazy" onError={() => setAvatarFailed(true)}
          />
        )}
      </span>
      <span className="msg__headtext">
        <span className="msg__line">
          <span className="msg__from">{name}</span>
          {message.unread && <span className="msg__unread-dot" aria-label="Unread" />}
          {!expanded && <span className="msg__snippet">{message.snippet}</span>}
        </span>
        {expanded && (
          <span className="msg__to">
            <span>
              to {recipients.length ? recipients.map(displayName).join(', ') : 'me'}
            </span>
            <button
              className="msg__detail-toggle"
              onClick={(e) => { e.stopPropagation(); setShowDetail((v) => !v) }}
              aria-expanded={showDetail}
              aria-label={showDetail ? 'Hide recipient details' : 'Show recipient details'}
              title={showDetail ? 'Hide details' : 'Show details'}
            >
              {showDetail ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
            </button>
          </span>
        )}
      </span>
      <span className="msg__aside">
        {attachments.length > 0 && (
          <span className="msg__clip" title={`${attachments.length} attachment${attachments.length > 1 ? 's' : ''}`}>
            <Paperclip size={13} aria-hidden />
          </span>
        )}
        <time dateTime={new Date(message.date).toISOString()} title={fullDate(message.date)}>
          {expanded ? fullDate(message.date) : listTime(message.date)}
        </time>
      </span>
    </>
  )

  return (
    <article className={`msg ${expanded ? 'msg--expanded' : 'msg--collapsed'}`}>
      {expanded ? (
        <div className="msg__head">{head}</div>
      ) : (
        <button
          className="msg__head"
          onClick={onToggle}
          aria-expanded={false}
          title="Expand message"
        >
          {head}
        </button>
      )}

      {expanded && showDetail && (
        <dl className="msg__detail selectable">
          <dt>From</dt>
          <dd>{addressList([message.from])}</dd>
          {message.replyTo && <><dt>Reply-to</dt><dd>{addressList([message.replyTo])}</dd></>}
          <dt>To</dt>
          <dd>{message.to.length ? addressList(message.to) : '—'}</dd>
          {message.cc.length > 0 && <><dt>Cc</dt><dd>{addressList(message.cc)}</dd></>}
          {message.bcc.length > 0 && <><dt>Bcc</dt><dd>{addressList(message.bcc)}</dd></>}
          <dt>Date</dt>
          <dd>{fullDate(message.date)}</dd>
        </dl>
      )}

      {expanded && (
        <div className="msg__body-wrap selectable">
          {invite && <InviteCard message={message} attachment={invite} />}
          <MessageBody message={message} blockRemoteImages={blockRemoteImages} />
          <Attachments messageId={message.id} attachments={message.attachments} />
        </div>
      )}
    </article>
  )
}
