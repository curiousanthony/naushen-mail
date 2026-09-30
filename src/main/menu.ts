import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { mt, onMainLanguageChange } from './i18n'

let unsubscribe: (() => void) | null = null

/** Build the application menu. Labels are re-translated (and the menu re-installed) when the language changes. */
export function buildMenu(emit: (cmd: string) => void): Menu {
  unsubscribe?.()
  unsubscribe = onMainLanguageChange(() => { if (app.isReady()) Menu.setApplicationMenu(buildMenu(emit)) })
  const isMac = process.platform === 'darwin'
  const item = (label: string, cmd: string, accelerator?: string): MenuItemConstructorOptions => ({ label, accelerator, click: () => emit(cmd) })
  return Menu.buildFromTemplate([
    ...(isMac ? [{ label: app.name, submenu: [
      { role: 'about' as const }, { type: 'separator' as const }, item(mt('menu.settings'), 'settings', 'CmdOrCtrl+,'), { type: 'separator' as const },
      { role: 'services' as const }, { type: 'separator' as const }, { role: 'hide' as const }, { role: 'hideOthers' as const }, { role: 'unhide' as const }, { type: 'separator' as const }, { role: 'quit' as const }
    ] }] : []),
    { label: mt('menu.file'), submenu: [item(mt('menu.newMessage'), 'compose', 'CmdOrCtrl+N'), item(mt('menu.addAccount'), 'add-account'), { type: 'separator' }, { role: 'close' }, ...(isMac ? [] : [{ type: 'separator' as const }, item(mt('menu.settings'), 'settings', 'CmdOrCtrl+,'), { role: 'quit' as const }])] },
    { label: mt('menu.edit'), submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'selectAll' }] },
    { label: mt('menu.view'), submenu: [
      item(mt('menu.commandMenu'), 'command-menu', 'CmdOrCtrl+K'), item(mt('menu.search'), 'search', 'CmdOrCtrl+F'), item(mt('menu.toggleSidebar'), 'toggle-sidebar', 'CmdOrCtrl+\\'),
      { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' },
      // Cmd+R is Sync in this app; a window reload is a dev-only convenience on another accelerator.
      ...(app.isPackaged ? [] : [{ label: mt('menu.reloadWindow'), accelerator: 'Alt+Shift+CmdOrCtrl+R', role: 'reload' as const }]),
      { type: 'separator' },
      { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }
    ] },
    { label: mt('menu.mailbox'), submenu: [
      item(mt('menu.goToInbox'), 'go-inbox', 'CmdOrCtrl+1'), item(mt('menu.checkMail'), 'sync', 'CmdOrCtrl+R')
    ] },
    { role: 'windowMenu' }
  ])
}
