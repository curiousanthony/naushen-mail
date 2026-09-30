import {
  AlarmClock, FileText, Inbox as InboxIcon, LayoutGrid, Layers, Search, Send, ShieldAlert, Star, Trash2, type LucideIcon
} from 'lucide-react'
import type { Label, SystemRole, View } from '@shared/types'
import type { Nav } from '@/lib/store'
import { VIEW_ICONS } from '../sidebar/viewIcons'

/** Same glyphs the sidebar uses for each folder (sidebar/index.tsx MAIL_ICON), keyed by role. */
const ROLE_ICON: Partial<Record<SystemRole, LucideIcon>> = {
  inbox: InboxIcon, all: Layers, starred: Star, sent: Send, drafts: FileText, trash: Trash2, spam: ShieldAlert
}

export type TitleIcon = { kind: 'icon'; Icon: LucideIcon } | { kind: 'dot'; color: string } | null

/** The icon shown before the list title: identical to the one the sidebar row for this view has. */
export function titleIconFor(nav: Nav, views: View[], labels: Label[]): TitleIcon {
  switch (nav.kind) {
    case 'role': { const Icon = ROLE_ICON[nav.role]; return Icon ? { kind: 'icon', Icon } : null }
    case 'categories': return { kind: 'icon', Icon: LayoutGrid }
    case 'snoozed': return { kind: 'icon', Icon: AlarmClock }
    case 'search': return { kind: 'icon', Icon: Search }
    case 'label': return { kind: 'dot', color: `var(--chip-${labels.find((l) => l.id === nav.labelId)?.color ?? 'gray'}-fg)` }
    case 'view': {
      const key = views.find((v) => v.id === nav.viewId)?.emoji
      return key && VIEW_ICONS[key] ? { kind: 'icon', Icon: VIEW_ICONS[key] } : null
    }
  }
}

export function TitleGlyph({ icon }: { icon: TitleIcon }): JSX.Element | null {
  if (!icon) return null
  return icon.kind === 'icon'
    ? <icon.Icon size={16} className="tl__emoji" aria-hidden />
    : <span className="tl__labeldot" style={{ background: icon.color }} aria-hidden />
}
