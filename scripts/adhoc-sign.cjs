// electron-builder afterSign hook: ad-hoc sign the .app so it launches on Apple Silicon without a Developer ID.
// (macOS arm64 refuses to run completely unsigned binaries; an ad-hoc signature is enough for local use.)
// If electron-builder already signed with a real identity (CSC_LINK / CSC_NAME / keychain), we leave it alone.
const { execFileSync, spawnSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.CSC_LINK || process.env.CSC_NAME) {
    console.log('  • adhoc-sign: real signing identity present, skipping ad-hoc signature')
    return
  }
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const probe = spawnSync('codesign', ['-dvv', app], { encoding: 'utf8' })
  if (/Authority=/.test(`${probe.stdout}${probe.stderr}`)) {
    console.log('  • adhoc-sign: app already signed with a real identity, leaving it')
    return
  }
  console.log(`  • adhoc-sign: codesign --force --deep --sign - ${app}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
