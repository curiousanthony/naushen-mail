import { mt, onMainLanguageChange } from './i18n'
import { app, BrowserWindow, globalShortcut, Menu, screen } from 'electron'
import type { Repo } from './db/repo'
import type { SyncEngine } from './sync/engine'
import { NewMailNotifier } from './newmail'
import { readViewState, showNotification } from './notifications'
import { badgeText, restoreBounds, type SavedBounds } from './notify-plan'
import { cleanupDragFiles } from './dragout'

export const GLOBAL_COMPOSE_HOTKEY = 'CommandOrControl+Alt+N'

interface Ctx {
  repo: Repo
  engine: SyncEngine
  /** Bring the app forward (creating the window if needed), then run `cmd` once the renderer is ready. */
  summon: (cmd?: string) => void
  getWindow: () => BrowserWindow | null
  send: (channel: string, payload: unknown) => void
}

/** Dock badge (unread Inbox across accounts), new-mail notifications, global hotkey, Dock menu. */
export function setupNative(ctx: Ctx): void {
  const { repo, engine } = ctx

  // ---- Dock badge. Re-derived from the store on every change (debounced), so it can never drift:
  // read/archive/snooze/sync from any path lowers it, and turning the setting off clears it.
  let badgeTimer: NodeJS.Timeout | null = null
  const updateBadge = (): void => {
    const settings = repo.getSettings()
    const enabled = settings.dockBadge !== false
    const text = badgeText(repo.counts({ excludeCategories: !!settings.hideCategoriesFromInbox }).unread['all:inbox'] ?? 0, enabled)
    if (process.platform === 'darwin') app.dock?.setBadge(text)
    else app.setBadgeCount(Number(text) || 0)
  }
  engine.onEvent(() => {
    if (badgeTimer) clearTimeout(badgeTimer)
    badgeTimer = setTimeout(updateBadge, 120)
  })
  updateBadge()

  // ---- New-mail notifications.
  const notifier = new NewMailNotifier(repo, {
    getView: () => readViewState(ctx.getWindow()),
    deliver: (plan) => showNotification(plan, {
      open: (threadId) => { ctx.summon(`open-thread:${threadId}`) },
      act: (threadId, action) => { void engine.act([threadId], { type: action }) }
    })
  })
  notifier.attach(engine)

  // ---- Global hotkey: from any app straight into a fresh composer.
  if (!globalShortcut.register(GLOBAL_COMPOSE_HOTKEY, () => ctx.summon('compose'))) {
    console.warn(`[native] could not register ${GLOBAL_COMPOSE_HOTKEY} (taken by another app?)`)
  }
  app.on('will-quit', () => { globalShortcut.unregisterAll(); cleanupDragFiles() })

  // ---- Dock menu (right-click the Dock icon).
  if (process.platform === 'darwin') {
    const setDockMenu = (): void => {
      app.dock?.setMenu(Menu.buildFromTemplate([
        { label: mt('menu.newMessage'), click: () => ctx.summon('compose') },
        { label: mt('menu.checkMail'), click: () => { void engine.syncAll() } },
        { label: mt('menu.goToInbox'), click: () => ctx.summon('go-inbox') }
      ]))
    }
    setDockMenu()
    onMainLanguageChange(setDockMenu)
  }
}

// ---------------------------------------------------------------- remembered window frame

const KEY = 'windowState'

export function loadWindowBounds(repo: Repo): SavedBounds | undefined {
  try {
    const raw = repo.kvGet(KEY)
    return restoreBounds(raw ? JSON.parse(raw) : null, screen.getAllDisplays().map((d) => d.workArea))
  } catch { return undefined }
}

/** Persist size/position (debounced) and maximised state. Skipped under the headless test hook. */
export function trackWindowBounds(w: BrowserWindow, repo: Repo): void {
  if (process.env.MAILROOM_SHOT || process.env.MAILROOM_STEPS) return
  let timer: NodeJS.Timeout | null = null
  const save = (): void => {
    if (w.isDestroyed() || w.isMinimized() || w.isFullScreen()) return
    const maximized = w.isMaximized()
    const b = maximized ? (JSON.parse(repo.kvGet(KEY) ?? 'null') as SavedBounds | null) ?? w.getNormalBounds() : w.getBounds()
    repo.kvSet(KEY, JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized }))
  }
  const later = (): void => { if (timer) clearTimeout(timer); timer = setTimeout(save, 400) }
  w.on('resize', later); w.on('move', later); w.on('maximize', later); w.on('unmaximize', later)
  w.on('close', () => { if (timer) clearTimeout(timer); save() })
}
