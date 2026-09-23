/**
 * A tiny, dependency-free HTML parser.
 *
 * `htmlToDoc` has to run in the renderer *and* in Node unit tests, and the repo has no DOM
 * implementation for tests, so we parse with this instead of `DOMParser`. It is deliberately
 * forgiving (email HTML is rarely well-formed) and deliberately small: it understands tags,
 * attributes, void elements, comments, raw-text elements and the common implicit closings.
 * It is *not* a sanitiser — `htmlToDoc` decides what survives.
 */

export interface ElNode {
  kind: 'el'
  tag: string
  attrs: Record<string, string>
  children: HtmlNode[]
}
export interface TextNode {
  kind: 'text'
  text: string
}
export type HtmlNode = ElNode | TextNode

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const RAW_TEXT = new Set(['script', 'style', 'noscript', 'template'])
/** Opening one of these implicitly closes an open element of the listed kinds. */
const IMPLICIT_CLOSE: Record<string, string[]> = {
  li: ['li'],
  p: ['p'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  tr: ['td', 'th', 'tr'],
  tbody: ['td', 'th', 'tr'],
  thead: ['td', 'th', 'tr'],
  option: ['option'],
  dt: ['dt', 'dd'],
  dd: ['dt', 'dd']
}

export function parseHtml(html: string): ElNode {
  const root: ElNode = { kind: 'el', tag: '#root', attrs: {}, children: [] }
  const stack: ElNode[] = [root]
  const top = (): ElNode => stack[stack.length - 1]
  let i = 0

  const pushText = (raw: string): void => {
    if (!raw) return
    top().children.push({ kind: 'text', text: decodeEntities(raw) })
  }

  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt < 0) { pushText(html.slice(i)); break }
    if (lt > i) pushText(html.slice(i, lt))

    // Comment / doctype / CDATA — skipped entirely.
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      i = end < 0 ? html.length : end + 3
      continue
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt)
      i = end < 0 ? html.length : end + 1
      continue
    }

    const close = /^<\/\s*([a-zA-Z][a-zA-Z0-9:-]*)\s*>/.exec(html.slice(lt))
    if (close) {
      const tag = close[1].toLowerCase()
      const idx = findLast(stack, (e) => e.tag === tag)
      if (idx > 0) stack.length = idx
      i = lt + close[0].length
      continue
    }

    const open = /^<([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(html.slice(lt))
    if (!open) { pushText('<'); i = lt + 1; continue }

    const tag = open[1].toLowerCase()
    const selfClosing = /\/\s*$/.test(open[2])
    const attrs = parseAttrs(open[2])
    i = lt + open[0].length

    for (const t of IMPLICIT_CLOSE[tag] ?? []) {
      const idx = findLast(stack, (e) => e.tag === t)
      if (idx > 0) { stack.length = idx; break }
    }

    const el: ElNode = { kind: 'el', tag, attrs, children: [] }
    top().children.push(el)

    if (RAW_TEXT.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, i)
      i = end < 0 ? html.length : html.indexOf('>', end) + 1
      continue
    }
    if (!VOID.has(tag) && !selfClosing) stack.push(el)
  }
  return root
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const name = m[1].toLowerCase()
    if (name === '/') continue
    attrs[name] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '')
  }
  return attrs
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', bull: '•', middot: '·', trade: '™'
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? safeFromCodePoint(code) : whole
    }
    return NAMED[body.toLowerCase()] ?? whole
  })
}

function safeFromCodePoint(code: number): string {
  try { return String.fromCodePoint(code) } catch { return '' }
}

/** Parse a `style="a:b;c:d"` attribute into a map. */
export function parseStyleAttr(value: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const decl of (value ?? '').split(';')) {
    const c = decl.indexOf(':')
    if (c < 0) continue
    out[decl.slice(0, c).trim().toLowerCase()] = decl.slice(c + 1).trim()
  }
  return out
}

function findLast(stack: ElNode[], pred: (e: ElNode) => boolean): number {
  for (let i = stack.length - 1; i > 0; i--) if (pred(stack[i])) return i
  return -1
}
