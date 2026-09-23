/**
 * Minimal iCalendar (RFC 5545) support: enough to read a VEVENT out of a meeting invite and reply
 * to it the way real mail/calendar clients do -- an email back to the organiser carrying a
 * `METHOD:REPLY` VCALENDAR with your PARTSTAT. That reply, not any provider-specific API, is what
 * actually updates the organiser's calendar; Outlook/Gmail's own "Yes/No/Maybe" buttons do the same.
 */

export interface IcsAttendee {
  email: string
  name?: string
  /** Only present when the ICS itself states it (rare in a fresh invite to you). */
  partstat?: string
}

export interface IcsEvent {
  uid: string
  summary: string
  location?: string
  /** Epoch ms. Absent for an all-day / malformed event rather than guessing. */
  start?: number
  end?: number
  allDay: boolean
  organizer?: { email: string; name?: string }
  attendees: IcsAttendee[]
  sequence: number
  /** Raw TZID from DTSTART, if any (e.g. "Europe/Paris") — informational only; we don't convert. */
  tzid?: string
}

/** Unfold RFC 5545 line continuations (a line starting with a space/tab continues the previous one). */
function unfold(text: string): string[] {
  const raw = text.split(/\r\n|\n|\r/)
  const out: string[] = []
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) out[out.length - 1] += line.slice(1)
    else out.push(line)
  }
  return out
}

function unescapeText(s: string): string {
  return s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')
}

interface Prop { name: string; params: Record<string, string>; value: string }

function parseLine(line: string): Prop | null {
  const colon = line.indexOf(':')
  if (colon < 0) return null
  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const parts = head.split(';')
  const name = parts[0].toUpperCase()
  const params: Record<string, string> = {}
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=')
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1)
  }
  return { name, params, value }
}

/** DTSTART/DTEND value -> epoch ms. Handles `YYYYMMDD` (all-day), `YYYYMMDDTHHMMSS[Z]`. UTC ('Z')
 *  and floating/local-with-TZID times are both read as UTC wall-clock -- exact-timezone math is
 *  out of scope for an invite summary card; good enough to show a sensible date/time. */
function parseDate(value: string): { ms: number; allDay: boolean } | null {
  const v = value.trim()
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v)
  if (m) return { ms: Date.UTC(+m[1], +m[2] - 1, +m[3]), allDay: true }
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(v)
  if (m) return { ms: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), allDay: false }
  return null
}

function parseAddr(value: string): string {
  return value.replace(/^mailto:/i, '').trim()
}

/** Find and parse the first VEVENT in an .ics file. Returns null if none / unparsable — never throws. */
export function parseIcs(text: string): IcsEvent | null {
  try {
    const lines = unfold(text)
    let inEvent = false
    const props: Prop[] = []
    for (const raw of lines) {
      const trimmed = raw.trim()
      if (trimmed === 'BEGIN:VEVENT') { inEvent = true; continue }
      if (trimmed === 'END:VEVENT') break
      if (!inEvent) continue
      const p = parseLine(raw)
      if (p) props.push(p)
    }
    if (!inEvent) return null

    const get = (name: string): Prop | undefined => props.find((p) => p.name === name)
    const getAll = (name: string): Prop[] => props.filter((p) => p.name === name)

    const uid = get('UID')?.value.trim()
    if (!uid) return null

    const dtstart = get('DTSTART')
    const dtend = get('DTEND')
    const start = dtstart ? parseDate(dtstart.value) : null
    const end = dtend ? parseDate(dtend.value) : null

    const organizerProp = get('ORGANIZER')
    const organizer = organizerProp
      ? { email: parseAddr(organizerProp.value), name: organizerProp.params.CN }
      : undefined

    const attendees: IcsAttendee[] = getAll('ATTENDEE').map((p) => ({
      email: parseAddr(p.value), name: p.params.CN, partstat: p.params.PARTSTAT
    }))

    return {
      uid,
      summary: unescapeText(get('SUMMARY')?.value ?? '(No title)'),
      location: get('LOCATION') ? unescapeText(get('LOCATION')!.value) : undefined,
      start: start?.ms,
      end: end?.ms,
      allDay: start?.allDay ?? false,
      organizer,
      attendees,
      sequence: Number(get('SEQUENCE')?.value ?? '0') || 0,
      tzid: dtstart?.params.TZID
    }
  } catch {
    return null
  }
}

export type Rsvp = 'ACCEPTED' | 'DECLINED' | 'TENTATIVE'

const foldIcsLine = (line: string): string => {
  // RFC 5545 §3.1: lines >75 octets fold with CRLF + a single leading space.
  if (line.length <= 75) return line
  let out = line.slice(0, 75)
  for (let i = 75; i < line.length; i += 74) out += '\r\n ' + line.slice(i, i + 74)
  return out
}

const dtStamp = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')

/**
 * A `METHOD:REPLY` VCALENDAR for `event`, from `myEmail`, with the given response. This is the
 * attachment a reply email needs for the organiser's calendar to actually update your attendance —
 * matching UID/DTSTART/DTEND/ORGANIZER/SEQUENCE, one ATTENDEE (you) carrying the new PARTSTAT.
 */
export function buildIcsReply(event: IcsEvent, response: Rsvp, myEmail: string, myName?: string): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR', 'PRODID:-//Naushen Mail//RSVP 1.0//EN', 'VERSION:2.0', 'METHOD:REPLY',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${dtStamp(Date.now())}`,
    `SEQUENCE:${event.sequence}`,
    `SUMMARY:${escapeIcsText(event.summary)}`
  ]
  if (event.start) lines.push(`DTSTART${event.allDay ? ';VALUE=DATE' : ''}:${icsDate(event.start, event.allDay)}`)
  if (event.end) lines.push(`DTEND${event.allDay ? ';VALUE=DATE' : ''}:${icsDate(event.end, event.allDay)}`)
  if (event.organizer) lines.push(`ORGANIZER${event.organizer.name ? `;CN=${escapeIcsParam(event.organizer.name)}` : ''}:mailto:${event.organizer.email}`)
  lines.push(`ATTENDEE;PARTSTAT=${response}${myName ? `;CN=${escapeIcsParam(myName)}` : ''}:mailto:${myEmail}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.map(foldIcsLine).join('\r\n') + '\r\n'
}

const icsDate = (ms: number, allDay: boolean): string => {
  const iso = new Date(ms).toISOString()
  return allDay ? iso.slice(0, 10).replace(/-/g, '') : iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}
const escapeIcsText = (s: string): string => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
const escapeIcsParam = (s: string): string => s.replace(/"/g, "'")

export const RSVP_LABEL: Record<Rsvp, string> = { ACCEPTED: 'Yes', DECLINED: 'No', TENTATIVE: 'Maybe' }
