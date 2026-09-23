/** Text / header helpers: charsets, RFC 2047 encoded words, RFC 2231 params, addresses, HTML -> text. */
import addressparser from 'nodemailer/lib/addressparser'
import type { Address } from '@shared/types'

// ------------------------------------------------------------------ charsets

const CHARSET_ALIASES: Record<string, string> = {
  'us-ascii': 'windows-1252', ascii: 'windows-1252', 'iso-8859-1': 'windows-1252', latin1: 'windows-1252',
  'iso-8859-9': 'windows-1254', 'ks_c_5601-1987': 'euc-kr', 'x-sjis': 'shift_jis', 'unicode-1-1-utf-7': 'utf-8', utf8: 'utf-8'
}

export function normalizeCharset(charset: string | undefined | null): string {
  const c = (charset ?? '').trim().replace(/^["']|["']$/g, '').toLowerCase()
  if (!c) return 'utf-8'
  return CHARSET_ALIASES[c] ?? c
}

/** Decode bytes with a declared charset. Unknown charset => utf-8, then windows-1252 if utf-8 is invalid. */
export function decodeBytes(bytes: Uint8Array, charset?: string | null): string {
  const label = normalizeCharset(charset)
  try {
    return new TextDecoder(label, { fatal: label === 'utf-8' && !charset }).decode(bytes)
  } catch {
    /* unknown label or invalid utf-8 without a declared charset */
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/** Gmail body.data is base64url of the transfer-decoded bytes. */
export function decodeBase64UrlBody(data: string, charset?: string | null): string {
  return decodeBytes(Buffer.from(data, 'base64url'), charset)
}

// ------------------------------------------------------------------ RFC 2047

const ENCODED_WORD = /=\?([^?\s]+?)(?:\*[^?]*)?\?([bBqQ])\?([^?]*)\?=/g

function decodeQ(s: string): Uint8Array {
  const bytes: number[] = []
  const t = s.replace(/_/g, ' ')
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (c === '=' && /^[0-9a-fA-F]{2}$/.test(t.slice(i + 1, i + 3))) { bytes.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2 }
    else bytes.push(...Buffer.from(c, 'utf8'))
  }
  return Uint8Array.from(bytes)
}

/** Decode RFC 2047 encoded words. Idempotent on already-decoded text. Adjacent encoded words are joined. */
export function decodeMimeWords(input: string): string {
  if (!input || !input.includes('=?')) return input
  // whitespace between two encoded words is not significant
  const collapsed = input.replace(/(\?=)\s+(?==\?)/g, '$1')
  return collapsed.replace(ENCODED_WORD, (_m, cs: string, enc: string, text: string) => {
    try {
      const bytes = enc.toLowerCase() === 'b' ? Buffer.from(text, 'base64') : decodeQ(text)
      return decodeBytes(bytes, cs)
    } catch {
      return _m
    }
  })
}

// ------------------------------------------------------------------ header params (RFC 2231)

export interface ParsedHeader { value: string; params: Record<string, string> }

/** Parse `text/html; charset="utf-8"; name*=UTF-8''r%C3%A9sum%C3%A9.pdf` style headers. */
export function parseHeaderValue(raw: string | undefined): ParsedHeader {
  if (!raw) return { value: '', params: {} }
  const parts: string[] = []
  let cur = ''
  let q = false
  for (const ch of raw) {
    if (ch === '"') q = !q
    if (ch === ';' && !q) { parts.push(cur); cur = '' } else cur += ch
  }
  parts.push(cur)
  const value = (parts.shift() ?? '').trim().toLowerCase()
  const params: Record<string, string> = {}
  const cont: Record<string, { i: number; v: string; enc: boolean }[]> = {}
  for (const p of parts) {
    const eq = p.indexOf('=')
    if (eq < 0) continue
    const key = p.slice(0, eq).trim().toLowerCase()
    let v = p.slice(eq + 1).trim()
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1).replace(/\\(.)/g, '$1')
    const m = /^([^*]+)(?:\*(\d+))?(\*)?$/.exec(key)
    if (m && (m[2] !== undefined || m[3])) (cont[m[1]] ??= []).push({ i: Number(m[2] ?? 0), v, enc: !!m[3] })
    else params[key] = decodeMimeWords(v)
  }
  for (const [k, segs] of Object.entries(cont)) {
    segs.sort((a, b) => a.i - b.i)
    let charset = 'utf-8'
    let out = ''
    segs.forEach((s, idx) => {
      let v = s.v
      if (s.enc && idx === 0) {
        const m = /^([^']*)'[^']*'(.*)$/.exec(v)
        if (m) { charset = m[1] || 'utf-8'; v = m[2] }
      }
      out += s.enc ? pctDecodeToBytes(v) : Buffer.from(v, 'utf8').toString('latin1')
    })
    params[k] = decodeBytes(Buffer.from(out, 'latin1'), charset)
  }
  return { value, params }
}

function pctDecodeToBytes(s: string): string {
  return s.replace(/%([0-9a-fA-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
}

// ------------------------------------------------------------------ addresses

export function parseAddressList(raw: string | undefined): Address[] {
  if (!raw) return []
  const out: Address[] = []
  const walk = (list: ReturnType<typeof addressparser>): void => {
    for (const a of list) {
      if (a.group) { walk(a.group); continue }
      const email = (a.address ?? '').trim()
      if (!email) continue
      const name = decodeMimeWords(a.name ?? '').trim()
      out.push(name && name.toLowerCase() !== email.toLowerCase() ? { name, email } : { email })
    }
  }
  walk(addressparser(raw))
  return out
}

// ------------------------------------------------------------------ HTML

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™', euro: '€', bull: '•', middot: '·', laquo: '«', raquo: '»', deg: '°'
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      try { return String.fromCodePoint(cp) } catch { return m }
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m
  })
}

/** Crude but safe HTML -> plain text (search index + snippet fallback). Never rendered. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
