import { useEffect, useState } from 'react'
import { Calendar, Check, MapPin } from 'lucide-react'
import type { Attachment, Message } from '@shared/types'
import { buildIcsReply, parseIcs, RSVP_LABEL, type IcsEvent, type Rsvp } from '@shared/ics'
import { useApp } from '@/lib/store'
import { extensionOf } from './fileKinds'

const isIcs = (a: Attachment): boolean =>
  (a.mimeType || '').toLowerCase().includes('calendar') || extensionOf(a.filename) === 'ics'

/** The .ics attachment on this message worth showing an invite card for, if any. */
export function findInvite(attachments: Attachment[]): Attachment | undefined {
  return attachments.find(isIcs)
}

const RSVP_KEY = (uid: string): string => `mailroom.rsvp.${uid}`
const loadResponse = (uid: string): Rsvp | null => {
  try { return (localStorage.getItem(RSVP_KEY(uid)) as Rsvp | null) ?? null } catch { return null }
}
const saveResponse = (uid: string, r: Rsvp): void => {
  try { localStorage.setItem(RSVP_KEY(uid), r) } catch { /* private mode */ }
}

function formatWhen(ev: IcsEvent): string {
  if (!ev.start) return ''
  const d = new Date(ev.start)
  if (ev.allDay) return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const dateStr = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const startStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const endStr = ev.end ? new Date(ev.end).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : null
  return `${dateStr} · ${startStr}${endStr ? `–${endStr}` : ''}`
}

/**
 * A meeting-invite banner above the message body, with Yes/Maybe/No buttons — the same shape
 * Notion Mail (and Outlook/Gmail) show for a `.ics` invite. Responding sends a real `METHOD:REPLY`
 * iCalendar reply email to the organiser (see shared/ics.ts): that's the actual mechanism that
 * updates their calendar, not a provider-specific API call.
 */
export function InviteCard({ message, attachment }: { message: Message; attachment: Attachment }): JSX.Element | null {
  const account = useApp((s) => s.accounts.find((a) => a.id === message.accountId))
  const toast = useApp((s) => s.toast)
  const [event, setEvent] = useState<IcsEvent | null | undefined>(undefined) // undefined = loading
  const [response, setResponse] = useState<Rsvp | null>(null)
  const [sending, setSending] = useState<Rsvp | null>(null)

  useEffect(() => {
    let live = true
    setEvent(undefined)
    void window.api.invoke('attachments.getText', message.id, attachment.id).then((text) => {
      if (!live) return
      const ev = text ? parseIcs(text) : null
      setEvent(ev)
      if (ev) setResponse(loadResponse(ev.uid))
    })
    return () => { live = false }
  }, [message.id, attachment.id])

  if (event === null) return null // not a parsable invite — say nothing rather than show a broken card
  if (event === undefined) return <div className="invite invite--loading">Reading invite…</div>
  if (!account || !event.organizer) return null // no one to send the reply to

  const respond = async (rsvp: Rsvp): Promise<void> => {
    setSending(rsvp)
    try {
      const ics = buildIcsReply(event, rsvp, account.email, account.name)
      await window.api.invoke('compose.send', {
        accountId: account.id,
        to: [event.organizer!],
        cc: [], bcc: [],
        subject: `${RSVP_LABEL[rsvp]}: ${event.summary}`,
        html: `<p>${RSVP_LABEL[rsvp]}, ${escapeHtml(account.name)}.</p>`,
        text: `${RSVP_LABEL[rsvp]}, ${account.name}.`,
        attachments: [{
          filename: 'invite.ics', mimeType: 'text/calendar; method=REPLY; charset=UTF-8',
          dataBase64: btoa(unescape(encodeURIComponent(ics)))
        }],
        inReplyTo: { threadId: message.threadId, messageId: message.id, mode: 'reply' }
      })
      saveResponse(event.uid, rsvp)
      setResponse(rsvp)
      toast({ message: `Reply sent — you're marked as ${RSVP_LABEL[rsvp].toLowerCase()}` })
    } catch {
      toast({ message: 'Could not send your reply. Try again.' })
    } finally {
      setSending(null)
    }
  }

  return (
    <div className="invite">
      <div className="invite__icon"><Calendar size={16} aria-hidden /></div>
      <div className="invite__body">
        <div className="invite__title">{event.summary}</div>
        {event.start && <div className="invite__meta">{formatWhen(event)}</div>}
        {event.location && (
          <div className="invite__meta invite__meta--loc"><MapPin size={12} aria-hidden />{event.location}</div>
        )}
        <div className="invite__actions">
          {(['ACCEPTED', 'TENTATIVE', 'DECLINED'] as Rsvp[]).map((r) => (
            <button
              key={r} className="invite__btn" data-chosen={response === r} disabled={sending !== null}
              onClick={() => void respond(r)}
            >
              {response === r && <Check size={12} aria-hidden />}
              {sending === r ? 'Sending…' : RSVP_LABEL[r]}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
