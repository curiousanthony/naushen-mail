/**
 * Minimal Microsoft Graph HTTP client (plain fetch, no SDK).
 *
 * Responsibilities: bearer auth, `Prefer: IdType="ImmutableId"` on EVERY request, per-account concurrency cap (Graph/Outlook
 * allows 4 concurrent requests per app per mailbox), retry with `Retry-After` on 429/503/504, transient network retry, one
 * refresh-and-retry on 401, and a guard so the bearer token is never sent to a non-Graph host (paging links are followed
 * verbatim, but only when they point at graph.microsoft.com).
 */

export const GRAPH_ORIGIN = 'https://graph.microsoft.com'
export const GRAPH_BASE = `${GRAPH_ORIGIN}/v1.0`

export class GraphError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'GraphError'
  }
}

/** Thrown when the user must sign in again (refresh token dead / never signed in). */
export class ReauthRequiredError extends Error {
  constructor(message = 'Your Microsoft session expired. Reconnect this account in Settings → Accounts.') {
    super(message)
    this.name = 'ReauthRequiredError'
  }
}

/** Delta token no longer valid => caller must discard local state and re-run the initial sync. */
export function isSyncStateError(e: unknown): boolean {
  if (!(e instanceof GraphError)) return false
  const c = e.code.toLowerCase()
  return e.status === 410 || c === 'syncstatenotfound' || c === 'resyncrequired' || c === 'invaliddeltatoken' || c === 'errorinvalidsyncstatedata'
}

export function isNotFound(e: unknown): boolean {
  return e instanceof GraphError && (e.status === 404 || e.code === 'ErrorItemNotFound')
}

export interface TokenSource {
  /** `force` => the previous token was rejected (401): refresh even if it looks valid. */
  get(force?: boolean): Promise<string>
}

export interface GraphClientOptions {
  tokens: TokenSource
  fetchImpl?: typeof fetch
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>
  concurrency?: number
  maxRetries?: number
  timeoutMs?: number
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined>
  body?: unknown
  /** Extra Prefer values, merged with IdType="ImmutableId". */
  prefer?: string[]
  headers?: Record<string, string>
  /** Return raw bytes (attachments `$value`). */
  raw?: boolean
  /** Send `body` as-is with this content type instead of JSON. */
  contentType?: string
}

/** Percent-encode a query value but keep OData punctuation readable ($ , ( ) = : ' / and spaces as %20). */
export function enc(v: string): string {
  return encodeURIComponent(v)
    .replace(/%24/g, '$').replace(/%2C/g, ',').replace(/%28/g, '(').replace(/%29/g, ')')
    .replace(/%3D/g, '=').replace(/%3A/g, ':').replace(/%27/g, "'").replace(/%2F/g, '/')
}

export function buildQuery(query?: Record<string, string | number | undefined>): string {
  if (!query) return ''
  const parts: string[] = []
  for (const [k, v] of Object.entries(query)) if (v !== undefined) parts.push(`${k}=${enc(String(v))}`)
  return parts.length ? `?${parts.join('&')}` : ''
}

/** Escape a string for use inside an OData single-quoted literal. */
export const odataString = (s: string): string => s.replace(/'/g, "''")

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function retryAfterMs(h: string | null, attempt: number): number {
  if (h) {
    const secs = Number(h)
    if (Number.isFinite(secs)) return Math.min(Math.max(secs, 0) * 1000, 120_000)
    const when = Date.parse(h)
    if (!Number.isNaN(when)) return Math.min(Math.max(when - Date.now(), 0), 120_000)
  }
  return Math.min(1000 * 2 ** attempt, 30_000)
}

export class GraphClient {
  private opts: Required<Omit<GraphClientOptions, 'fetchImpl' | 'tokens'>>
  private active = 0
  private waiters: Array<() => void> = []
  private aborted = false

  constructor(private o: GraphClientOptions) {
    this.opts = { sleep: o.sleep ?? defaultSleep, concurrency: o.concurrency ?? 4, maxRetries: o.maxRetries ?? 5, timeoutMs: o.timeoutMs ?? 60_000 }
  }

  dispose(): void { this.aborted = true }

  private async acquire(): Promise<void> {
    if (this.active < this.opts.concurrency) { this.active++; return }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
  }
  private release(): void {
    const next = this.waiters.shift()
    if (next) next() // hand the slot over (active count unchanged)
    else this.active--
  }

  /** Resolve a path ("/me/messages"), or an absolute paging link (`@odata.nextLink`, `@odata.deltaLink`). */
  url(pathOrUrl: string, query?: RequestOptions['query']): string {
    if (/^https?:\/\//i.test(pathOrUrl)) {
      if (!pathOrUrl.startsWith(`${GRAPH_ORIGIN}/`)) throw new Error('Refusing to follow a non-Graph link')
      return pathOrUrl
    }
    return `${GRAPH_BASE}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}${buildQuery(query)}`
  }

  async request<T = unknown>(method: string, pathOrUrl: string, ro: RequestOptions = {}): Promise<T> {
    const url = this.url(pathOrUrl, ro.query)
    await this.acquire()
    try {
      return await this.send<T>(method, url, ro)
    } finally {
      this.release()
    }
  }

  get<T = unknown>(p: string, ro?: RequestOptions): Promise<T> { return this.request<T>('GET', p, ro) }
  post<T = unknown>(p: string, body?: unknown, ro?: RequestOptions): Promise<T> { return this.request<T>('POST', p, { ...ro, body }) }
  patch<T = unknown>(p: string, body: unknown, ro?: RequestOptions): Promise<T> { return this.request<T>('PATCH', p, { ...ro, body }) }
  delete(p: string, ro?: RequestOptions): Promise<void> { return this.request<void>('DELETE', p, ro) }

  /** Page through a collection following `@odata.nextLink`. Stops after `maxPages`. */
  async getAll<T>(path: string, ro: RequestOptions = {}, maxPages = 50): Promise<T[]> {
    const out: T[] = []
    let next: string | undefined = path
    for (let i = 0; next && i < maxPages; i++) {
      const page: { value?: T[]; '@odata.nextLink'?: string } = await this.get(next, i === 0 ? ro : { prefer: ro.prefer })
      out.push(...(page.value ?? []))
      next = page['@odata.nextLink']
    }
    return out
  }

  private async send<T>(method: string, url: string, ro: RequestOptions): Promise<T> {
    const doFetch = this.o.fetchImpl ?? globalThis.fetch
    let refreshedOn401 = false
    let force = false
    for (let attempt = 0; ; attempt++) {
      if (this.aborted) throw new Error('Outlook adapter disposed')
      const token = await this.o.tokens.get(force)
      force = false
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Prefer: ['IdType="ImmutableId"', ...(ro.prefer ?? [])].join(', '),
        Accept: ro.raw ? '*/*' : 'application/json',
        ...ro.headers
      }
      let body: string | undefined
      if (ro.body !== undefined) {
        if (ro.contentType) { headers['Content-Type'] = ro.contentType; body = ro.body as string } else { headers['Content-Type'] = 'application/json'; body = JSON.stringify(ro.body) }
      }
      let res: Response
      try {
        res = await doFetch(url, { method, headers, body, signal: AbortSignal.timeout(this.opts.timeoutMs) })
      } catch (e) {
        // Network hiccup / timeout: retry idempotent-ish requests a few times.
        if (attempt < Math.min(this.opts.maxRetries, 3) && (method === 'GET' || method === 'DELETE')) { await this.opts.sleep(retryAfterMs(null, attempt)); continue }
        throw e
      }
      if (res.status === 401 && !refreshedOn401) { refreshedOn401 = true; force = true; attempt--; continue }
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < this.opts.maxRetries) {
        await this.opts.sleep(retryAfterMs(res.headers.get('Retry-After'), attempt))
        continue
      }
      if (!res.ok) throw await toGraphError(res)
      if (ro.raw) return Buffer.from(await res.arrayBuffer()) as T
      if (res.status === 204 || res.status === 202) return undefined as T
      const text = await res.text()
      if (!text) return undefined as T
      try { return JSON.parse(text) as T } catch { return undefined as T }
    }
  }
}

async function toGraphError(res: Response): Promise<GraphError> {
  let code = String(res.status)
  let message = `Microsoft Graph request failed (${res.status})`
  try {
    const j = JSON.parse(await res.text()) as { error?: { code?: string; message?: string } }
    if (j.error?.code) code = j.error.code
    if (j.error?.message) message = `${message}: ${j.error.message}`
  } catch { /* non-JSON error body */ }
  return new GraphError(res.status, code, message)
}
