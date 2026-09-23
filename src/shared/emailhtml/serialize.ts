/**
 * Block model -> email-safe HTML + plain-text alternative.
 *
 * Contract: `docs/05-email-html-contract.md`. Rules that shape every decision here:
 * email clients strip `<style>`, ignore JS, and disagree about CSS — so **inline styles
 * only**, tables for anything structural, a system font stack, no external assets, and
 * always a text/plain alternative. Pure functions: no DOM, no Node APIs (this module is
 * compiled for the renderer *and* imported by main).
 */

import { escapeAttr, escapeHtml, safeCid, safeColor, safeUrl, style } from './escape'
import type { DocMark, DocNode, InlineImage, SerializeOptions, SerializeResult } from './types'

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace"

/** Literal colours: email HTML cannot use CSS custom properties, so these are fixed light-mode values. */
const INK = '#37352f'
const INK_MUTED = '#6b6a66'
const RULE = '#e3e2e0'
const LINK = '#2383e2'
const CODE_BG = '#f4f3f1'
const CALLOUT_BG = '#f7f6f3'

const BLOCK_GAP = 'margin:0 0 12px'

interface Ctx {
  images: InlineImage[]
  cidPrefix: string
  seq: number
  /** Width of the body container in px — an image is never wider than the email can show. */
  maxWidth: number
}

// ------------------------------------------------------------------ public API

/**
 * Serialise a composer document to `{ html, text, inlineImages }`.
 *
 * `inlineImages` must be attached to the MIME message as inline parts with the matching
 * Content-ID; the HTML references them as `cid:<cid>` (see `src/main/mime/`).
 */
export function serializeToEmailHtml(doc: unknown, opts: SerializeOptions = {}): SerializeResult {
  const root = asNode(doc)
  const maxWidth = opts.maxWidth ?? 640
  const ctx: Ctx = { images: [], cidPrefix: opts.cidPrefix ?? randomToken(), seq: 0, maxWidth }

  const body = renderBlocks(root?.content ?? [], ctx)
  const parts: string[] = [body || emptyParagraph()]

  if (opts.signatureHtml && opts.signatureHtml.trim()) {
    parts.push(`<div${style('margin:24px 0 0', `color:${INK}`)}>${opts.signatureHtml}</div>`)
  }
  if (opts.quoted) parts.push(renderQuote(opts.quoted))

  const html =
    `<div${style(`font-family:${FONT}`, 'font-size:14px', 'line-height:1.5', `color:${INK}`,
      'width:100%', `max-width:${maxWidth}px`, 'word-wrap:break-word')}>` +
    parts.join('') +
    '</div>'

  const text = [
    textBlocks(root?.content ?? []).trim(),
    opts.signatureHtml ? htmlToPlainText(opts.signatureHtml).trim() : '',
    opts.quoted ? quoteToText(opts.quoted) : ''
  ].filter(Boolean).join('\n\n')

  return { html, text, inlineImages: ctx.images }
}

// ------------------------------------------------------------------ blocks

function renderBlocks(nodes: DocNode[], ctx: Ctx): string {
  return nodes.map((n) => renderBlock(n, ctx)).join('')
}

function renderBlock(n: DocNode, ctx: Ctx): string {
  switch (n.type) {
    case 'paragraph': {
      const inner = renderInline(n.content ?? [], ctx)
      return `<p${style(BLOCK_GAP, align(n))}>${inner || '&nbsp;'}</p>`
    }
    case 'heading': {
      const level = clamp(Number(n.attrs?.level ?? 1), 1, 3)
      const size = [26, 20, 16][level - 1]
      const top = [24, 20, 16][level - 1]
      return `<h${level}${style(`font-size:${size}px`, 'font-weight:600', 'line-height:1.3',
        `margin:${top}px 0 8px`, `color:${INK}`, align(n))}>${renderInline(n.content ?? [], ctx)}</h${level}>`
    }
    case 'bulletList':
      return `<ul${style(BLOCK_GAP, 'padding-left:24px')}>${renderListItems(n, ctx)}</ul>`
    case 'orderedList': {
      const start = Number(n.attrs?.start ?? 1)
      const startAttr = Number.isFinite(start) && start !== 1 ? ` start="${Math.trunc(start)}"` : ''
      return `<ol${startAttr}${style(BLOCK_GAP, 'padding-left:24px')}>${renderListItems(n, ctx)}</ol>`
    }
    case 'taskList':
      // Checkboxes cannot be interactive in email: render ☐ / ☑ prefixed lines.
      return `<div${style(BLOCK_GAP)}>${(n.content ?? []).map((i) => renderTaskItem(i, ctx)).join('')}</div>`
    case 'taskItem':
      return renderTaskItem(n, ctx)
    case 'blockquote':
      return `<blockquote${style(BLOCK_GAP, `border-left:3px solid ${RULE}`, 'padding:2px 0 2px 14px',
        `color:${INK_MUTED}`)}>${renderBlocks(n.content ?? [], ctx) || emptyParagraph()}</blockquote>`
    case 'horizontalRule':
      return `<hr${style('border:0', `border-top:1px solid ${RULE}`, 'margin:20px 0')} />`
    case 'codeBlock':
      return renderCodeBlock(n)
    case 'callout':
      return renderCallout(n, ctx)
    case 'details':
      return renderToggle(n, ctx)
    case 'detailsSummary':
      return `<p${style('margin:0 0 4px', 'font-weight:600')}>${renderInline(n.content ?? [], ctx)}</p>`
    case 'detailsContent':
      return renderBlocks(n.content ?? [], ctx)
    case 'table':
      return renderTable(n, ctx)
    case 'image':
      return renderImage(n, ctx)
    case 'hardBreak':
      return '<br />'
    case 'text':
      // A bare text node at block level (malformed doc): wrap it.
      return `<p${style(BLOCK_GAP)}>${renderInline([n], ctx)}</p>`
    default:
      // Unknown block: never drop content, render the children.
      return n.content ? renderBlocks(n.content, ctx) : ''
  }
}

function renderListItems(list: DocNode, ctx: Ctx): string {
  return (list.content ?? []).map((li) => {
    const inner = (li.content ?? []).map((child) =>
      child.type === 'paragraph'
        // Paragraphs inside a list item must not add block margins, or clients double-space lists.
        ? `<span${style(align(child))}>${renderInline(child.content ?? [], ctx) || '&nbsp;'}</span>`
        : renderBlock(child, ctx)
    ).join('')
    return `<li${style('margin:0 0 4px')}>${inner}</li>`
  }).join('')
}

function renderTaskItem(item: DocNode, ctx: Ctx): string {
  const checked = item.attrs?.checked === true
  const inner = (item.content ?? []).map((c) =>
    c.type === 'paragraph' ? renderInline(c.content ?? [], ctx) : renderBlock(c, ctx)
  ).join('')
  return `<p${style('margin:0 0 6px', checked ? `color:${INK_MUTED}` : '')}>` +
    `<span${style('font-size:15px')}>${checked ? '&#9745;' : '&#9744;'}</span>&nbsp;` +
    (checked ? `<span${style('text-decoration:line-through')}>${inner}</span>` : inner) +
    '</p>'
}

function renderCodeBlock(n: DocNode): string {
  const code = collectText(n)
  return `<pre${style(BLOCK_GAP, `background:${CODE_BG}`, `border:1px solid ${RULE}`, 'border-radius:4px',
    'padding:12px 14px', `font-family:${MONO}`, 'font-size:13px', 'line-height:1.45',
    'white-space:pre-wrap', 'word-wrap:break-word')}><code${style(`font-family:${MONO}`, 'font-size:13px')
    }>${escapeHtml(code)}</code></pre>`
}

/** Callout = 1x1 table with a tinted background and an emoji cell — the only layout most clients agree on. */
function renderCallout(n: DocNode, ctx: Ctx): string {
  const emoji = typeof n.attrs?.emoji === 'string' && n.attrs.emoji ? String(n.attrs.emoji) : '💡'
  const bg = safeColor(n.attrs?.background) ?? CALLOUT_BG
  const inner = renderBlocks(n.content ?? [], ctx) || emptyParagraph()
  return `<table cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${escapeAttr(bg)}"` +
    style(BLOCK_GAP, 'border-collapse:collapse', `background-color:${bg}`, 'border-radius:4px') + '>' +
    '<tr>' +
    `<td valign="top"${style('padding:12px 4px 12px 14px', 'font-size:16px', 'line-height:1.4', 'width:26px')}>${escapeHtml(emoji)}</td>` +
    `<td valign="top"${style('padding:12px 14px 12px 4px')}>${stripTrailingGap(inner)}</td>` +
    '</tr></table>'
}

/** Toggles do not survive any email client: flatten to a bold summary + indented children. */
function renderToggle(n: DocNode, ctx: Ctx): string {
  const summary = (n.content ?? []).find((c) => c.type === 'detailsSummary')
  const content = (n.content ?? []).filter((c) => c.type !== 'detailsSummary')
  const head = `<p${style('margin:0 0 4px', 'font-weight:600')}>&#9662;&nbsp;${
    summary ? renderInline(summary.content ?? [], ctx) : ''}</p>`
  const body = renderBlocks(content.flatMap((c) => (c.type === 'detailsContent' ? c.content ?? [] : [c])), ctx)
  return `<div${style(BLOCK_GAP)}>${head}<div${style('padding-left:18px')}>${stripTrailingGap(body)}</div></div>`
}

function renderTable(n: DocNode, ctx: Ctx): string {
  const rows = (n.content ?? []).map((row) => {
    const cells = (row.content ?? []).map((cell) => {
      const header = cell.type === 'tableHeader'
      const tag = header ? 'th' : 'td'
      const span = Number(cell.attrs?.colspan ?? 1)
      const rowspan = Number(cell.attrs?.rowspan ?? 1)
      const attrs = (span > 1 ? ` colspan="${Math.trunc(span)}"` : '') + (rowspan > 1 ? ` rowspan="${Math.trunc(rowspan)}"` : '')
      const inner = stripTrailingGap(renderBlocks(cell.content ?? [], ctx)) || '&nbsp;'
      return `<${tag}${attrs}${style(`border:1px solid ${RULE}`, 'padding:6px 10px', 'text-align:left', 'vertical-align:top',
        header ? `background-color:${CODE_BG}` : '', header ? 'font-weight:600' : '')}>${inner}</${tag}>`
    }).join('')
    return `<tr>${cells}</tr>`
  }).join('')
  return `<table cellpadding="0" cellspacing="0" border="0"${style(BLOCK_GAP, 'border-collapse:collapse',
    'width:100%', 'font-size:14px')}>${rows}</table>`
}

function renderImage(n: DocNode, ctx: Ctx): string {
  const rawSrc = typeof n.attrs?.src === 'string' ? n.attrs.src : ''
  const alt = typeof n.attrs?.alt === 'string' ? n.attrs.alt : ''
  const width = Number(n.attrs?.width)
  const align = imageAlign(n)
  let src: string | null = null

  const data = parseDataUri(rawSrc)
  if (data) {
    const cid = `${ctx.cidPrefix}-${++ctx.seq}@mailroom.local`
    ctx.images.push({
      cid,
      filename: typeof n.attrs?.title === 'string' && n.attrs.title ? String(n.attrs.title) : `image-${ctx.seq}.${extFor(data.mimeType)}`,
      mimeType: data.mimeType,
      dataBase64: data.dataBase64
    })
    src = `cid:${safeCid(cid) ?? ''}`
  } else if (rawSrc.startsWith('cid:')) {
    const cid = safeCid(rawSrc.slice(4))
    src = cid ? `cid:${cid}` : null
  } else {
    src = safeUrl(rawSrc)
  }
  if (!src) return alt ? `<p${style(BLOCK_GAP, `color:${INK_MUTED}`)}>${escapeHtml(alt)}</p>` : ''

  // Never resize an image wider than the body container itself can show.
  const w = Number.isFinite(width) && width > 0 ? ` width="${Math.min(Math.round(width), ctx.maxWidth)}"` : ''

  // Email clients disagree wildly on CSS (no flexbox/grid, `float` is unreliable), so the
  // only broadly-supported way to align a standalone image is `text-align` on its block-level
  // wrapper with the `<img>` itself `display:inline-block` (so the wrapper's text-align can
  // act on it). Left is the default, and rendered exactly as before (no text-align, `img`
  // stays `display:block`) so existing left-aligned mail is byte-identical.
  const wrapStyle = align === 'left' ? style(BLOCK_GAP) : style(BLOCK_GAP, `text-align:${align}`)
  const imgDisplay = align === 'left' ? 'display:block' : 'display:inline-block'
  return `<p${wrapStyle}><img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${w}` +
    style('max-width:100%', 'height:auto', 'border:0', imgDisplay) + ' /></p>'
}

/** Whitelisted: an unrecognised or tampered `align` value degrades to `left`, never passed through raw. */
function imageAlign(n: DocNode): 'left' | 'center' | 'right' {
  const a = n.attrs?.align
  return a === 'center' || a === 'right' ? a : 'left'
}

function renderQuote(q: { attribution: string; html?: string; text?: string }): string {
  const body = q.html ?? (q.text ? `<p${style(BLOCK_GAP, 'white-space:pre-wrap')}>${escapeHtml(q.text)}</p>` : '')
  return `<div${style('margin:24px 0 0')}>` +
    `<p${style('margin:0 0 8px', `color:${INK_MUTED}`, 'font-size:13px')}>${escapeHtml(q.attribution)}</p>` +
    `<blockquote type="cite"${style('margin:0', `border-left:3px solid ${RULE}`, 'padding:2px 0 2px 14px',
      `color:${INK_MUTED}`)}>${body}</blockquote></div>`
}

// ------------------------------------------------------------------ inline

/** Marks are nested outside-in in this order so identical runs merge predictably. */
const MARK_ORDER = ['link', 'textStyle', 'highlight', 'bold', 'italic', 'underline', 'strike', 'code']

function renderInline(nodes: DocNode[], ctx: Ctx): string {
  return nodes.map((n) => {
    if (n.type === 'hardBreak') return '<br />'
    if (n.type === 'image') return renderInlineImage(n, ctx)
    if (n.type === 'emoji') {
      const e = n.attrs?.emoji ?? n.attrs?.name
      return typeof e === 'string' ? escapeHtml(e) : ''
    }
    if (n.type === 'mention') {
      const label = n.attrs?.label ?? n.attrs?.id
      return typeof label === 'string' ? escapeHtml(label) : ''
    }
    if (n.type !== 'text') return n.content ? renderInline(n.content, ctx) : ''
    return applyMarks(escapeHtml(n.text ?? ''), n.marks ?? [])
  }).join('')
}

function renderInlineImage(n: DocNode, ctx: Ctx): string {
  const block = renderImage(n, ctx)
  // Unwrap the paragraph wrapper when the image sits inside a line of text.
  return block.replace(/^<p[^>]*>/, '').replace(/<\/p>$/, '')
}

function applyMarks(html: string, marks: DocMark[]): string {
  if (!html) return html
  const byType = new Map(marks.map((m) => [m.type, m]))
  let out = html
  // Innermost first: walk the order backwards so `link` ends up outermost.
  for (let i = MARK_ORDER.length - 1; i >= 0; i--) {
    const m = byType.get(MARK_ORDER[i])
    if (m) out = wrapMark(out, m)
  }
  for (const m of marks) if (!MARK_ORDER.includes(m.type)) out = wrapMark(out, m)
  return out
}

function wrapMark(inner: string, mark: DocMark): string {
  switch (mark.type) {
    case 'bold': case 'strong':
      return `<strong>${inner}</strong>`
    case 'italic': case 'em':
      return `<em>${inner}</em>`
    case 'underline':
      return `<u>${inner}</u>`
    case 'strike': case 'strikethrough':
      return `<s>${inner}</s>`
    case 'code':
      return `<code${style(`font-family:${MONO}`, 'font-size:0.92em', `background:${CODE_BG}`,
        'padding:1px 4px', 'border-radius:3px', 'color:#c2503e')}>${inner}</code>`
    case 'link': {
      const href = safeUrl(mark.attrs?.href)
      if (!href) return inner
      return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer"${
        style(`color:${LINK}`, 'text-decoration:underline')}>${inner}</a>`
    }
    case 'textStyle': {
      const color = safeColor(mark.attrs?.color)
      const bg = safeColor(mark.attrs?.backgroundColor)
      if (!color && !bg) return inner
      return `<span${style(color && `color:${color}`, bg && `background-color:${bg}`)}>${inner}</span>`
    }
    case 'highlight': {
      const bg = safeColor(mark.attrs?.color) ?? '#fdecc8'
      return `<span${style(`background-color:${bg}`, 'border-radius:2px', 'padding:0 2px')}>${inner}</span>`
    }
    default:
      return inner
  }
}

// ------------------------------------------------------------------ plain text

function textBlocks(nodes: DocNode[], indent = ''): string {
  return nodes.map((n) => textBlock(n, indent)).filter((s) => s !== null).join('')
}

function textBlock(n: DocNode, indent: string): string {
  switch (n.type) {
    case 'paragraph':
      return `${indent}${inlineText(n.content ?? [])}\n\n`
    case 'heading': {
      const level = clamp(Number(n.attrs?.level ?? 1), 1, 3)
      return `${indent}${'#'.repeat(level)} ${inlineText(n.content ?? [])}\n\n`
    }
    case 'bulletList':
      return (n.content ?? []).map((li) => `${indent}- ${listItemText(li, `${indent}  `)}`).join('') + '\n'
    case 'orderedList': {
      const start = Number(n.attrs?.start ?? 1) || 1
      return (n.content ?? []).map((li, i) => `${indent}${start + i}. ${listItemText(li, `${indent}   `)}`).join('') + '\n'
    }
    case 'taskList':
      return (n.content ?? []).map((i) => textBlock(i, indent)).join('') + '\n'
    case 'taskItem':
      return `${indent}[${n.attrs?.checked === true ? 'x' : ' '}] ${listItemText(n, `${indent}    `)}`
    case 'blockquote':
      return textBlocks(n.content ?? [], `${indent}> `)
    case 'horizontalRule':
      return `${indent}---\n\n`
    case 'codeBlock':
      return `${indent}\`\`\`\n${collectText(n).split('\n').map((l) => indent + l).join('\n')}\n${indent}\`\`\`\n\n`
    case 'callout': {
      const emoji = typeof n.attrs?.emoji === 'string' ? n.attrs.emoji : '💡'
      return `${indent}${emoji} ${textBlocks(n.content ?? [], indent).trim().replace(/\n/g, `\n${indent}   `)}\n\n`
    }
    case 'details': {
      const summary = (n.content ?? []).find((c) => c.type === 'detailsSummary')
      const rest = (n.content ?? []).filter((c) => c.type !== 'detailsSummary')
        .flatMap((c) => (c.type === 'detailsContent' ? c.content ?? [] : [c]))
      return `${indent}${inlineText(summary?.content ?? [])}\n${textBlocks(rest, `${indent}  `)}`
    }
    case 'table':
      return (n.content ?? []).map((row) =>
        `${indent}| ${(row.content ?? []).map((c) => inlineText(flattenInline(c)).replace(/\|/g, '\\|')).join(' | ')} |\n`
      ).join('') + '\n'
    case 'image': {
      const alt = typeof n.attrs?.alt === 'string' && n.attrs.alt ? n.attrs.alt : 'image'
      return `${indent}[${alt}]\n\n`
    }
    default:
      return n.content ? textBlocks(n.content, indent) : ''
  }
}

function listItemText(li: DocNode, indent: string): string {
  const [first, ...rest] = li.content ?? []
  const head = first ? (first.type === 'paragraph' ? inlineText(first.content ?? []) : textBlock(first, '').trim()) : ''
  const tail = rest.length ? textBlocks(rest, indent).replace(/\n+$/, '\n') : ''
  return `${head}\n${tail}`
}

function inlineText(nodes: DocNode[]): string {
  return nodes.map((n) => {
    if (n.type === 'hardBreak') return '\n'
    if (n.type === 'emoji') return typeof n.attrs?.emoji === 'string' ? n.attrs.emoji : ''
    if (n.type === 'image') return `[${typeof n.attrs?.alt === 'string' && n.attrs.alt ? n.attrs.alt : 'image'}]`
    if (n.type !== 'text') return n.content ? inlineText(n.content) : ''
    const text = n.text ?? ''
    const link = (n.marks ?? []).find((m) => m.type === 'link')
    const href = link ? safeUrl(link.attrs?.href) : null
    // Don't duplicate the URL when the anchor text already is the URL.
    return href && href !== text ? `${text} <${href}>` : text
  }).join('')
}

function flattenInline(n: DocNode): DocNode[] {
  return (n.content ?? []).flatMap((c) => (c.type === 'text' || c.type === 'emoji' || c.type === 'image' ? [c] : flattenInline(c)))
}

/** Crude tag-strip for the signature HTML in the plain-text alternative. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<\s*(br|BR)\s*\/?>/g, '\n')
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
}

function quoteToText(q: { attribution: string; html?: string; text?: string }): string {
  const body = q.text ?? (q.html ? htmlToPlainText(q.html) : '')
  return `${q.attribution}\n${body.trim().split('\n').map((l) => `> ${l}`).join('\n')}`
}

// ------------------------------------------------------------------ helpers

function asNode(v: unknown): DocNode | null {
  return v && typeof v === 'object' ? (v as DocNode) : null
}

function collectText(n: DocNode): string {
  if (n.type === 'text') return n.text ?? ''
  if (n.type === 'hardBreak') return '\n'
  return (n.content ?? []).map(collectText).join('')
}

function align(n: DocNode): string {
  const a = n.attrs?.textAlign
  return a === 'center' || a === 'right' || a === 'justify' ? `text-align:${a}` : ''
}

function emptyParagraph(): string {
  return `<p${style(BLOCK_GAP)}>&nbsp;</p>`
}

/** Remove the bottom margin of the last block inside a container (callout / table cell). */
function stripTrailingGap(html: string): string {
  const i = html.lastIndexOf(BLOCK_GAP)
  return i < 0 ? html : html.slice(0, i) + 'margin:0' + html.slice(i + BLOCK_GAP.length)
}

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : lo
}

export function parseDataUri(src: string): { mimeType: string; dataBase64: string } | null {
  const m = /^data:([a-zA-Z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(src ?? '')
  if (!m) return null
  const mimeType = m[1].toLowerCase()
  if (!mimeType.startsWith('image/')) return null
  return { mimeType, dataBase64: m[2].replace(/\s+/g, '') }
}

function extFor(mimeType: string): string {
  const sub = mimeType.split('/')[1] ?? 'png'
  return sub === 'jpeg' ? 'jpg' : sub.replace(/[^a-z0-9]/g, '') || 'png'
}

function randomToken(): string {
  return `img${Math.random().toString(36).slice(2, 10)}`
}
