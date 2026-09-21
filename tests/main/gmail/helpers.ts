import type { GmailMessage, GmailPart, GmailThread } from '../../../src/main/providers/gmail/api-types'

export const b64 = (s: string | Buffer): string => Buffer.from(s).toString('base64url')

export const hdr = (name: string, value: string) => ({ name, value })

export function textPart(mime: string, body: string | Buffer, extra: Partial<GmailPart> = {}, ctExtra = ''): GmailPart {
  return {
    partId: '0', mimeType: mime, filename: '',
    headers: [hdr('Content-Type', `${mime}${ctExtra}`)],
    body: { size: Buffer.byteLength(body), data: b64(body) },
    ...extra
  }
}

export function msg(id: string, threadId: string, over: Partial<GmailMessage> & { headers?: { name: string; value: string }[]; body?: string } = {}): GmailMessage {
  const { headers, body, ...rest } = over
  const overridden = new Set((headers ?? []).map((h) => h.name.toLowerCase()))
  const base = [hdr('From', 'Ann <ann@example.com>'), hdr('To', 'me@example.com'), hdr('Subject', 'Hi'), hdr('Message-ID', `<${id}@mail>`)]
    .filter((h) => !overridden.has(h.name.toLowerCase()))
  return {
    id, threadId, labelIds: ['INBOX'], snippet: 'hello &amp; welcome', internalDate: '1700000000000',
    payload: {
      mimeType: 'text/plain', filename: '',
      headers: [...base, ...(headers ?? [])],
      body: { size: 5, data: b64(body ?? 'hello') }
    },
    ...rest
  }
}

export const thread = (id: string, messages: GmailMessage[]): GmailThread => ({ id, historyId: '10', messages })

// ---------------------------------------------------------------- fake fetch

export interface Call { method: string; url: URL; body: any; headers: Record<string, string>; rawBody?: string }
export type Handler = (call: Call) => Response | undefined | Promise<Response | undefined>

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } })

export function fakeFetch(...handlers: Handler[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const f = (async (input: string | URL, init?: RequestInit) => {
    const raw = typeof init?.body === 'string' ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : init?.body ? Buffer.from(init.body as Uint8Array).toString('latin1') : undefined
    let body: any
    try { body = raw ? JSON.parse(raw) : undefined } catch { body = raw }
    const call: Call = { method: init?.method ?? 'GET', url: new URL(String(input)), body, headers: (init?.headers ?? {}) as Record<string, string>, rawBody: raw }
    calls.push(call)
    for (const h of handlers) {
      const r = await h(call)
      if (r) return r
    }
    return json({ error: { message: `unhandled ${call.method} ${call.url.pathname}` } }, 599)
  }) as typeof fetch
  return { fetch: f, calls }
}

export const route = (method: string, pathRe: RegExp, res: (c: Call, m: RegExpExecArray) => Response | unknown): Handler => (c) => {
  if (c.method !== method) return undefined
  const m = pathRe.exec(c.url.pathname)
  if (!m) return undefined
  const r = res(c, m)
  return r instanceof Response ? r : json(r)
}
