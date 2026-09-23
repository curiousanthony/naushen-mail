#!/usr/bin/env node
// Generates build/icon.svg, build/icon.png (1024) and build/icon.icns.
// Original artwork: an off-white paper plane on a calm charcoal squircle. No third-party branding.
// Rasterises the SVG with the repo's own Electron (transparent offscreen window), then iconutil builds the .icns.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
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
      <stop offset="0" stop-color="#3a3b40"/>
      <stop offset="1" stop-color="#17181b"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#ececea"/>
    </linearGradient>
    <linearGradient id="flap" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#f3f3f1"/>
    </linearGradient>
    <filter id="drop" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="16" stdDeviation="14" flood-color="#000" flood-opacity="0.45"/>
    </filter>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#000" flood-opacity="0.28"/>
    </filter>
    <clipPath id="clip"><path d="${body}"/></clipPath>
  </defs>
  <path d="${body}" fill="#000" filter="url(#drop)"/>
  <path d="${body}" fill="url(#bg)"/>
  <g clip-path="url(#clip)">
    <rect x="100" y="100" width="824" height="420" fill="url(#sheen)"/>
  </g>
  <path d="${body}" fill="none" stroke="#fff" stroke-opacity="0.10" stroke-width="2"/>
  <!-- paper plane: nose up-right, one visible fold. Drawn in a 24-unit box, scaled/rotated into
       place. Not a copy of any third-party mark -- an original take on the generic send-plane glyph. -->
  <g filter="url(#soft)" transform="translate(512,512) rotate(-12) scale(21.6) translate(-12,-12)">
    <!-- full silhouette (nose, tail, underwing) -->
    <polygon points="22,2 15,22 11,13 2,9" fill="url(#paper)"/>
    <!-- underwing shade: the near-side fold reads slightly darker than the top face -->
    <polygon points="11,13 15,22 8.2,15.6" fill="url(#flap)"/>
    <!-- centre fold, nose to tail -->
    <path d="M22 2 L11 13" stroke="#000" stroke-opacity="0.16" stroke-width="0.7" stroke-linecap="round"/>
    <!-- leading edges -->
    <path d="M22 2 L2 9 M22 2 L15 22" stroke="#000" stroke-opacity="0.08" stroke-width="0.5" stroke-linejoin="round" fill="none"/>
  </g>
  <!-- motion trail -->
  <path d="M300 592 Q404 592 476 552" stroke="#fff" stroke-opacity="0.14" stroke-width="10" stroke-linecap="round" fill="none"/>
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
console.log('wrote build/icon.svg, build/icon.png, build/icon.icns')
