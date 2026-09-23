import type { GmailHistoryRecord } from './api-types'

export interface HistoryDiff {
  /** Thread ids touched by any history record (added / deleted / label changes), in first-seen order. */
  threadIds: string[]
}

/**
 * Reduce `history.list` records to the set of affected thread ids. We deliberately do not try to replay label
 * deltas locally: refetching the whole thread is one call and can never drift from server truth. Threads that
 * turn out not to exist any more (404) are reported as deleted by the adapter.
 */
export function diffHistory(records: readonly GmailHistoryRecord[]): HistoryDiff {
  const seen = new Set<string>()
  const add = (id: string | undefined): void => { if (id) seen.add(id) }
  for (const r of records) {
    for (const m of r.messages ?? []) add(m.threadId)
    for (const x of r.messagesAdded ?? []) add(x.message.threadId)
    for (const x of r.messagesDeleted ?? []) add(x.message.threadId)
    for (const x of r.labelsAdded ?? []) add(x.message.threadId)
    for (const x of r.labelsRemoved ?? []) add(x.message.threadId)
  }
  return { threadIds: [...seen] }
}
