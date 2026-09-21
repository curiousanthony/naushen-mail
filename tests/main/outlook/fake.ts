import { OutlookAdapter, type OutlookAdapterDeps } from '../../../src/main/providers/outlook/adapter'
import type { GraphMessage } from '../../../src/main/providers/outlook/types'

export interface Call { method: string; url: string; path: string; query: URLSearchParams; headers: Record<string, string>; body: any }
export interface Reply { status?: number; json?: unknown; text?: string; headers?: Record<string, string>; bytes?: Buffer }
export type Handler = (c: Call) => Reply | undefined | void

/** Programmable fake `fetch`: handlers are tried in order; first one returning a value wins. Records every call. */
export function fakeFetch(handlers: Handler[] = []) {
  const calls: Call[] = []
  const all = [...handlers]
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const u = new URL(url)
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v
    let body: any = init?.body
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { /* keep text */ } }
    const call: Call = { method: init?.method ?? 'GET', url, path: decodeURIComponent(u.pathname.replace(/^\/v1\.0/, '')), query: u.searchParams, headers, body }
    calls.push(call)
    for (const h of all) {
      const r = h(call)
      if (r) {
        const status = r.status ?? 200
        const payload = r.bytes ?? (r.text ?? (r.json === undefined ? '' : JSON.stringify(r.json)))
        return new Response(status === 204 || status === 202 ? null : (payload as never), { status, headers: r.headers })
      }
    }
    return new Response(JSON.stringify({ error: { code: 'ErrorItemNotFound', message: `unhandled ${call.method} ${call.path}` } }), { status: 404 })
  }) as unknown as typeof fetch
  return { fetchImpl, calls, use: (h: Handler) => all.unshift(h) }
}

export const FOLDERS = { inbox: 'F_inbox', sentitems: 'F_sent', drafts: 'F_drafts', deleteditems: 'F_trash', junkemail: 'F_junk', archive: 'F_archive' } as const

export const folderHandler: Handler = (c) => {
  const m = /^\/me\/mailFolders\/(\w+)$/.exec(c.path)
  if (m && c.method === 'GET' && m[1] in FOLDERS) return { json: { id: FOLDERS[m[1] as keyof typeof FOLDERS], displayName: m[1] } }
}

export const categoriesHandler = (cats: { id: string; displayName: string; color: string }[] = []): Handler => (c) => {
  if (c.method === 'GET' && c.path === '/me/outlook/masterCategories') return { json: { value: cats } }
}

export const T0 = Date.parse('2026-09-01T10:00:00Z')
export const iso = (offsetMin: number): string => new Date(T0 + offsetMin * 60_000).toISOString()

export function gmsg(id: string, conv: string, folder: keyof typeof FOLDERS, over: Partial<GraphMessage> = {}): GraphMessage {
  return {
    id, conversationId: conv, conversationIndex: 'AA', subject: `Subject ${conv}`, bodyPreview: `preview ${id}`,
    body: { contentType: 'html', content: `<p>body ${id}</p>` },
    from: { emailAddress: { name: 'Dana', address: 'dana@contoso.com' } }, toRecipients: [{ emailAddress: { address: 'me@outlook.com' } }],
    receivedDateTime: iso(1), isRead: true, isDraft: false, hasAttachments: false, flag: { flagStatus: 'notFlagged' }, categories: [],
    parentFolderId: FOLDERS[folder], internetMessageId: `<${id}@x>`, attachments: [], ...over
  }
}

export const noSleep = async (): Promise<void> => undefined

export function makeAdapter(handlers: Handler[], extra: Partial<OutlookAdapterDeps> = {}) {
  const f = fakeFetch([folderHandler, categoriesHandler(), ...handlers])
  const adapter = new OutlookAdapter({
    account: { id: 'outlook-me-outlook-com', email: 'me@outlook.com', name: 'Me' },
    tokens: { get: async () => 'tok' }, fetchImpl: f.fetchImpl, sleep: noSleep, ...extra
  })
  return { adapter, ...f }
}

/** Serves `/me/messages` for `$filter=conversationId eq 'X'` from a conversation table. */
export const conversationHandler = (convs: Record<string, GraphMessage[]>): Handler => (c) => {
  if (c.method !== 'GET' || c.path !== '/me/messages') return
  const f = c.query.get('$filter')
  const m = f && /^conversationId eq '(.*)'$/.exec(f)
  if (m) return { json: { value: convs[m[1].replace(/''/g, "'")] ?? [] } }
}
