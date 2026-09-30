import { useState } from 'react'
import { Check, ChevronDown, Copy, ChevronRight, CornerUpLeft, CornerUpRight, Paperclip, ReplyAll } from 'lucide-react'
import type { Address, Message } from '@shared/types'
import type { TrackerHit } from '@shared/sanitize'
import { useApp } from '@/lib/store'
import { displayName, fullDate, initials, listTime } from '@/lib/format'
import { gravatarUrl } from '@/lib/avatar'
import { Tooltip } from '@/features/tooltip'
import { SenderName } from '../people'
import { MessageBody } from './MessageBody'
import { Attachments } from './Attachments'
import { visibleAttachments } from './fileKinds'
import { InviteCard, findInvite } from './InviteCard'
import { TrackerShield } from './shield'
import { CodeChip, useActiveCode } from './CodeChip'
import { messageCodeText } from './codes'
import { copyText } from './clipboard'
import { joinAddresses } from './addressCopy'

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

/** One detail row: the addresses plus a copy button (bare addresses, ", "-joined). */
function AddressRow({ label, list }: { label: string; list: Address[] }): JSX.Element {
  const [done, setDone] = useState(false)
  const copy = async (): Promise<void> => {
    if (!(await copyText(joinAddresses(list)))) return
    setDone(true)
    window.setTimeout(() => setDone(false), 1400)
  }
  return (
    <>
      <dt>{label}</dt>
      <dd className="msg__detail-row">
        <span className="msg__detail-val">{addressList(list)}</span>
        <Tooltip label={done ? '' : `Copy ${label}`}>
          <button
            type="button" className={`msg__copy${done ? ' is-done' : ''}`}
            onClick={(e) => { e.stopPropagation(); void copy() }}
            aria-label={`Copy ${label} address${list.length > 1 ? 'es' : ''}`}
          >
            {done ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
            {done && <span role="status">Copied</span>}
          </button>
        </Tooltip>
      </dd>
    </>
  )
}

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
  const [trackers, setTrackers] = useState<TrackerHit[]>([])
  const code = useActiveCode(() => messageCodeText(message), message.date)
  const showAvatars = useApp((s) => s.settings.showAvatars)
  const openComposer = useApp((s) => s.openComposer)
  const tint = avatarTint(message.from.email)
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
          <SenderName address={message.from} className="msg__from" />
          {message.unread && <span className="msg__unread-dot" aria-label="Unread" />}
          {!expanded && <span className="msg__snippet">{message.snippet}</span>}
        </span>
        {expanded && (
          <Tooltip label={showDetail ? 'Hide details' : 'Show details'}>
            <button
              type="button"
              className="msg__to"
              onClick={(e) => { e.stopPropagation(); setShowDetail((v) => !v) }}
              aria-expanded={showDetail}
              aria-label={showDetail ? 'Hide recipient details' : 'Show recipient details'}
            >
              <span>
                to {recipients.length ? recipients.map(displayName).join(', ') : 'me'}
              </span>
              {showDetail ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
            </button>
          </Tooltip>
        )}
      </span>
      <span className="msg__aside">
        {expanded && <TrackerShield trackers={trackers} />}
        {attachments.length > 0 && (
          <Tooltip label={`${attachments.length} attachment${attachments.length > 1 ? 's' : ''}`}>
            <span className="msg__clip" role="img" aria-label={`${attachments.length} attachment${attachments.length > 1 ? 's' : ''}`}>
              <Paperclip size={13} aria-hidden />
            </span>
          </Tooltip>
        )}
        <time dateTime={new Date(message.date).toISOString()} title={fullDate(message.date)}>
          {expanded ? fullDate(message.date) : listTime(message.date)}
        </time>
        {expanded && (
          <span className="msg__quickreply">
            <Tooltip label="Reply" shortcut="R">
              <button
                type="button" className="msg__quickbtn" aria-label="Reply"
                onClick={(e) => { e.stopPropagation(); openComposer({ mode: 'reply', threadId: message.threadId, messageId: message.id, placement: 'inline' }) }}
              ><CornerUpLeft size={19} aria-hidden /></button>
            </Tooltip>
            <Tooltip label="Reply all" shortcut="A">
              <button
                type="button" className="msg__quickbtn" aria-label="Reply all"
                onClick={(e) => { e.stopPropagation(); openComposer({ mode: 'replyAll', threadId: message.threadId, messageId: message.id, placement: 'inline' }) }}
              ><ReplyAll size={19} aria-hidden /></button>
            </Tooltip>
            <Tooltip label="Forward" shortcut="F">
              <button
                type="button" className="msg__quickbtn" aria-label="Forward"
                onClick={(e) => { e.stopPropagation(); openComposer({ mode: 'forward', threadId: message.threadId, messageId: message.id, placement: 'inline' }) }}
              ><CornerUpRight size={19} aria-hidden /></button>
            </Tooltip>
          </span>
        )}
      </span>
    </>
  )

  return (
    <article className={`msg ${expanded ? 'msg--expanded' : 'msg--collapsed'}`}>
      {expanded ? (
        <div className="msg__head">{head}</div>
      ) : (
        <Tooltip label="Expand message">
          <button
            className="msg__head"
            onClick={onToggle}
            aria-expanded={false}
          >
            {head}
          </button>
        </Tooltip>
      )}

      {expanded && showDetail && (
        <dl className="msg__detail selectable">
          <AddressRow label="From" list={[message.from]} />
          {message.replyTo && <AddressRow label="Reply-to" list={[message.replyTo]} />}
          {message.to.length > 0 ? <AddressRow label="To" list={message.to} /> : <><dt>To</dt><dd>—</dd></>}
          {message.cc.length > 0 && <AddressRow label="Cc" list={message.cc} />}
          {message.bcc.length > 0 && <AddressRow label="Bcc" list={message.bcc} />}
          <dt>Date</dt>
          <dd>{fullDate(message.date)}</dd>
        </dl>
      )}

      {expanded && (
        <div className="msg__body-wrap selectable">
          {code && <CodeChip code={code.code} variant="message" />}
          {invite && <InviteCard message={message} attachment={invite} />}
          <MessageBody message={message} blockRemoteImages={blockRemoteImages} onTrackers={setTrackers} />
          <Attachments messageId={message.id} attachments={message.attachments} />
        </div>
      )}
    </article>
  )
}
