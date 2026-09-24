import { app, BrowserWindow, Notification } from 'electron'
import type { NotifyPlan, ViewState } from './notify-plan'

/** Shows a native notification for a plan. Single messages get Archive / Mark read actions. */
export function showNotification(
  plan: NotifyPlan,
  handlers: { open: (threadId: string) => void; act: (threadId: string, action: 'archive' | 'markRead') => void }
): void {
  if (plan.kind === 'none' || !Notification.isSupported()) return
  const single = plan.kind === 'single'
  const n = new Notification({
    title: plan.title,
    body: plan.body,
    // macOS shows these as buttons for alert-style notifications; ignored elsewhere.
    actions: single ? [{ type: 'button', text: 'Archive' }, { type: 'button', text: 'Mark as Read' }] : [],
    closeButtonText: 'Dismiss',
    silent: false
  })
  live.add(n)
  const done = (): void => { live.delete(n) }
  n.on('click', () => { done(); handlers.open(plan.threadId) })
  n.on('action', (_e, index) => { done(); handlers.act(plan.threadId, index === 0 ? 'archive' : 'markRead') })
  n.on('close', done)
  n.show()
}
const live = new Set<Notification>() // keep a reference so the notification isn't GC'd before the user reacts

/** Whether the visible window is focused, and what the renderer is showing (see native/useNativeBridge). */
export async function readViewState(win: BrowserWindow | null): Promise<ViewState> {
  const fallback: ViewState = { windowFocused: false, accountId: 'all', inInbox: false }
  if (!win || win.isDestroyed()) return fallback
  const focused = win.isFocused() && win.isVisible() && !win.isMinimized() && app.isReady()
  try {
    const v = await win.webContents.executeJavaScript('window.__nsView ?? null') as { accountId: string; inInbox: boolean } | null
    return { windowFocused: focused, accountId: v?.accountId ?? 'all', inInbox: !!v?.inInbox }
  } catch { return { ...fallback, windowFocused: focused } }
}
