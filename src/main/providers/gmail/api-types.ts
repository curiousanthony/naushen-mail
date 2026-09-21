/** Minimal typings for the parts of the Gmail REST API this adapter touches. */

export interface GmailHeader { name: string; value: string }

export interface GmailPartBody {
  size?: number
  /** base64url of the transfer-decoded bytes (only for small parts). */
  data?: string
  attachmentId?: string
}

export interface GmailPart {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: GmailHeader[]
  body?: GmailPartBody
  parts?: GmailPart[]
}

export interface GmailMessage {
  id: string
  threadId: string
  labelIds?: string[]
  snippet?: string
  historyId?: string
  /** epoch ms, as a string */
  internalDate?: string
  sizeEstimate?: number
  payload?: GmailPart
}

export interface GmailThread {
  id: string
  historyId?: string
  snippet?: string
  messages?: GmailMessage[]
}

export interface GmailLabelColor { textColor: string; backgroundColor: string }

export interface GmailLabel {
  id: string
  name: string
  type?: 'system' | 'user'
  messageListVisibility?: string
  labelListVisibility?: string
  color?: GmailLabelColor
}

export interface GmailHistoryRecord {
  id: string
  messages?: { id: string; threadId: string }[]
  messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[]
  messagesDeleted?: { message: { id: string; threadId: string; labelIds?: string[] } }[]
  labelsAdded?: { message: { id: string; threadId: string; labelIds?: string[] }; labelIds?: string[] }[]
  labelsRemoved?: { message: { id: string; threadId: string; labelIds?: string[] }; labelIds?: string[] }[]
}

export interface GmailHistoryResponse {
  history?: GmailHistoryRecord[]
  historyId?: string
  nextPageToken?: string
}

export interface GmailProfile { emailAddress: string; historyId: string; messagesTotal?: number; threadsTotal?: number }
