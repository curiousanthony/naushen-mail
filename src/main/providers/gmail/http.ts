/**
 * One small HTTP client for the Gmail REST API: bearer auth, query serialisation, JSON in/out,
 * retry with exponential backoff (429 / 5xx / rate-limit 403 / network errors), honours Retry-After,
 * and one forced token refresh on 401. Unit-testable with a stubbed fetch.
 */
import { mt } from '../../i18n'

export const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'
export const GMAIL_UPLOAD_BASE = 'https://gmail.googleapis.com/upload/gmail/v1/users/me'

export class GmailApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string
  ) {
    super(message)
    this.name = 'GmailApiError'
  }
}

export type QueryValue = string | number | boolean | undefined | null | (string | number)[]

export interface RequestOptions {
  query?: Record<string, QueryValue>
  body?: unknown
  /** Absolute URL override (uploads etc.). */
  url?: string
  /** Raw request body (media / multipart uploads). Takes precedence over `body`. */
  rawBody?: Buffer
  contentType?: string
}

export interface HttpClientDeps {
  /** Returns a valid access token. `force` = the current one was rejected, refresh regardless of expiry. */
  getAccessToken(force?: boolean): Promise<string>
  /** Called when Google keeps rejecting fresh credentials (401 after a forced refresh). */
  onAuthRejected?(message: string): void
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxRetries?: number
  timeoutMs?: number
  /** Deterministic jitter for tests. */
  random?: () => number
}

// Gmail returns 403 (not 429) for its per-user, per-100-second burst quota. The *reason* string
// varies by which limit was hit ("Quota exceeded for quota metric 'Queries' and limit 'Queries
// per minute per user'" comes back with reason 'quotaExceeded', not 'rateLimitExceeded') -- all
// three are the same transient, retry-with-backoff situation, never a real permission problem.
const RETRYABLE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'backendError'])
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const base = /^https?:/i.test(path) ? path : GMAIL_BASE + path
  if (!query) return base
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue
    if (Array.isArray(v)) for (const x of v) usp.append(k, String(x))
    else usp.append(k, String(v))
  }
  const qs = usp.toString()
  return qs ? `${base}${base.includes('?') ? '&' : '?'}${qs}` : base
}

function parseRetryAfter(h: string | null): number | null {
  if (!h) return null
  const secs = Number(h)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const at = Date.parse(h)
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now())
}

export class GmailHttp {
  constructor(private deps: HttpClientDeps) {}

  async request<T = unknown>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const doFetch = this.deps.fetch ?? fetch
    const sleep = this.deps.sleep ?? defaultSleep
    const rand = this.deps.random ?? Math.random
    // A quota/rate-limit 403 resets on a rolling ~100s window. The old default (5 retries, 20s
    // backoff cap) only spans ~15.5s worst case -- nowhere near enough to ride one out, so a
    // large-mailbox backfill could keep failing even with the right reason now retried above.
    const maxRetries = this.deps.maxRetries ?? 9
    const url = buildUrl(opts.url ?? path, opts.query)
    let forcedRefresh = false
    let force = false

    for (let attempt = 0; ; attempt++) {
      const token = await this.deps.getAccessToken(force)
      force = false
      let res: Response
      try {
        res = await doFetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            ...(opts.rawBody ? { 'Content-Type': opts.contentType ?? 'application/octet-stream' } : opts.body !== undefined ? { 'Content-Type': 'application/json' } : {})
          },
          body: opts.rawBody ? new Uint8Array(opts.rawBody) : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(this.deps.timeoutMs ?? 30_000)
        })
      } catch (e) {
        // Network failure / timeout: retry with backoff.
        if (attempt >= maxRetries) throw new GmailApiError(mt('gmail.network', { message: (e as Error).message }), 0, 'network')
        await sleep(backoff(attempt, null, rand))
        continue
      }

      if (res.ok) {
        if (res.status === 204) return undefined as T
        const text = await res.text()
        return (text ? JSON.parse(text) : undefined) as T
      }

      const err = await toError(res)
      if (res.status === 401 && !forcedRefresh) {
        forcedRefresh = true
        force = true
        attempt-- // a credential refresh is not a "retry"
        continue
      }
      if (res.status === 401) this.deps.onAuthRejected?.(mt('gmail.authRejected'))
      const retryable = res.status === 429 || res.status >= 500 || (res.status === 403 && err.reason !== undefined && RETRYABLE_REASONS.has(err.reason))
      if (!retryable || attempt >= maxRetries) throw err
      await sleep(backoff(attempt, parseRetryAfter(res.headers.get('retry-after')), rand))
    }
  }

  upload<T = unknown>(method: 'POST' | 'PUT', path: string, metadata: unknown, raw: Buffer): Promise<T> {
    const boundary = `mailroom_${Math.random().toString(36).slice(2)}`
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n`),
      raw,
      Buffer.from(`\r\n--${boundary}--`)
    ])
    return this.request<T>(method, path, {
      url: `${GMAIL_UPLOAD_BASE}${path}`,
      query: { uploadType: 'multipart' },
      rawBody: body,
      contentType: `multipart/related; boundary=${boundary}`
    })
  }

  get<T = unknown>(path: string, query?: Record<string, QueryValue>): Promise<T> { return this.request<T>('GET', path, { query }) }
  post<T = unknown>(path: string, body?: unknown, query?: Record<string, QueryValue>): Promise<T> { return this.request<T>('POST', path, { body: body ?? undefined, query }) }
  put<T = unknown>(path: string, body?: unknown): Promise<T> { return this.request<T>('PUT', path, { body }) }
  patch<T = unknown>(path: string, body?: unknown): Promise<T> { return this.request<T>('PATCH', path, { body }) }
  delete<T = unknown>(path: string): Promise<T> { return this.request<T>('DELETE', path) }
}

function backoff(attempt: number, retryAfterMs: number | null, rand: () => number): number {
  if (retryAfterMs !== null) return Math.min(retryAfterMs, 60_000)
  return Math.min(500 * 2 ** attempt, 30_000) + Math.floor(rand() * 250)
}

async function toError(res: Response): Promise<GmailApiError> {
  let message = `Gmail API ${res.status}`
  let reason: string | undefined
  try {
    const j = JSON.parse(await res.text()) as { error?: { message?: string; errors?: { reason?: string }[]; status?: string } }
    if (j.error?.message) message = `${message}: ${j.error.message}`
    reason = j.error?.errors?.[0]?.reason ?? j.error?.status
  } catch { /* non-JSON error body */ }
  return new GmailApiError(message, res.status, reason)
}

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
