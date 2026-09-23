/**
 * Curated icon set for saved Views — Notion's view/page icon picker is icons only, no emoji, so
 * this is too. `View.emoji` (never renamed at the DB/type level, to avoid a migration) now stores
 * one of these keys instead of a raw glyph. A value that isn't a known key (an old emoji, or a
 * view saved before this existed) is simply not recognised and the row falls back to its colour
 * dot -- never a crash, never a stray glyph.
 */
import {
  Archive, Bell, Bookmark, Briefcase, Flag, Flame, Folder, Heart, Inbox, Megaphone, MessageSquare,
  Newspaper, Pin, Receipt, Send, Star, Tag, Users, Zap, type LucideIcon
} from 'lucide-react'

export const VIEW_ICONS: Record<string, LucideIcon> = {
  inbox: Inbox, star: Star, flag: Flag, tag: Tag, users: Users, send: Send, receipt: Receipt,
  megaphone: Megaphone, pin: Pin, message: MessageSquare, newspaper: Newspaper, flame: Flame,
  briefcase: Briefcase, bell: Bell, archive: Archive, heart: Heart, bookmark: Bookmark,
  folder: Folder, zap: Zap
}

export const VIEW_ICON_KEYS = Object.keys(VIEW_ICONS)
