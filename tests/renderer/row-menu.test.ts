import { describe, expect, it } from 'vitest'
import { buildRowMenu } from '@/features/threadlist/menuItems'
import { readShowListCount, showListCountPatch } from '@/features/threadlist/listPrefs'
import { SHORTCUTS } from '@/features/commands/shortcuts'
import { HANDLERS } from '@/features/commands/runner'
import type { AppSettings } from '@shared/types'

const t = { unread: true, starred: false, muted: false }

describe('row context menu', () => {
  it('offers Not spam (not Archive / Report spam) in Spam', () => {
    const ids = buildRowMenu(t, 'spam').map((i) => i.id)
    expect(ids[0]).toBe('notSpam')
    expect(ids).not.toContain('archive')
    expect(ids).not.toContain('spam')
  })
  it('offers Archive and Report spam in the Inbox, and reflects read / star state', () => {
    const items = buildRowMenu({ unread: false, starred: true, muted: false }, 'inbox')
    expect(items.map((i) => i.id)).toEqual(expect.arrayContaining(['archive', 'spam', 'trash', 'remind', 'label', 'move']))
    expect(items.find((i) => i.id === 'read')?.label).toBe('Mark as unread')
    expect(items.find((i) => i.id === 'star')?.label).toBe('Remove star')
  })
  it('only references commands that exist', () => {
    for (const role of ['inbox', 'spam', 'trash', null] as const) {
      for (const i of buildRowMenu(t, role)) expect(HANDLERS[i.cmd], i.cmd).toBeTypeOf('function')
    }
  })
})

describe('list keyboard shortcuts', () => {
  it('registers g l and documents the arrows without double-binding them', () => {
    expect(SHORTCUTS.find((s) => s.id === 'nav.list')?.keys).toEqual(['g l'])
    expect(SHORTCUTS.find((s) => s.id === 'nav.arrows')?.owner).toBe('list')
  })
})

describe('show count setting', () => {
  it('defaults off and round-trips', () => {
    expect(readShowListCount({} as AppSettings)).toBe(false)
    expect(readShowListCount({ ...({} as AppSettings), ...showListCountPatch(true) })).toBe(true)
  })
})
