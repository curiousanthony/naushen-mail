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

applyUserDataOverride()

let win: BrowserWindow | null = null
let pendingMailto: string | null = null

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
  if (!win) { pendingMailto = url; return }
  win.webContents.send('mailto', parseMailto(url))
  win.show()
  win.focus()
}

// Registered before `whenReady` so a cold launch via a mailto: link (macOS calls this instead of
// passing argv) is captured even though the window doesn't exist yet.
app.on('open-url', (event, url) => { event.preventDefault(); handleMailto(url) })

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 560,
    show: false,
    title: 'Mailroom',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true
    }
  })
  w.once('ready-to-show', () => w.show())
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
  app.setName('Mailroom')
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
  win = createWindow()
  attachE2E(win)
  const send = (channel: string, payload: unknown): void => { win?.webContents.send(channel, payload) }
  engine.onEvent((e) => send('event', e))
  Menu.setApplicationMenu(buildMenu((cmd) => send('menu', cmd)))
  nativeTheme.themeSource = repo.getSettings().theme

  win.webContents.once('did-finish-load', () => { if (pendingMailto) { handleMailto(pendingMailto); pendingMailto = null } })

  engine.start()
  outbox.start()
  void engine.syncAll()

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) win = createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
