/**
 * Cleaning HTML that arrives on the clipboard (Word, Google Docs, web pages, Apple Mail)
 * before ProseMirror parses it.
 *
 * ProseMirror already discards what the schema cannot hold, but three kinds of junk survive
 * and make pasted mail look wrong: (1) colours and backgrounds from the source (white text
 * copied out of a dark web page), (2) wrapper elements that *mean* something to the parser —
 * Google Docs wraps everything in `<b style="font-weight:normal">`, which PM reads as bold —
 * and (3) Word's fake lists (`<p class=MsoListParagraph>` with a literal "·" glyph).
 *
 * Keeps: structure (paragraphs, headings, lists, quotes, tables, code, links, http(s)/data
 * images) and bold / italic / underline / strike. Drops everything else. String in, string
 * out, no DOM — so it runs in Node unit tests and in the renderer alike.
 */

import { escapeAttr, escapeHtml, safeUrl } from './escape'
import { parseHtml, parseStyleAttr, type ElNode, type HtmlNode } from './htmlparse'

const DROP = new Set([
  'script', 'style', 'meta', 'link', 'title', 'head', 'xml', 'svg', 'iframe', 'object', 'embed', 'form',
  'input', 'button', 'select', 'textarea', 'noscript', 'template', 'canvas', 'audio', 'video', 'colgroup', 'col'
])
const KEEP = new Set([
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'code', 'pre', 'br', 'p', 'div', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'img',
  'hr', 'sub', 'sup', 'span', 'mark'
])
const VOID = new Set(['br', 'hr', 'img'])
const NBSP = /[ \s]+/g

const isEl = (n: HtmlNode): n is ElNode => n.kind === 'el'
const textOf = (n: HtmlNode): string => (isEl(n) ? n.children.map(textOf).join('') : n.text)

/** Only the declarations that carry meaning in email: weight, slant, decoration. */
function keptStyle(style: string | undefined): string {
  const s = parseStyleAttr(style)
  const out: string[] = []
  const w = (s['font-weight'] ?? '').toLowerCase()
  if (w === 'bold' || w === 'bolder' || Number(w) >= 600) out.push('font-weight:700')
  if ((s['font-style'] ?? '').toLowerCase() === 'italic') out.push('font-style:italic')
  const deco = `${s['text-decoration'] ?? ''} ${s['text-decoration-line'] ?? ''}`.toLowerCase()
  const lines = [/underline/.test(deco) && 'underline', /line-through/.test(deco) && 'line-through'].filter(Boolean)
  if (lines.length) out.push(`text-decoration:${lines.join(' ')}`)
  return out.join(';')
}

const isNormalWeight = (style: string | undefined): boolean => /font-weight\s*:\s*(normal|400|300|lighter)\b/i.test(style ?? '')
const isNormalSlant = (style: string | undefined): boolean => /font-style\s*:\s*normal\b/i.test(style ?? '')

interface Ctx { word: boolean }

/** A Word "list paragraph": `mso-list:l0 level1 lfo1` (and not `mso-list:none`). */
function wordListKind(el: ElNode): 'ul' | 'ol' | null {
  const s = el.attrs.style ?? ''
  if (el.tag !== 'p' || !/mso-list\s*:\s*(?!none)\S/i.test(s)) return null
  const marker = el.children.find((c): c is ElNode => isEl(c) && c.tag === 'span' && /mso-list\s*:\s*ignore/i.test(c.attrs.style ?? ''))
  const glyph = marker ? textOf(marker).replace(NBSP, '') : ''
  return /^(\d+|[a-zA-Z]|[ivxlcIVXLC]+)[.)]$/.test(glyph) ? 'ol' : 'ul'
}

function cleanNodes(nodes: HtmlNode[], ctx: Ctx): HtmlNode[] {
  const out: HtmlNode[] = []
  for (const node of nodes) out.push(...cleanNode(node, ctx))
  return groupWordLists(out)
}

function cleanNode(node: HtmlNode, ctx: Ctx): HtmlNode[] {
  if (!isEl(node)) return [node]
  const { tag } = node
  if (DROP.has(tag)) return []
  if (tag === 'br' && /apple-interchange-newline/i.test(node.attrs.class ?? '')) return []

  if (tag === 'img') {
    const src = node.attrs.src ?? ''
    if (!/^(https?:|data:image\/)/i.test(src)) return []
    return [{ kind: 'el', tag, attrs: { src, ...(node.attrs.alt ? { alt: node.attrs.alt } : {}) }, children: [] }]
  }

  const listKind = ctx.word ? wordListKind(node) : null
  let children = node.children
  if (listKind) {
    // Drop the fake bullet ("·" / "1.") and its spacing; keep the paragraph text.
    children = children.filter((c) => !(isEl(c) && c.tag === 'span' && /mso-list\s*:\s*ignore/i.test(c.attrs.style ?? '')))
  }
  const kids = cleanNodes(children, ctx)

  // Anything not on the allow-list (namespaced Word tags, <font>, <center>, custom elements)
  // contributes its content only.
  if (!KEEP.has(tag)) return kids

  const style = keptStyle(node.attrs.style)
  switch (tag) {
    case 'b':
    case 'strong':
      // Google Docs' `<b style="font-weight:normal" id="docs-internal-guid-…">` wrapper.
      if (isNormalWeight(node.attrs.style)) return kids
      break
    case 'i':
    case 'em':
      if (isNormalSlant(node.attrs.style)) return kids
      break
    case 'span':
    case 'mark':
      return style ? [{ kind: 'el', tag: 'span', attrs: { style }, children: kids }] : kids
    case 'a': {
      const href = safeUrl(node.attrs.href)
      return href ? [{ kind: 'el', tag, attrs: { href }, children: kids }] : kids
    }
    case 'td':
    case 'th': {
      const attrs: Record<string, string> = {}
      if (/^\d+$/.test(node.attrs.colspan ?? '') && node.attrs.colspan !== '1') attrs.colspan = node.attrs.colspan
      if (/^\d+$/.test(node.attrs.rowspan ?? '') && node.attrs.rowspan !== '1') attrs.rowspan = node.attrs.rowspan
      return [{ kind: 'el', tag, attrs, children: kids }]
    }
    case 'p':
      // Word pads with `<p>&nbsp;</p>` between every paragraph; the spacing comes from CSS here.
      if (ctx.word && !listKind && !kids.some(isEl) && !textOf({ kind: 'el', tag, attrs: {}, children: kids }).replace(NBSP, '')) return []
      break
    default:
      break
  }
  // Semantic tags carry meaning by themselves; only spans keep a style. `p`/`div` never do.
  return [{ kind: 'el', tag, attrs: listKind ? { 'data-mso-list': listKind } : {}, children: kids }]
}

/** Runs of flagged Word paragraphs become one <ul>/<ol> of <li>. */
function groupWordLists(nodes: HtmlNode[]): HtmlNode[] {
  const out: HtmlNode[] = []
  for (const n of nodes) {
    const kind = isEl(n) ? n.attrs['data-mso-list'] : undefined
    if (isEl(n) && kind) {
      const li: ElNode = { kind: 'el', tag: 'li', attrs: {}, children: n.children }
      const prev = out[out.length - 1]
      if (prev && isEl(prev) && prev.tag === kind && prev.attrs['data-mso-run']) prev.children.push(li)
      else out.push({ kind: 'el', tag: kind, attrs: { 'data-mso-run': '1' }, children: [li] })
    } else out.push(n)
  }
  for (const n of out) if (isEl(n)) delete n.attrs['data-mso-run']
  return out
}

function serialize(nodes: HtmlNode[]): string {
  return nodes.map((n) => {
    if (!isEl(n)) return escapeHtml(n.text)
    const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('')
    return VOID.has(n.tag) ? `<${n.tag}${attrs}>` : `<${n.tag}${attrs}>${serialize(n.children)}</${n.tag}>`
  }).join('')
}

/** Sanitise clipboard HTML for the composer. Never throws: on any failure returns the input. */
export function cleanPastedHtml(html: string): string {
  try {
    const word = /mso-|MsoNormal|urn:schemas-microsoft-com:office|<o:p>/i.test(html)
    return serialize(cleanNodes(parseHtml(html).children, { word }))
  } catch {
    return html
  }
}
