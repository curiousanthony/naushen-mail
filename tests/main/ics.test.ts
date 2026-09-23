import { describe, expect, it } from 'vitest'
import { buildIcsReply, parseIcs } from '../../src/shared/ics'

// A realistic Teams-meeting invite: CRLF line endings, folded LOCATION line, mailto: addresses.
const TEAMS_ICS = [
  'BEGIN:VCALENDAR',
  'PRODID:Microsoft Exchange Server 2010',
  'VERSION:2.0',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'UID:040000008200E00074C5B7101A82E0080000000012345ABCDEF',
  'SEQUENCE:0',
  'DTSTAMP:20261010T090000Z',
  'DTSTART:20261015T140000Z',
  'DTEND:20261015T143000Z',
  'SUMMARY:Sprint planning',
  'LOCATION:Microsoft Teams Meeting;Join at https://teams.microsoft.com/l/meetup-jo',
  ' in/some-very-long-id-that-keeps-going-past-the-fold-boundary-for-sure',
  'ORGANIZER;CN=Jordan Lee:mailto:jordan@acme.example',
  'ATTENDEE;CN=Anthony;RSVP=TRUE;ROLE=REQ-PARTICIPANT:mailto:anthony@acme.example',
  'ATTENDEE;CN=Priya Shah;RSVP=TRUE:mailto:priya@acme.example',
  'DESCRIPTION:Let\\\'s plan the sprint.\\nSee agenda attached.',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

describe('parseIcs', () => {
  it('parses a realistic Teams meeting invite, including a folded LOCATION line', () => {
    const ev = parseIcs(TEAMS_ICS)!
    expect(ev).not.toBeNull()
    expect(ev.uid).toBe('040000008200E00074C5B7101A82E0080000000012345ABCDEF')
    expect(ev.summary).toBe('Sprint planning')
    expect(ev.location).toBe('Microsoft Teams Meeting;Join at https://teams.microsoft.com/l/meetup-join/some-very-long-id-that-keeps-going-past-the-fold-boundary-for-sure')
    expect(ev.start).toBe(Date.UTC(2026, 9, 15, 14, 0, 0))
    expect(ev.end).toBe(Date.UTC(2026, 9, 15, 14, 30, 0))
    expect(ev.allDay).toBe(false)
    expect(ev.organizer).toEqual({ email: 'jordan@acme.example', name: 'Jordan Lee' })
    expect(ev.attendees).toHaveLength(2)
    expect(ev.attendees[0]).toMatchObject({ email: 'anthony@acme.example', name: 'Anthony' })
  })

  it('parses an all-day event (VALUE=DATE, no time component)', () => {
    const ics = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x1\nDTSTART;VALUE=DATE:20261201\nDTEND;VALUE=DATE:20261202\nSUMMARY:Company holiday\nEND:VEVENT\nEND:VCALENDAR'
    const ev = parseIcs(ics)!
    expect(ev.allDay).toBe(true)
    expect(ev.start).toBe(Date.UTC(2026, 11, 1))
  })

  it('returns null for text with no VEVENT, and never throws on garbage input', () => {
    expect(parseIcs('BEGIN:VCALENDAR\nEND:VCALENDAR')).toBeNull()
    expect(parseIcs('not an ics file at all')).toBeNull()
    expect(parseIcs('')).toBeNull()
    expect(() => parseIcs('BEGIN:VEVENT\nUID\nEND:VEVENT')).not.toThrow() // malformed UID line (no colon)
  })

  it('requires a UID to consider the event valid', () => {
    expect(parseIcs('BEGIN:VEVENT\nSUMMARY:No UID here\nEND:VEVENT')).toBeNull()
  })
})

describe('buildIcsReply', () => {
  const event = parseIcs(TEAMS_ICS)!

  it('produces a METHOD:REPLY VCALENDAR carrying the UID, SEQUENCE and my PARTSTAT', () => {
    const reply = buildIcsReply(event, 'ACCEPTED', 'anthony@acme.example', 'Anthony')
    expect(reply).toContain('METHOD:REPLY')
    expect(reply).toContain(`UID:${event.uid}`)
    expect(reply).toContain('SEQUENCE:0')
    expect(reply).toContain('PARTSTAT=ACCEPTED')
    expect(reply).toContain('mailto:anthony@acme.example')
    expect(reply).toContain('ORGANIZER;CN=Jordan Lee:mailto:jordan@acme.example')
    expect(reply).toMatch(/\r\n/) // CRLF line endings per RFC 5545
  })

  it('round-trips through parseIcs (the organiser side would parse our reply the same way)', () => {
    const reply = buildIcsReply(event, 'DECLINED', 'anthony@acme.example', 'Anthony')
    const parsed = parseIcs(reply)!
    expect(parsed.uid).toBe(event.uid)
    expect(parsed.attendees[0]).toMatchObject({ email: 'anthony@acme.example', partstat: 'DECLINED' })
  })

  it('folds long lines at 75 octets with a continuation space (RFC 5545 §3.1)', () => {
    const longName = 'A'.repeat(120)
    const reply = buildIcsReply(event, 'TENTATIVE', 'anthony@acme.example', longName)
    const lines = reply.split('\r\n')
    expect(lines.some((l) => l.length > 76)).toBe(false)
    expect(lines.some((l) => l.startsWith(' '))).toBe(true)
  })
})
