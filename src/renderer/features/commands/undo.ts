import type { ThreadAction } from '@shared/types'
import i18n from '@/i18n'

export interface UndoEntry {
  id: number
  ids: string[]
  inverse: ThreadAction
  label: string
  /** More inverse steps applied after `inverse` (a compound action such as Move to label). */
  extra?: { ids: string[]; action: ThreadAction }[]
}

/** The action that reverses `a`, or null when it cannot be reversed (deleteForever). */
export function invertAction(a: ThreadAction): ThreadAction | null {
  switch (a.type) {
    case 'archive': return { type: 'unarchive' }
    case 'unarchive': return { type: 'archive' }
    case 'trash': return { type: 'untrash' }
    case 'untrash': return { type: 'trash' }
    case 'spam': return { type: 'notSpam' }
    case 'notSpam': return { type: 'spam' }
    case 'markRead': return { type: 'markUnread' }
    case 'markUnread': return { type: 'markRead' }
    case 'star': return { type: 'unstar' }
    case 'unstar': return { type: 'star' }
    case 'addLabel': return { type: 'removeLabel', labelId: a.labelId }
    case 'removeLabel': return { type: 'addLabel', labelId: a.labelId }
    case 'snooze': return { type: 'unsnooze' }
    case 'unsnooze': return null
    case 'remind': return a.at === null ? null : { type: 'remind', at: null }
    case 'deleteForever': return null
    case 'mute': return { type: 'unmute' }
    case 'unmute': return { type: 'mute' }
  }
}

/** Bounded LIFO of reversible actions. `z` pops; the Undo button on a toast removes its entry. */
export class UndoStack {
  private items: UndoEntry[] = []
  private seq = 1
  constructor(private max = 20) {}

  push(ids: string[], inverse: ThreadAction, label: string, extra?: { ids: string[]; action: ThreadAction }[]): UndoEntry {
    const entry: UndoEntry = { id: this.seq++, ids, inverse, label, ...(extra?.length ? { extra } : {}) }
    this.items.push(entry)
    if (this.items.length > this.max) this.items.shift()
    return entry
  }
  pop(): UndoEntry | undefined { return this.items.pop() }
  /** Remove a specific entry (its toast's Undo was clicked). Returns whether it was still present. */
  take(id: number): UndoEntry | undefined {
    const i = this.items.findIndex((e) => e.id === id)
    return i === -1 ? undefined : this.items.splice(i, 1)[0]
  }
  get size(): number { return this.items.length }
  clear(): void { this.items = [] }
}

/** Toast copy: "Conversation archived", "3 conversations moved to trash". */
export function toastText(kind: 'archive' | 'unarchive' | 'trash' | 'untrash' | 'spam' | 'notSpam' | 'read' | 'unread' | 'star' | 'unstar' | 'mute' | 'unmute', n: number): string {
  const o = { count: n }
  switch (kind) {
    case 'archive': return i18n.t('commands:toast.archive', o)
    case 'unarchive': return i18n.t('commands:toast.unarchive', o)
    case 'trash': return i18n.t('commands:toast.trash', o)
    case 'untrash': return i18n.t('commands:toast.untrash', o)
    case 'spam': return i18n.t('commands:toast.spam', o)
    case 'notSpam': return i18n.t('commands:toast.notSpam', o)
    case 'read': return i18n.t('commands:toast.read', o)
    case 'unread': return i18n.t('commands:toast.unread', o)
    case 'star': return i18n.t('commands:toast.star', o)
    case 'unstar': return i18n.t('commands:toast.unstar', o)
    case 'mute': return i18n.t('commands:toast.mute', o)
    case 'unmute': return i18n.t('commands:toast.unmute', o)
  }
}
