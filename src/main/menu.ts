import { app, Menu, type MenuItemConstructorOptions } from 'electron'

export function buildMenu(emit: (cmd: string) => void): Menu {
  const item = (label: string, cmd: string, accelerator?: string): MenuItemConstructorOptions => ({ label, accelerator, click: () => emit(cmd) })
  return Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: 'about' }, { type: 'separator' }, item('Settings…', 'settings', 'Cmd+,'), { type: 'separator' },
      { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }
    ] },
    { label: 'File', submenu: [item('New Message', 'compose', 'Cmd+N'), item('Add Account…', 'add-account'), { type: 'separator' }, { role: 'close' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [
      item('Command Menu', 'command-menu', 'Cmd+K'), item('Search', 'search', 'Cmd+F'), item('Toggle Sidebar', 'toggle-sidebar', 'Cmd+\\'),
      { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' },
      // Cmd+R is Sync in this app; a window reload is a dev-only convenience on another accelerator.
      ...(app.isPackaged ? [] : [{ label: 'Reload Window', accelerator: 'Alt+Shift+Cmd+R', role: 'reload' as const }]),
      { type: 'separator' },
      { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }
    ] },
    { label: 'Mailbox', submenu: [
      item('Go to Inbox', 'go-inbox', 'Cmd+1'), item('Check Mail Now', 'sync', 'Cmd+R')
    ] },
    { role: 'windowMenu' }
  ])
}
