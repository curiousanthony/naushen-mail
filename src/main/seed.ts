import type { View } from '@shared/types'
import type { Repo } from './db/repo'

/** Default saved Views on first launch. Users can edit/delete them. */
const conversationsView = (position: number): View =>
  ({ id: 'view-conversations', name: 'Conversations', emoji: 'message', color: 'gray', filter: { role: 'all', conversation: true }, position, showInSidebar: true, showAsTab: false })

export function seedDefaultViews(repo: Repo): void {
  if (repo.kvGet('views-seeded')) return
  const views: View[] = [
    { id: 'view-unread', name: 'Unread', color: 'blue', filter: { role: 'inbox', unread: true }, position: 0, showInSidebar: true, showAsTab: false },
    { id: 'view-attachments', name: 'With attachments', color: 'gray', filter: { role: 'all', hasAttachment: true }, position: 1, showInSidebar: true, showAsTab: false }
  ]
  for (const v of views) repo.saveView(v)
  repo.kvSet('views-seeded', '1')
}

/**
 * "Conversations" is a default view. "Conversation" means someone else actually replied, not
 * repeated mail from one sender, so views an earlier build saved as "2+ messages" are upgraded
 * in place, and the view is added once for people who do not have it yet (they can delete it).
 */
export function seedConversationsView(repo: Repo): void {
  if (repo.kvGet('conversations-view-seeded')) return
  const views = repo.listViews()
  let found = false
  for (const v of views) {
    if (v.filter.conversation) { found = true; continue }
    if (v.filter.minMessages === 2 && !v.filter.maxMessages) {
      const { minMessages: _drop, ...rest } = v.filter
      repo.saveView({ ...v, filter: { ...rest, conversation: true } })
      found = true
    }
  }
  if (!found) repo.saveView(conversationsView(views.length))
  repo.kvSet('conversations-view-seeded', '1')
}
