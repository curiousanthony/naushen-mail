import type { ThreadWithMessages } from '@shared/types'

/**
 * Tiny in-memory warm cache for full threads (bodies included), so the reader can paint the
 * instant a row is opened. Rows warm a thread on hover intent (150ms) and when the j/k cursor
 * lands on it; the reader reads `peekThread` synchronously and still revalidates in the
 * background, so a stale entry is only ever visible for one round trip.
 *
 * Entries are dropped on sync events (they may be stale) and by LRU.
 */

const MAX = 40
export const HOVER_INTENT_MS = 150

const cache = new Map<string, ThreadWithMessages>()
const inflight = new Map<string, Promise<ThreadWithMessages | null>>()
let subscribed = false

function subscribe(): void {
  if (subscribed || typeof window === 'undefined' || !window.api?.onEvent) return
  subscribed = true
  window.api.onEvent((e) => {
    if (e.type === 'changed' && e.threadIds?.length) for (const id of e.threadIds) cache.delete(id)
    else cache.clear()
  })
}

function put(t: ThreadWithMessages): void {
  cache.delete(t.id)
  cache.set(t.id, t)
  while (cache.size > MAX) cache.delete(cache.keys().next().value as string)
}

/** Synchronous read; also refreshes the entry's LRU position. */
export function peekThread(id: string): ThreadWithMessages | undefined {
  const t = cache.get(id)
  if (t) { cache.delete(id); cache.set(id, t) }
  return t
}

/** Fetch a thread, reusing an in-flight request, and remember it. */
export function fetchThread(id: string): Promise<ThreadWithMessages | null> {
  subscribe()
  const pending = inflight.get(id)
  if (pending) return pending
  const p = window.api.invoke('threads.get', id).then((t) => {
    if (t) put(t)
    return t
  }).finally(() => { inflight.delete(id) })
  inflight.set(id, p)
  return p
}

/** Fire-and-forget warm-up. Cheap no-op when already cached or on the way. */
export function warmThread(id: string): void {
  if (cache.has(id) || inflight.has(id)) return
  void fetchThread(id).catch(() => undefined)
}

export function clearThreadCache(): void { cache.clear() }
