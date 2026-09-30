#!/usr/bin/env node
// Generates build/icon.svg, build/icon.png (1024), build/icon.icns, build/icon.ico (Windows) and build/icons/512x512.png (Linux).
// Original artwork: an off-white paper plane on a calm charcoal squircle. No third-party branding.
// Rasterises the SVG with the repo's own Electron (transparent offscreen window), then iconutil builds the .icns.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'build')
mkdirSync(buildDir, { recursive: true })

// macOS icon grid: 824x824 body centred on a 1024 canvas (100px margin for the drop shadow).
const C = 512
const HALF = 412
const N = 4.4 // superellipse exponent (~macOS squircle)
function squircle() {
  const pts = []
  const steps = 360
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2
    const c = Math.cos(t), s = Math.sin(t)
    const x = C + HALF * Math.sign(c) * Math.abs(c) ** (2 / N)
    const y = C + HALF * Math.sign(s) * Math.abs(s) ** (2 / N)
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`)
  }
  return `M${pts.join('L')}Z`
}

const body = squircle()
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#f2f2f0"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <filter id="drop" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000" flood-opacity="0.20"/>
    </filter>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#000" flood-opacity="0.16"/>
    </filter>
    <clipPath id="clip"><path d="${body}"/></clipPath>
  </defs>
  <path d="${body}" fill="#000" filter="url(#drop)"/>
  <path d="${body}" fill="url(#bg)"/>
  <g clip-path="url(#clip)">
    <rect x="100" y="100" width="824" height="420" fill="url(#sheen)"/>
  </g>
  <path d="${body}" fill="none" stroke="#000" stroke-opacity="0.08" stroke-width="2"/>
  <!-- paper plane: white fill, bold dark outline (a light-background icon needs the outline just
       to read as a shape, unlike the earlier dark-background version). Nose up-right, one visible
       fold, drawn in a 24-unit box, scaled/rotated into place. Not a copy of any third-party mark
       -- an original take on the generic send-plane glyph. -->
  <g filter="url(#soft)" transform="translate(512,512) rotate(-12) scale(21.6) translate(-12,-12)">
    <!-- full silhouette (nose, tail, underwing), outlined -->
    <polygon points="22,2 15,22 11,13 2,9" fill="#ffffff" stroke="#1c1d1f" stroke-width="1.3" stroke-linejoin="round"/>
    <!-- underwing shade: the near-side fold reads slightly darker than the top face -->
    <polygon points="11,13 15,22 8.2,15.6" fill="#e8e8e6" stroke="#1c1d1f" stroke-width="1.1" stroke-linejoin="round"/>
    <!-- centre fold, nose to tail -->
    <path d="M22 2 L11 13" stroke="#1c1d1f" stroke-opacity="0.55" stroke-width="0.8" stroke-linecap="round"/>
  </g>
  <!-- motion trail -->
  <path d="M300 592 Q404 592 476 552" stroke="#1c1d1f" stroke-opacity="0.18" stroke-width="10" stroke-linecap="round" fill="none"/>
</svg>
`
writeFileSync(join(buildDir, 'icon.svg'), svg)

// 1) rasterise via Electron
const electronBin = join(root, 'node_modules/.bin/electron')
if (!existsSync(electronBin)) throw new Error('electron not installed (run npm install)')
const png = join(buildDir, 'icon.png')
execFileSync(electronBin, [join(root, 'scripts/render-svg.cjs'), join(buildDir, 'icon.svg'), png, '1024'], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
})

// 2) iconset -> icns
const iconset = join(buildDir, 'icon.iconset')
rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset)
const sizes = [16, 32, 128, 256, 512]
for (const s of sizes) {
  execFileSync('sips', ['-z', String(s), String(s), png, '--out', join(iconset, `icon_${s}x${s}.png`)], { stdio: 'ignore' })
  execFileSync('sips', ['-z', String(s * 2), String(s * 2), png, '--out', join(iconset, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' })
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(buildDir, 'icon.icns')], { stdio: 'inherit' })
rmSync(iconset, { recursive: true, force: true })

// 3) Linux: electron-builder picks up build/icons/<size>x<size>.png
const iconsDir = join(buildDir, 'icons')
rmSync(iconsDir, { recursive: true, force: true })
mkdirSync(iconsDir)
for (const s of [512, 256, 128, 64, 48, 32, 16]) {
  execFileSync('sips', ['-z', String(s), String(s), png, '--out', join(iconsDir, `${s}x${s}.png`)], { stdio: 'ignore' })
}

// 4) Windows .ico: PNG-compressed entries (supported since Vista), assembled by hand.
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const tmp = join(buildDir, '.ico-tmp')
rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp)
const pngs = icoSizes.map((s) => {
  const f = join(tmp, `${s}.png`)
  execFileSync('sips', ['-z', String(s), String(s), png, '--out', f], { stdio: 'ignore' })
  return readFileSync(f)
})
const head = Buffer.alloc(6)
head.writeUInt16LE(1, 2) // type: icon
head.writeUInt16LE(icoSizes.length, 4)
let offset = 6 + 16 * icoSizes.length
const dir = icoSizes.map((s, i) => {
  const e = Buffer.alloc(16)
  e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6) // planes, bpp
  e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12)
  offset += pngs[i].length
  return e
})
writeFileSync(join(buildDir, 'icon.ico'), Buffer.concat([head, ...dir, ...pngs]))
rmSync(tmp, { recursive: true, force: true })
console.log('wrote build/icon.svg, build/icon.png, build/icon.icns, build/icon.ico, build/icons/*.png')
