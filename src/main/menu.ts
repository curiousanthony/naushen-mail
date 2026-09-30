import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { mt, onMainLanguageChange } from './i18n'

let unsubscribe: (() => void) | null = null

/** Build the application menu. Labels are re-translated (and the menu re-installed) when the language changes. */
export function buildMenu(emit: (cmd: string) => void): Menu {
  unsubscribe?.()
  unsubscribe = onMainLanguageChange(() => { if (app.isReady()) Menu.setApplicationMenu(buildMenu(emit)) })
  const item = (label: string, cmd: string, accelerator?: string): MenuItemConstructorOptions => ({ label, accelerator, click: () => emit(cmd) })
  return Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: 'about' }, { type: 'separator' }, item(mt('menu.settings'), 'settings', 'Cmd+,'), { type: 'separator' },
      { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }
    ] },
    { label: mt('menu.file'), submenu: [item(mt('menu.newMessage'), 'compose', 'Cmd+N'), item(mt('menu.addAccount'), 'add-account'), { type: 'separator' }, { role: 'close' }] },
    { label: mt('menu.edit'), submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'selectAll' }] },
    { label: mt('menu.view'), submenu: [
      item(mt('menu.commandMenu'), 'command-menu', 'Cmd+K'), item(mt('menu.search'), 'search', 'Cmd+F'), item(mt('menu.toggleSidebar'), 'toggle-sidebar', 'Cmd+\\'),
      { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' },
      // Cmd+R is Sync in this app; a window reload is a dev-only convenience on another accelerator.
      ...(app.isPackaged ? [] : [{ label: mt('menu.reloadWindow'), accelerator: 'Alt+Shift+Cmd+R', role: 'reload' as const }]),
      { type: 'separator' },
      { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }
    ] },
    { label: mt('menu.mailbox'), submenu: [
      item(mt('menu.goToInbox'), 'go-inbox', 'Cmd+1'), item(mt('menu.checkMail'), 'sync', 'Cmd+R')
    ] },
    { role: 'windowMenu' }
  ])
}
