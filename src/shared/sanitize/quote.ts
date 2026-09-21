/**
 * Quoted-reply detection.
 *
 * Mail clients have no standard marker for "everything below here is the message I am replying
 * to", so this uses the three signals that cover almost all real mail: client-specific container
 * classes/ids, a top-level `<blockquote>`, and an attribution line ("On …, … wrote:").
 *
 * Marked elements get `data-mr-quote="1"`. Nothing is deleted — the reader hides them with CSS
 * inside the iframe and offers a "…" toggle, so the user can always read the full message.
 */
import { childElements, type El } from './dom'

/** Containers clients wrap quoted history in. */
const QUOTE_SELECTORS = [
  '.gmail_quote',
  '.gmail_extra',
  '.yahoo_quoted',
  '#yahoo_quoted',
  '.moz-cite-prefix',
  '.OutlookMessageHeader',
  '#divRplyFwdMsg',
  '#appendonsend',
  '[id^="mail-editor-reference-message-container"]',
  'blockquote[type="cite"]'
].join(',')

/** Attribution lines, English + a few common localisations, plus separator banners. */
const ATTRIBUTION = new RegExp(
  '^\\s*(?:' +
    'On\\b[\\s\\S]{4,400}?\\bwrote\\s*:' +
    '|Le\\b[\\s\\S]{4,400}?a\\s+écrit\\s*:' +
    '|Am\\b[\\s\\S]{4,400}?schrieb\\s*:' +
    '|El\\b[\\s\\S]{4,400}?escribió\\s*:' +
    '|-{2,}\\s*(?:Original\\s+Message|Forwarded\\s+message|Message\\s+d\'origine)\\s*-{2,}' +
    '|_{5,}' +
  ')\\s*$',
  'i'
)

/** Is this element the first line of quoted history? */
function isQuoteStart(el: El): boolean {
  if (el.matches(QUOTE_SELECTORS)) return true
  const tag = el.tagName.toUpperCase()
  if (tag === 'BLOCKQUOTE') return true
  // An attribution line is usually a <div>/<p> whose entire text is "On … wrote:".
  const text = (el.textContent ?? '').replace(/ /g, ' ')
  if (text.length > 420) return false
  return ATTRIBUTION.test(text)
}

/** Does this subtree hold anything a reader would see? */
function hasVisibleContent(el: El): boolean {
  if ((el.textContent ?? '').trim()) return true
  return el.querySelectorAll('img,table,hr').length > 0
}

/**
 * Walk past single-child wrappers (emails are usually wrapped in one layout `<div>`) so the
 * quote marker is found among real siblings rather than one level too high.
 */
function contentRoot(body: El): El {
  let root = body
  for (let depth = 0; depth < 6; depth++) {
    const kids = childElements(root)
    if (kids.length !== 1) break
    const only = kids[0]
    const tag = only.tagName.toUpperCase()
    if (tag !== 'DIV' && tag !== 'SPAN' && tag !== 'TABLE' && tag !== 'TBODY' && tag !== 'TR' && tag !== 'TD' && tag !== 'BODY') break
    // Stop before descending into something we would want to mark as a whole.
    if (isQuoteStart(only)) break
    root = only
  }
  return root
}

/**
 * Mark the quoted tail of a message. Returns true when something was marked.
 * Never marks when that would hide the whole message.
 */
export function markQuotedText(body: El): boolean {
  const root = contentRoot(body)
  const kids = childElements(root)
  const start = kids.findIndex(isQuoteStart)
  if (start < 0) return false
  // Something must remain visible above the fold.
  const above = kids.slice(0, start)
  if (!above.some(hasVisibleContent)) return false
  let marked = false
  for (const el of kids.slice(start)) {
    if (!hasVisibleContent(el) && el.tagName.toUpperCase() !== 'HR') continue
    el.setAttribute('data-mr-quote', '1')
    marked = true
  }
  return marked
}
