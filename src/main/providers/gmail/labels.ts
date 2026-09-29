/** Gmail label <-> Mailroom label mapping (system roles + colour palette). */
import type { Label, LabelColor, SystemRole } from '@shared/types'
import { makeId } from '@shared/types'
import type { GmailLabel, GmailLabelColor } from './api-types'

export const SYSTEM_ROLES: Record<string, { role: SystemRole; name: string }> = {
  INBOX: { role: 'inbox', name: 'Inbox' },
  SENT: { role: 'sent', name: 'Sent' },
  DRAFT: { role: 'drafts', name: 'Drafts' },
  TRASH: { role: 'trash', name: 'Trash' },
  SPAM: { role: 'spam', name: 'Spam' },
  IMPORTANT: { role: 'important', name: 'Important' },
  STARRED: { role: 'starred', name: 'Starred' }
}

/** Gmail's inbox-tab category labels, friendly name and fixed display order (Gmail's own tab order). */
export const CATEGORY_NAMES: Record<string, string> = {
  CATEGORY_PERSONAL: 'Primary',
  CATEGORY_SOCIAL: 'Social',
  CATEGORY_PROMOTIONS: 'Promotions',
  CATEGORY_UPDATES: 'Updates',
  CATEGORY_FORUMS: 'Forums'
}
export const CATEGORY_ORDER = Object.keys(CATEGORY_NAMES)

/**
 * Gmail system labels that carry no navigable mailbox meaning here. UNREAD is a boolean on
 * Message/Thread, CHAT is a Gmail-tab artefact with no mail-client analogue, and any CATEGORY_*
 * beyond the five known tabs (Gmail hasn't added one in years, but stay defensive) has no friendly
 * name to show. They are excluded from BOTH listLabels() and thread.labelIds so the store (which
 * prunes thread_labels of labels missing from listLabels) stays consistent. The five known
 * CATEGORY_* ids are handled separately in mapLabels (kind: 'category') and are NOT hidden here.
 */
export function isHiddenLabelId(id: string): boolean {
  return id === 'UNREAD' || id === 'CHAT' || (id.startsWith('CATEGORY_') && !(id in CATEGORY_NAMES))
}

export function mapLabelIds(accountId: string, remoteIds: Iterable<string>): string[] {
  const out = new Set<string>()
  for (const id of remoteIds) if (!isHiddenLabelId(id)) out.add(makeId(accountId, id))
  return [...out]
}

/** Local label id -> Gmail label id (accepts a raw remote id or an unknown id defensively). */
export function toRemoteLabelId(accountId: string, labels: Label[], localOrRemote: string): string {
  const hit = labels.find((l) => l.id === localOrRemote)
  if (hit) return hit.remoteId
  const prefix = accountId + ':'
  return localOrRemote.startsWith(prefix) ? localOrRemote.slice(prefix.length) : localOrRemote
}

export function mapLabels(accountId: string, raw: GmailLabel[]): Label[] {
  const system: Label[] = []
  const category: Label[] = []
  const user: Label[] = []
  for (const l of raw) {
    // CATEGORY_* labels report type:'system' from the API, so this check must come before the
    // system-role branch below — otherwise they'd be mistaken for an unmapped system label and dropped.
    if (l.id in CATEGORY_NAMES) {
      category.push({ id: makeId(accountId, l.id), accountId, remoteId: l.id, name: CATEGORY_NAMES[l.id], kind: 'category' })
    } else if (l.type === 'system' || SYSTEM_ROLES[l.id]) {
      const meta = SYSTEM_ROLES[l.id]
      if (!meta) continue // hidden / unmapped system label
      system.push({ id: makeId(accountId, l.id), accountId, remoteId: l.id, name: meta.name, kind: 'system', role: meta.role })
    } else {
      user.push({
        id: makeId(accountId, l.id), accountId, remoteId: l.id, name: l.name,
        color: l.color ? colorFromGmail(l.color) : undefined, kind: 'user'
      })
    }
  }
  const order = Object.keys(SYSTEM_ROLES)
  system.sort((a, b) => order.indexOf(a.remoteId) - order.indexOf(b.remoteId))
  category.sort((a, b) => CATEGORY_ORDER.indexOf(a.remoteId) - CATEGORY_ORDER.indexOf(b.remoteId))
  user.sort((a, b) => a.name.localeCompare(b.name))
  return [...system, ...category, ...user]
}

// ------------------------------------------------------------------ colours

/** Valid Gmail palette pairs (the API rejects anything else) used when *we* set a colour. */
export const GMAIL_COLOR_FOR: Record<LabelColor, GmailLabelColor> = {
  gray: { backgroundColor: '#999999', textColor: '#ffffff' },
  brown: { backgroundColor: '#a46a21', textColor: '#ffffff' },
  orange: { backgroundColor: '#ffad47', textColor: '#ffffff' },
  yellow: { backgroundColor: '#fad165', textColor: '#000000' },
  green: { backgroundColor: '#16a766', textColor: '#ffffff' },
  blue: { backgroundColor: '#4a86e8', textColor: '#ffffff' },
  purple: { backgroundColor: '#a479e2', textColor: '#ffffff' },
  pink: { backgroundColor: '#f691b3', textColor: '#ffffff' },
  red: { backgroundColor: '#fb4c2f', textColor: '#ffffff' }
}

export function toGmailColor(c: string | undefined): GmailLabelColor | undefined {
  return c ? GMAIL_COLOR_FOR[c as LabelColor] : undefined
}

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h = (h * 60 + 360) % 360
  return { h, s, l }
}

/** Map an arbitrary Gmail background colour to the nearest of our nine label colours. */
export function colorFromGmail(c: GmailLabelColor | undefined): LabelColor | undefined {
  if (!c?.backgroundColor) return undefined
  const hsl = hexToHsl(c.backgroundColor)
  if (!hsl) return undefined
  const { h, s, l } = hsl
  if (s < 0.14 || l > 0.96) return 'gray'
  if (h >= 12 && h < 50 && l < 0.42) return 'brown'
  if (h < 12 || h >= 345) return l < 0.3 ? 'brown' : 'red'
  if (h < 42) return 'orange'
  if (h < 68) return 'yellow'
  if (h < 170) return 'green'
  if (h < 262) return 'blue'
  if (h < 305) return 'purple'
  return 'pink'
}
