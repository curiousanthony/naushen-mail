import { app, type BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'

/**
 * Headless verification hook (dev/test only). Env:
 *   MAILROOM_USER_DATA  isolated profile dir (keeps test DBs away from real data)
 *   MAILROOM_DEMO=1     add two demo accounts on first launch
 *   MAILROOM_SHOT       PNG path; window is captured then app quits
 *   MAILROOM_EXEC       JS run in the renderer before capture (e.g. click something)
 *   MAILROOM_WAIT       ms to wait after load/exec (default 1200)
 *   MAILROOM_SIZE       "WxH" window size
 * Multiple steps: MAILROOM_STEPS = JSON [{exec, wait, shot}] captures a PNG after each step.
 */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export function applyUserDataOverride(): void {
  if (process.env.MAILROOM_USER_DATA) app.setPath('userData', process.env.MAILROOM_USER_DATA)
}

export function attachE2E(w: BrowserWindow): void {
  const steps: { exec?: string; menu?: string; wait?: number; shot?: string }[] = process.env.MAILROOM_STEPS
    ? JSON.parse(process.env.MAILROOM_STEPS)
    : process.env.MAILROOM_SHOT ? [{ exec: process.env.MAILROOM_EXEC, wait: Number(process.env.MAILROOM_WAIT ?? 1200), shot: process.env.MAILROOM_SHOT }] : []
  if (!steps.length) return
  if (process.env.MAILROOM_SIZE) { const [W, H] = process.env.MAILROOM_SIZE.split('x').map(Number); w.setSize(W, H) }
  w.webContents.once('did-finish-load', async () => {
    await sleep(Number(process.env.MAILROOM_BOOT_WAIT ?? 1500))
    for (const s of steps) {
      if (s.menu) w.webContents.send('menu', s.menu) // simulate a native menu / notification-click command
      if (s.exec) {
        try { const r = await w.webContents.executeJavaScript(s.exec); if (r !== undefined) console.log('[exec]', JSON.stringify(r)) }
        catch (e) { console.log('[exec-error]', String(e)) }
      }
      await sleep(s.wait ?? 800)
      if (process.platform === 'darwin') console.log('[dock-badge]', JSON.stringify(app.dock?.getBadge() ?? ''))
      if (s.shot) { const img = await w.webContents.capturePage(); writeFileSync(s.shot, img.toPNG()); console.log('[shot]', s.shot) }
    }
    app.quit()
  })
}
