import { useEffect } from 'react'
import { useApp } from '@/lib/store'
import './native.css'

declare global {
  interface Window { __nsView?: { accountId: string; inInbox: boolean } }
}

/**
 * Glue for the macOS integration in src/main/native.ts. Mount once (App.tsx).
 *  - publishes what is on screen (`window.__nsView`) so main can skip a notification for mail
 *    that is arriving in the Inbox you are already looking at;
 *  - opens a thread when a notification is clicked (`open-thread:<id>` menu command);
 *  - flags the document as vibrant on macOS so the sidebar turns translucent (see native.css).
 */
export function useNativeBridge(): void {
  useEffect(() => {
    let cancelled = false
    void window.api.invoke('app.platform').then((p) => {
      if (!cancelled) document.documentElement.dataset.platform = p.platform
      if (!cancelled && p.platform === 'darwin') document.documentElement.dataset.vibrancy = 'on'
    })
    const publish = (): void => {
      const s = useApp.getState()
      window.__nsView = { accountId: s.accountId, inInbox: s.nav.kind === 'role' && s.nav.role === 'inbox' }
    }
    publish()
    const off = useApp.subscribe(publish)
    const offCmd = window.api.onMenuCommand((cmd) => {
      if (!cmd.startsWith('open-thread:')) return
      const id = cmd.slice('open-thread:'.length)
      const s = useApp.getState()
      if (s.overlay) s.setOverlay(null)
      s.setNav({ kind: 'role', role: 'inbox' })
      s.setAccount('all')
      void window.api.invoke('threads.get', id).then((t) => {
        if (!t) return
        useApp.getState().openThread(id)
        if (t.unread && useApp.getState().settings.markReadOnOpen) void window.api.invoke('threads.act', [id], { type: 'markRead' })
      })
    })
    return () => { cancelled = true; off(); offCmd(); delete window.__nsView }
  }, [])
}
