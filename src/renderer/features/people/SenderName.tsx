import type { Address } from '@shared/types'
import { displayName } from '@/lib/format'
import { hoverEnter, hoverLeave } from './store'

/**
 * A sender's name that opens the sender card on hover (after a short intent delay) — drop-in
 * for the plain name span in the reader. Also the anchor `i` looks for (`data-person`).
 */
export function SenderName({ address, className }: { address: Address; className?: string }): JSX.Element {
  return (
    <span
      className={className}
      data-person={address.email}
      onMouseEnter={(e) => hoverEnter(e.currentTarget, address.email, address.name)}
      onMouseLeave={hoverLeave}
    >
      {displayName(address)}
    </span>
  )
}
