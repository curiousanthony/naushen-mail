import { useEffect, useMemo, useState } from 'react'
import { Copy } from 'lucide-react'
import { useApp } from '@/lib/store'
import { Tooltip } from '@/features/tooltip'
import { CODE_TTL_MS, activeVerificationCode, type ActiveCode } from './codes'
import { copyText } from './clipboard'
import './shield.css'

/**
 * The verification code in `text` while it is still worth offering, or null.
 *
 * `text` is a thunk so an old message never pays for building its detection string: the age check
 * runs first. A timer removes the chip the moment the ten minutes are up, without waiting for
 * anything else to re-render.
 */
export function useActiveCode(text: () => string, receivedAt: number): ActiveCode | null {
  const [now, setNow] = useState(() => Date.now())
  // A reused row / card can be handed a newer message: re-read the clock.
  useEffect(() => { setNow(Date.now()) }, [receivedAt])
  const fresh = now < receivedAt + CODE_TTL_MS
  const src = fresh ? text() : ''
  const code = useMemo(
    () => (fresh ? activeVerificationCode(src, receivedAt, now) : null),
    [fresh, src, receivedAt, now]
  )
  useEffect(() => {
    if (!code) return
    const wait = Math.max(0, code.expiresAt - Date.now()) + 50
    const t = setTimeout(() => setNow(Date.now()), Math.min(wait, 2 ** 31 - 1))
    return () => clearTimeout(t)
  }, [code])
  return code
}

/** Copy a code and confirm with the app's toast. */
export async function copyCodeWithToast(code: string): Promise<void> {
  const ok = await copyText(code)
  useApp.getState().toast({ message: ok ? `Copied ${code}` : 'Could not copy the code', duration: 2200 })
}

interface Props {
  code: string
  /** `row` = hover-only chip in the thread list; `message` = at the top of the message. */
  variant: 'row' | 'message'
}

/** "Copy 482913": click to copy. Shift+C does the same for the open / focused conversation. */
export function CodeChip({ code, variant }: Props): JSX.Element {
  return (
    <Tooltip label="Copy verification code" shortcut="⇧C">
      <button
        type="button"
        className={`codechip codechip--${variant}`}
        aria-label={`Copy verification code ${code}`}
        tabIndex={variant === 'row' ? -1 : undefined}
        onClick={(e) => { e.stopPropagation(); void copyCodeWithToast(code) }}
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <Copy size={11} aria-hidden />
        <span>Copy <b>{code}</b></span>
      </button>
    </Tooltip>
  )
}
