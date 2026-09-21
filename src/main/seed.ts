import type { View } from '@shared/types'
import type { Repo } from './db/repo'

/** Default saved Views on first launch. Users can edit/delete them. */
export function seedDefaultViews(repo: Repo): void {
  if (repo.kvGet('views-seeded')) return
  const views: View[] = [
    { id: 'view-unread', name: 'Unread', emoji: '🔵', filter: { role: 'inbox', unread: true }, position: 0, showInSidebar: true, showAsTab: false },
    { id: 'view-attachments', name: 'With attachments', emoji: '📎', filter: { role: 'all', hasAttachment: true }, position: 1, showInSidebar: true, showAsTab: false }
  ]
  for (const v of views) repo.saveView(v)
  repo.kvSet('views-seeded', '1')
}
