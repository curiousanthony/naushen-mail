import type { ThreadAction } from '@shared/types'

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

const noun = (n: number): string => (n === 1 ? 'Conversation' : `${n} conversations`)

/** Toast copy: "Conversation archived", "3 conversations moved to trash". */
export function toastText(kind: 'archive' | 'unarchive' | 'trash' | 'untrash' | 'spam' | 'notSpam' | 'read' | 'unread' | 'star' | 'unstar' | 'mute' | 'unmute', n: number): string {
  const subj = noun(n)
  switch (kind) {
    case 'archive': return `${subj} archived`
    case 'unarchive': return `${subj} moved to inbox`
    case 'trash': return `${subj} moved to trash`
    case 'untrash': return `${subj} restored`
    case 'spam': return `${subj} reported as spam`
    case 'notSpam': return `${subj} moved to inbox`
    case 'read': return `${subj} marked as read`
    case 'unread': return `${subj} marked as unread`
    case 'star': return `${subj} starred`
    case 'unstar': return `${subj} unstarred`
    case 'mute': return `${subj} muted. Replies will skip your inbox`
    case 'unmute': return `${subj} unmuted and moved to inbox`
  }
}
