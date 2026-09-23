/**
 * Email HTML -> composer document (the inverse of `serializeToEmailHtml`, best-effort).
 *
 * Used when reopening a saved draft that only has HTML, and when editing a forwarded
 * message. Lossy by nature: anything we do not recognise degrades to paragraphs and
 * inline marks rather than being dropped.
 */

import { parseHtml, parseStyleAttr, type ElNode, type HtmlNode } from './htmlparse'
import { safeColor, safeUrl } from './escape'
import type { DocMark, DocNode } from './types'

const BLOCK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'hr', 'pre',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'section', 'article', 'header', 'footer', 'figure', 'center'
])

export function htmlToDoc(html: string): DocNode {
  const root = parseHtml(html ?? '')
  const content = mergeTaskItems(blocks(root.children))
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}

// ------------------------------------------------------------------ blocks

function blocks(nodes: HtmlNode[]): DocNode[] {
  const out: DocNode[] = []
  let loose: HtmlNode[] = []
  const flush = (): void => {
    if (!loose.length) return
    const inline = inlines(loose, [])
    if (inline.some(hasVisibleContent)) out.push({ type: 'paragraph', content: inline })
    loose = []
  }
  for (const n of nodes) {
    if (n.kind === 'el' && BLOCK_TAGS.has(n.tag)) {
      flush()
      out.push(...block(n))
    } else {
      loose.push(n)
    }
  }
  flush()
  return out
}

function block(el: ElNode): DocNode[] {
  switch (el.tag) {
    case 'p': case 'center': {
      const inline = inlines(el.children, [])
      const task = asTaskItem(inline)
      if (task) return [task]
      return [withAlign({ type: 'paragraph', content: inline.some(hasVisibleContent) ? inline : undefined }, el)]
    }
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return [withAlign({
        type: 'heading',
        attrs: { level: Math.min(3, Number(el.tag[1])) },
        content: inlines(el.children, [])
      }, el)]
    case 'ul': case 'ol': {
      const items = el.children.filter(isEl).filter((c) => c.tag === 'li').map((li) => ({
        type: 'listItem',
        content: ensureBlocks(blocks(li.children))
      }))
      if (!items.length) return []
      const start = Number(el.attrs.start)
      return [{
        type: el.tag === 'ul' ? 'bulletList' : 'orderedList',
        ...(el.tag === 'ol' ? { attrs: { start: Number.isFinite(start) && start > 0 ? start : 1 } } : {}),
        content: items
      }]
    }
    case 'li':
      // A stray <li> outside a list.
      return blocks(el.children)
    case 'blockquote':
      return [{ type: 'blockquote', content: ensureBlocks(blocks(el.children)) }]
    case 'hr':
      return [{ type: 'horizontalRule' }]
    case 'pre':
      return [{ type: 'codeBlock', content: textOf(el) ? [{ type: 'text', text: textOf(el).replace(/\n$/, '') }] : undefined }]
    case 'table':
      return [tableOrCallout(el)]
    case 'div': case 'section': case 'article': case 'header': case 'footer': case 'figure':
      return asToggle(el) ?? blocks(el.children)
    case 'thead': case 'tbody': case 'tr': case 'td': case 'th':
      return blocks(el.children)
    default:
      return blocks(el.children)
  }
}

function withAlign(node: DocNode, el: ElNode): DocNode {
  const align = parseStyleAttr(el.attrs.style)['text-align'] ?? el.attrs.align
  if (align === 'center' || align === 'right' || align === 'justify') {
    node.attrs = { ...node.attrs, textAlign: align }
  }
  return node
}

/** `<p>☐ do the thing</p>` (our own to-do rendering) becomes a taskItem again. */
function asTaskItem(inline: DocNode[]): DocNode | null {
  const first = inline[0]
  if (!first || first.type !== 'text') return null
  const m = /^([☐☑☒])[\s ]*/.exec(first.text ?? '')
  if (!m) return null
  const rest: DocNode[] = [{ ...first, text: (first.text ?? '').slice(m[0].length) }, ...inline.slice(1)]
  const body = rest.filter(hasVisibleContent)
  return {
    type: 'taskItem',
    attrs: { checked: m[1] !== '☐' },
    content: [{ type: 'paragraph', content: body.length ? stripStrike(body) : undefined }]
  }
}

/** Checked to-dos are rendered with a line-through span; don't bring the mark back. */
function stripStrike(nodes: DocNode[]): DocNode[] {
  return nodes.map((n) => (n.marks ? { ...n, marks: n.marks.filter((m) => m.type !== 'strike') } : n))
    .map((n) => (n.marks && !n.marks.length ? { type: n.type, text: n.text, attrs: n.attrs, content: n.content } : n))
}

/**
 * Recover a toggle from the flattened form the serializer emits: a bold summary paragraph
 * starting with ▾ followed by an indented sibling div.
 */
function asToggle(el: ElNode): DocNode[] | null {
  const kids = el.children.filter((c) => c.kind === 'el' || c.text.trim()) as HtmlNode[]
  if (kids.length !== 2) return null
  const [head, body] = kids
  if (!isEl(head) || !isEl(body) || head.tag !== 'p' || body.tag !== 'div') return null
  if (!parseStyleAttr(body.attrs.style)['padding-left']) return null
  const inline = inlines(head.children, [])
  const first = inline[0]
  if (!first || first.type !== 'text' || !/^▾[\s ]*/.test(first.text ?? '')) return null
  const summary = [{ ...first, text: (first.text ?? '').replace(/^▾[\s ]*/, '') }, ...inline.slice(1)]
    .filter(hasVisibleContent)
  return [{
    type: 'details',
    content: [
      { type: 'detailsSummary', content: summary.length ? summary : undefined },
      { type: 'detailsContent', content: ensureBlocks(mergeTaskItems(blocks(body.children))) }
    ]
  }]
}

/** Consecutive taskItems belong to one taskList. */
function mergeTaskItems(nodes: DocNode[]): DocNode[] {
  const out: DocNode[] = []
  for (const n of nodes) {
    if (n.type === 'taskItem') {
      const prev = out[out.length - 1]
      if (prev && prev.type === 'taskList') prev.content!.push(n)
      else out.push({ type: 'taskList', content: [n] })
    } else {
      out.push(n)
    }
  }
  return out
}

/** Our callouts are a 1-row, 2-cell table whose first cell holds only an emoji. */
function tableOrCallout(el: ElNode): DocNode {
  const rows = collectRows(el)
  if (rows.length === 1 && rows[0].length === 2) {
    const icon = textOf(rows[0][0]).trim()
    if (icon && [...icon].length <= 2 && !/[a-z0-9]/i.test(icon)) {
      const bg = safeColor(parseStyleAttr(el.attrs.style)['background-color']) ?? safeColor(el.attrs.bgcolor)
      return {
        type: 'callout',
        attrs: { emoji: icon, ...(bg ? { background: bg } : {}) },
        content: ensureBlocks(mergeTaskItems(blocks(rows[0][1].children)))
      }
    }
  }
  return {
    type: 'table',
    content: rows.map((cells) => ({
      type: 'tableRow',
      content: cells.map((c) => ({
        type: c.tag === 'th' ? 'tableHeader' : 'tableCell',
        attrs: {
          colspan: intAttr(c.attrs.colspan, 1),
          rowspan: intAttr(c.attrs.rowspan, 1),
          colwidth: null
        },
        content: ensureBlocks(mergeTaskItems(blocks(c.children)))
      }))
    }))
  }
}

function collectRows(el: ElNode): ElNode[][] {
  const rows: ElNode[][] = []
  const walk = (n: ElNode): void => {
    for (const c of n.children) {
      if (!isEl(c)) continue
      if (c.tag === 'tr') rows.push(c.children.filter(isEl).filter((x) => x.tag === 'td' || x.tag === 'th'))
      else if (c.tag === 'thead' || c.tag === 'tbody' || c.tag === 'tfoot') walk(c)
    }
  }
  walk(el)
  return rows.filter((r) => r.length)
}

// ------------------------------------------------------------------ inline

function inlines(nodes: HtmlNode[], marks: DocMark[]): DocNode[] {
  const out: DocNode[] = []
  for (const n of nodes) {
    if (n.kind === 'text') {
      const text = n.text.replace(/\s+/g, ' ')
      if (text) out.push(marks.length ? { type: 'text', text, marks } : { type: 'text', text })
      continue
    }
    if (n.tag === 'br') { out.push({ type: 'hardBreak' }); continue }
    if (n.tag === 'img') {
      const src = n.attrs.src ?? ''
      const ok = src.startsWith('cid:') || src.startsWith('data:image/') || safeUrl(src)
      if (ok) out.push({ type: 'image', attrs: { src, alt: n.attrs.alt ?? '', title: n.attrs.title ?? null } })
      continue
    }
    const mark = markFor(n)
    out.push(...inlines(n.children, mark ? dedupe([...marks, mark]) : marks))
  }
  return collapse(out)
}

function markFor(el: ElNode): DocMark | null {
  switch (el.tag) {
    case 'strong': case 'b': return { type: 'bold' }
    case 'em': case 'i': return { type: 'italic' }
    case 'u': case 'ins': return { type: 'underline' }
    case 's': case 'strike': case 'del': return { type: 'strike' }
    case 'code': case 'kbd': case 'samp': return { type: 'code' }
    case 'mark': return { type: 'highlight' }
    case 'a': {
      const href = safeUrl(el.attrs.href)
      return href ? { type: 'link', attrs: { href } } : null
    }
    case 'span': case 'font': {
      const st = parseStyleAttr(el.attrs.style)
      const color = safeColor(st.color) ?? safeColor(el.attrs.color)
      const bg = safeColor(st['background-color']) ?? safeColor(st.background)
      const weight = st['font-weight']
      if (weight === 'bold' || Number(weight) >= 600) return { type: 'bold' }
      if (st['text-decoration']?.includes('line-through')) return { type: 'strike' }
      if (st['text-decoration']?.includes('underline')) return { type: 'underline' }
      if (color || bg) return { type: 'textStyle', attrs: { ...(color ? { color } : {}), ...(bg ? { backgroundColor: bg } : {}) } }
      return null
    }
    default:
      return null
  }
}

/** Merge adjacent text nodes carrying identical marks — keeps the doc (and snapshots) tidy. */
function collapse(nodes: DocNode[]): DocNode[] {
  const out: DocNode[] = []
  for (const n of nodes) {
    const prev = out[out.length - 1]
    if (n.type === 'text' && prev && prev.type === 'text' && sameMarks(prev.marks, n.marks)) {
      prev.text = (prev.text ?? '') + (n.text ?? '')
    } else {
      out.push(n)
    }
  }
  if (out.length && out[0].type === 'text') out[0].text = (out[0].text ?? '').replace(/^\s+/, '')
  const last = out[out.length - 1]
  if (last && last.type === 'text') last.text = (last.text ?? '').replace(/\s+$/, '')
  // Keep whitespace-only runs: they are the spaces *between* differently-marked words.
  return out.filter((n) => n.type !== 'text' || (n.text ?? '') !== '')
}

function sameMarks(a: DocMark[] | undefined, b: DocMark[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
}

function dedupe(marks: DocMark[]): DocMark[] {
  const seen = new Set<string>()
  return marks.filter((m) => {
    const key = m.type === 'textStyle' || m.type === 'link' ? JSON.stringify(m) : m.type
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ------------------------------------------------------------------ helpers

function hasVisibleContent(n: DocNode): boolean {
  return n.type !== 'text' || !!(n.text && n.text.trim())
}

function ensureBlocks(nodes: DocNode[]): DocNode[] {
  return nodes.length ? nodes : [{ type: 'paragraph' }]
}

function isEl(n: HtmlNode): n is ElNode {
  return n.kind === 'el'
}

function textOf(n: HtmlNode): string {
  if (n.kind === 'text') return n.text
  if (n.tag === 'br') return '\n'
  return n.children.map(textOf).join('')
}

function intAttr(v: string | undefined, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback
}
