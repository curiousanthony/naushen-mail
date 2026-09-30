import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { shell } from 'electron'
import { mt } from '../i18n'

/** RFC 7636 PKCE pair. */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

export interface LoopbackResult { code: string; redirectUri: string }

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const PAGE = (rawTitle: string, rawBody: string): string => {
  const title = esc(rawTitle), body = esc(rawBody)
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px -apple-system,system-ui,sans-serif;color:#37352f;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="font-weight:600">${title}</h2><p style="color:#787774">${body}</p></div></body>`
}

/**
 * Desktop OAuth "loopback" flow: listens on 127.0.0.1:<random port>, opens the system browser at
 * `buildAuthUrl(redirectUri, state)`, resolves with the authorisation code. Verifies `state`.
 * Google: redirect must be http://127.0.0.1:<port>. Microsoft: http://localhost:<port> (registered as http://localhost).
 */
export async function loopbackAuth(
  buildAuthUrl: (redirectUri: string, state: string) => string,
  opts: { host?: '127.0.0.1' | 'localhost'; timeoutMs?: number; open?: (url: string) => Promise<void> | void } = {}
): Promise<LoopbackResult> {
  const state = randomBytes(16).toString('hex')
  const host = opts.host ?? '127.0.0.1'
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/') { res.writeHead(404).end(); return }
      const err = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      const ok = !err && code && url.searchParams.get('state') === state
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(ok ? PAGE(mt('oauth.connectedTitle'), mt('oauth.connectedBody')) : PAGE(mt('oauth.failedTitle'), err ?? mt('oauth.invalidResponse')))
      clearTimeout(timer)
      server.close()
      if (ok) resolve({ code: code!, redirectUri: `http://${host}:${(server.address() as AddressInfo | null)?.port ?? port}` })
      else reject(new Error(err ? mt('oauth.authFailed', { error: err }) : mt('oauth.authInvalid')))
    })
    let port = 0
    const timer = setTimeout(() => { server.close(); reject(new Error(mt('oauth.timedOut'))) }, opts.timeoutMs ?? 5 * 60_000)
    server.on('error', (e) => { clearTimeout(timer); reject(e) })
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port
      const redirectUri = `http://${host}:${port}`
      void (opts.open ?? ((u: string) => shell.openExternal(u)))(buildAuthUrl(redirectUri, state))
    })
  })
}

/** POST application/x-www-form-urlencoded and parse JSON, throwing readable errors. */
export async function postForm<T>(url: string, body: Record<string, string>): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) })
  const text = await r.text()
  let json: unknown
  try { json = JSON.parse(text) } catch { json = { error: text } }
  if (!r.ok) {
    const j = json as { error?: string; error_description?: string }
    const e = new Error(`${j.error ?? r.status}: ${j.error_description ?? ''}`.trim()) as Error & { code?: string }
    e.code = j.error
    throw e
  }
  return json as T
}
