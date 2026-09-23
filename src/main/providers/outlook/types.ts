/** The subset of Microsoft Graph resource shapes this adapter reads. */

export interface GraphEmailAddress { emailAddress?: { name?: string; address?: string } }

export interface GraphAttachment {
  id: string
  name?: string
  contentType?: string
  size?: number
  isInline?: boolean
  contentId?: string | null
  contentBytes?: string
  '@odata.type'?: string
}

export interface GraphHeader { name: string; value: string }

export interface GraphMessage {
  id: string
  '@removed'?: { reason?: string }
  conversationId?: string
  conversationIndex?: string
  subject?: string | null
  bodyPreview?: string
  body?: { contentType?: string; content?: string }
  from?: GraphEmailAddress
  sender?: GraphEmailAddress
  toRecipients?: GraphEmailAddress[]
  ccRecipients?: GraphEmailAddress[]
  bccRecipients?: GraphEmailAddress[]
  replyTo?: GraphEmailAddress[]
  receivedDateTime?: string
  sentDateTime?: string
  createdDateTime?: string
  isRead?: boolean
  isDraft?: boolean
  hasAttachments?: boolean
  flag?: { flagStatus?: string }
  categories?: string[]
  parentFolderId?: string
  internetMessageId?: string
  internetMessageHeaders?: GraphHeader[]
  attachments?: GraphAttachment[]
}

export interface GraphMailFolder { id: string; displayName?: string }

export interface GraphCategory { id: string; displayName: string; color?: string }

export interface Page<T> {
  value?: T[]
  '@odata.nextLink'?: string
  '@odata.deltaLink'?: string
}

/** Well-known folder names used as remote label ids for system labels. */
export const WELL_KNOWN = ['inbox', 'sentitems', 'drafts', 'deleteditems', 'junkemail', 'archive'] as const
export type WellKnown = (typeof WELL_KNOWN)[number]
