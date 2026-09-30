import { app, BrowserWindow, Menu, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { openDb } from './db/db'
import { Repo } from './db/repo'
import { SyncEngine } from './sync/engine'
import { Outbox } from './sync/outbox'
import { registerIpc } from './ipc'
import { restoreAccounts } from './accounts'
import { buildMenu } from './menu'
import { seedDefaultViews } from './seed'
import './providers/register'
import { userDataPath } from './paths'
import { applyUserDataOverride, attachE2E } from './e2e'
import { connectAccount } from './accounts'
import { loadWindowBounds, setupNative, trackWindowBounds } from './native'

applyUserDataOverride()

let win: BrowserWindow | null = null
let pendingMailto: string | null = null

const IS_MAC = process.platform === 'darwin'
/** Headless test / screenshot runs use throw-away profiles and must be able to run side by side. */
const IS_TEST_RUN = !!(process.env.MAILROOM_USER_DATA || process.env.MAILROOM_SHOT || process.env.MAILROOM_STEPS)

/** Windows/Linux pass a clicked `mailto:` link as a command-line argument (macOS uses `open-url`). */
function mailtoFromArgv(argv: string[]): string | null {
  return argv.slice(1).find((a) => /^mailto:/i.test(a)) ?? null
}

// One running instance: a second launch (e.g. clicking a mailto: link) hands its argv to the first.
const gotLock = IS_TEST_RUN || app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else if (!IS_MAC) {
  const initial = mailtoFromArgv(process.argv)
  if (initial) pendingMailto = initial
  app.on('second-instance', (_e, argv) => {
    const url = mailtoFromArgv(argv)
    if (url) handleMailto(url)
    else summon()
  })
}

/** Parse a `mailto:` URI into composer-init fields (best-effort; unknown params are ignored). */
function parseMailto(url: string): { to: { email: string }[]; cc: { email: string }[]; bcc: { email: string }[]; subject?: string; body?: string } | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'mailto:') return null
    const addrs = (s: string): { email: string }[] =>
      s.split(',').map((e) => e.trim()).filter(Boolean).map((email) => ({ email }))
    return {
      to: addrs(decodeURIComponent(u.pathname)),
      cc: addrs(u.searchParams.get('cc') ?? ''),
      bcc: addrs(u.searchParams.get('bcc') ?? ''),
      subject: u.searchParams.get('subject') ?? undefined,
      body: u.searchParams.get('body') ?? undefined
    }
  } catch { return null }
}

function handleMailto(url: string): void {
  if (!win || win.isDestroyed()) { pendingMailto = url; if (app.isReady()) summon(); return }
  win.webContents.send('mailto', parseMailto(url))
  win.show()
  win.focus()
}

let repoRef: Repo | null = null

/** Bring the app forward from anywhere (recreating the window if it was closed), then run a menu command. */
function summon(cmd?: string): void {
  const run = (): void => {
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show(); win.focus(); app.focus({ steal: true })
    if (cmd) win.webContents.send('menu', cmd)
  }
  if (!win || win.isDestroyed()) {
    if (!repoRef) return
    win = createWindow(repoRef)
    win.webContents.once('did-finish-load', () => setTimeout(() => {
      if (pendingMailto) { handleMailto(pendingMailto); pendingMailto = null }
      run()
    }, 500))
    return
  }
  run()
}

// Registered before `whenReady` so a cold launch via a mailto: link (macOS calls this instead of
// passing argv) is captured even though the window doesn't exist yet.
app.on('open-url', (event, url) => { event.preventDefault(); handleMailto(url) })

function createWindow(repo: Repo): BrowserWindow {
  const saved = loadWindowBounds(repo)
  const w = new BrowserWindow({
    width: saved?.width ?? 1280, height: saved?.height ?? 820, minWidth: 900, minHeight: 560,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    show: false,
    title: 'Naushen Mail',
    ...(IS_MAC
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 16, y: 16 },
          vibrancy: 'sidebar' as const,
          visualEffectState: 'followWindow' as const,
          backgroundColor: '#00000000'
        }
      // Windows / Linux: a normal OS frame (menu bar auto-hides; Alt reveals it). No vibrancy there.
      : { autoHideMenuBar: true, backgroundColor: nativeTheme.shouldUseDarkColors ? '#191919' : '#ffffff' }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true
    }
  })
  trackWindowBounds(w, repo)
  // Flag the platform before first paint so platform-dependent CSS (titlebar height) never flashes.
  w.webContents.on('dom-ready', () => {
    void w.webContents.executeJavaScript(`document.documentElement.dataset.platform=${JSON.stringify(process.platform)}`).catch(() => undefined)
  })
  w.once('ready-to-show', () => { if (saved?.maximized) w.maximize(); w.show() })
  w.on('closed', () => { if (win === w) win = null })
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e, url) => {
    if (url !== w.webContents.getURL()) { e.preventDefault(); if (/^https?:/i.test(url)) void shell.openExternal(url) }
  })
  if (process.env['ELECTRON_RENDERER_URL']) void w.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void w.loadFile(join(__dirname, '../renderer/index.html'))
  return w
}

app.whenReady().then(async () => {
  if (!gotLock) return // a first instance is running and already received our argv
  app.setName('Naushen Mail')
  if (process.platform === 'win32') app.setAppUserModelId('com.anthony.naushenmail') // toasts + taskbar grouping
  // Windows: register as a mailto handler (per-user registry; the user still picks the default in
  // Settings > Default apps). Linux gets it from the .desktop MimeType written by electron-builder, so we
  // never call xdg-settings and silently steal the default. macOS uses Info.plist (CFBundleURLTypes).
  if (process.platform === 'win32' && app.isPackaged) app.setAsDefaultProtocolClient('mailto')
  const db = openDb(userDataPath('mailroom.db'))
  const repo = new Repo(db)
  const engine = new SyncEngine(repo)
  const outbox = new Outbox(repo, engine)
  seedDefaultViews(repo)
  restoreAccounts(repo, engine)
  registerIpc(repo, engine, outbox)

  if (process.env.MAILROOM_DEMO && repo.listAccounts().length === 0) {
    await connectAccount('mock', repo, engine)
    await connectAccount('mock', repo, engine)
  }
  repoRef = repo
  win = createWindow(repo)
  attachE2E(win)
  const send = (channel: string, payload: unknown): void => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload) }
  engine.onEvent((e) => send('event', e))
  Menu.setApplicationMenu(buildMenu((cmd) => send('menu', cmd)))
  setupNative({ repo, engine, summon, getWindow: () => win, send })
  nativeTheme.themeSource = repo.getSettings().theme

  win.webContents.once('did-finish-load', () => { if (pendingMailto) { handleMailto(pendingMailto); pendingMailto = null } })

  engine.start()
  outbox.start()
  void engine.syncAll()

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) summon() })
})

app.on('window-all-closed', () => { if (!IS_MAC) app.quit() })
