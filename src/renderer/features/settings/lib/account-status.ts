import { formatDistanceStrict } from 'date-fns'
import type { Account } from '@shared/types'

export type StatusTone = 'ok' | 'busy' | 'warn' | 'error'

export function accountStatus(a: Pick<Account, 'status' | 'statusMessage' | 'lastSyncAt'>, now = Date.now()): { text: string; tone: StatusTone } {
  switch (a.status) {
    case 'syncing': return { text: 'Syncing…', tone: 'busy' }
    case 'reauth': return { text: 'Needs to be reauthorized', tone: 'warn' }
    case 'error': return { text: a.statusMessage || 'Sync error', tone: 'error' }
    default: {
      if (!a.lastSyncAt) return { text: 'Not synced yet', tone: 'ok' }
      const diff = now - a.lastSyncAt
      return { text: diff < 45_000 ? 'Synced just now' : `Synced ${formatDistanceStrict(a.lastSyncAt, now)} ago`, tone: 'ok' }
    }
  }
}
