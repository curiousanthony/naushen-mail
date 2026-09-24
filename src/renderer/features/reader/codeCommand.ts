import { useApp } from '@/lib/store'
import { copyText } from './clipboard'
import { newestActiveCode } from './codes'

/**
 * `shift+c` / palette "Copy verification code": the newest unexpired code in the open (or, failing
 * that, the focused) conversation. Kept free of React so the commands feature can import it.
 */
export async function copyVerificationCode(): Promise<void> {
  const s = useApp.getState()
  const id = s.openThreadId ?? s.focusedId
  if (!id) return
  const t = await window.api.invoke('threads.get', id)
  const hit = t ? newestActiveCode(t.messages) : null
  if (!hit) {
    useApp.getState().toast({ message: 'No recent verification code here', duration: 2500 })
    return
  }
  const ok = await copyText(hit.code)
  useApp.getState().toast({ message: ok ? `Copied ${hit.code}` : 'Could not copy the code', duration: 2200 })
}
