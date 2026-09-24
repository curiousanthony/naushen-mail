export { serializeToEmailHtml, htmlToPlainText, parseDataUri } from './serialize'
export { htmlToDoc } from './htmlToDoc'
export { cleanPastedHtml } from './paste'
export { escapeHtml, escapeAttr, safeUrl, safeColor } from './escape'
export {
  replySubject, forwardSubject, formatAddress, formatQuoteDate, quoteAttribution,
  buildQuoted, forwardHeaderHtml, replyRecipients
} from './reply'
export type { DocNode, DocMark, InlineImage, QuotedOriginal, SerializeOptions, SerializeResult } from './types'
