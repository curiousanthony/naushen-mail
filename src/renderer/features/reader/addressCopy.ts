import type { Address } from '@shared/types'

/**
 * Clipboard text for a header row. Bare addresses joined with ", " (the RFC 5322 header
 * separator), which pastes correctly into any mail client's recipient field. A single address
 * keeps its display name ("Name <addr>") since there is no list to keep parseable.
 */
export function joinAddresses(list: Address[]): string {
  const valid = list.filter((a) => a.email)
  if (valid.length === 1) {
    const a = valid[0]
    return a.name ? `${a.name} <${a.email}>` : a.email
  }
  return valid.map((a) => a.email).join(', ')
}
