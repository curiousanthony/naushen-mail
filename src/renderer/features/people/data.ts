import type { PersonHit, PersonInfo } from '@shared/types'

/**
 * Cached, de-duplicated access to the local people index (main: repo.searchPeople/personInfo).
 * The sender card prefetches on hover-enter so the data is usually there by the time the card
 * opens; entries expire quickly so a sync shows up on the next look.
 */
const TTL_MS = 20_000
const info = new Map<string, { at: number; p: Promise<PersonInfo> }>()

export function getPersonInfo(email: string): Promise<PersonInfo> {
  const key = email.toLowerCase()
  const hit = info.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p
  const p = window.api.invoke('people.info', key)
  info.set(key, { at: Date.now(), p })
  p.catch(() => info.delete(key))
  if (info.size > 60) info.delete(info.keys().next().value as string)
  return p
}

export const peekPersonInfo = async (email: string): Promise<PersonInfo | null> => getPersonInfo(email).catch(() => null)

export function searchPeople(query: string, accountId: string, limit = 40): Promise<PersonHit[]> {
  return window.api.invoke('people.search', query, limit, accountId === 'all' ? undefined : [accountId])
}

export const clearPeopleCache = (): void => info.clear()
