/**
 * Which "From" identity a message goes out as, and which signature travels with it.
 * Pure so the rules are testable; `Composer` only feeds it state.
 */

import type { Account, Message } from '@shared/types'

/**
 * Replies leave from the account the conversation lives in (Gmail/Outlook both reject or
 * mis-thread a reply sent from another mailbox). Falls back to what the composer opened
 * with when the message's account is unknown.
 */
export function pickReplyAccount(
  msg: Pick<Message, 'accountId'> | undefined,
  accounts: Pick<Account, 'id'>[],
  current: string
): string {
  if (msg && accounts.some((a) => a.id === msg.accountId)) return msg.accountId
  return current
}

/** The sanitiser runs at render/serialise time; here we only pick and trim. */
export function signatureFor(signatures: Record<string, string> | undefined, accountId: string): string {
  return signatures?.[accountId]?.trim() || ''
}
