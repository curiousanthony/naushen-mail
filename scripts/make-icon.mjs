#!/usr/bin/env node
// Generates build/icon.svg, build/icon.png (1024) and build/icon.icns.
// Original artwork: an off-white envelope on a calm charcoal squircle. No third-party branding.
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
  <!-- envelope -->
  <g filter="url(#soft)">
    <rect x="252" y="330" width="520" height="364" rx="46" fill="url(#paper)"/>
  </g>
  <!-- inner fold lines (subtle, from bottom corners toward the centre) -->
  <path d="M262 676 L440 528 M762 676 L584 528" stroke="#000" stroke-opacity="0.10" stroke-width="7" stroke-linecap="round" fill="none"/>
  <!-- flap -->
  <path d="M252 376 Q252 330 298 330 L726 330 Q772 330 772 376 L772 384 Q772 412 750 430 L536 596 Q512 614 488 596 L274 430 Q252 412 252 384 Z" fill="url(#flap)"/>
  <path d="M272 430 L488 596 Q512 614 536 596 L752 430" stroke="#000" stroke-opacity="0.13" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
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
