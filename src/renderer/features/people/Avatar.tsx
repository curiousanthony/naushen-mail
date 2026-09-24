import { useState } from 'react'
import type { Address } from '@shared/types'
import { useApp } from '@/lib/store'
import { initials } from '@/lib/format'
import { gravatarUrl } from '@/lib/avatar'

const TINTS = ['blue', 'green', 'orange', 'purple', 'pink', 'red', 'yellow', 'brown'] as const

/** Same hash as the reader's message avatar, so a person keeps one colour everywhere. */
export function avatarTint(email: string): string {
  let h = 0
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0
  return TINTS[h % TINTS.length]
}

export function PersonAvatar({ address, size = 28 }: { address: Address; size?: number }): JSX.Element {
  const showAvatars = useApp((s) => s.settings.showAvatars)
  const [failed, setFailed] = useState(false)
  return (
    <span className="ppl-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: `var(--chip-${avatarTint(address.email)}-fg)` }} aria-hidden>
      {initials(address)}
      {showAvatars && !failed && <img className="ppl-avatar__img" src={gravatarUrl(address.email, size * 2)} alt="" loading="lazy" onError={() => setFailed(true)} />}
    </span>
  )
}
