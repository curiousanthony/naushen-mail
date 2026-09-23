// Electron helper for make-icon.mjs: renders an SVG to a transparent PNG.
// usage: electron scripts/render-svg.cjs <in.svg> <out.png> <size>
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const [, , input, output, sizeArg] = process.argv.filter((a) => !a.startsWith('--'))
const size = Number(sizeArg || 1024)
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: size, height: size, show: false, transparent: true, frame: false,
    webPreferences: { offscreen: true } })
  const svg = readFileSync(input, 'utf8')
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 500))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
  writeFileSync(output, img.toPNG())
  app.quit()
})
