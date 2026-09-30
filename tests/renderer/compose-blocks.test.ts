/**
 * Pure logic behind the composer's blocks, send path and attachments. The React surface is
 * verified with the headless screenshot hook (see the PR), so these cover the decisions:
 * what the `/` menu offers, when a trigger fires, and how a send is routed.
 */

import { describe, expect, it } from 'vitest'
import {
  BLOCK_SHORTCUTS, backgroundColors, slashItems, textColors, filterSlashItems
} from '@/features/compose/slashItems'
import { detectEmojiTrigger, detectSlashTrigger, searchEmoji } from '@/features/compose/trigger'
import { buildOutgoing, inlineImagesToAttachments, planSend } from '@/features/compose/send'
import {
  arrayBufferToBase64, extensionLabel, formatBytes, isImageType, isOverSizeLimit,
  partitionFiles, totalBytes, MAX_TOTAL_BYTES
} from '@/features/compose/attachments'

// 1x1 transparent GIF.
const GIF_B64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

describe('slash menu catalogue', () => {
  it('offers every block the serializer can render', () => {
    const actions = slashItems().map((i) => i.action)
    for (const a of ['text', 'h1', 'h2', 'h3', 'bulletList', 'orderedList', 'taskList', 'toggle',
      'quote', 'divider', 'callout', 'code', 'table', 'image', 'link', 'emoji',
      'textColor', 'backgroundColor']) {
      expect(actions, a).toContain(a)
    }
  })

  it('ranks the obvious query first', () => {
    expect(filterSlashItems('h1')[0].action).toBe('h1')
    expect(filterSlashItems('todo')[0].action).toBe('taskList')
    expect(filterSlashItems('quote')[0].action).toBe('quote')
    expect(filterSlashItems('divider')[0].action).toBe('divider')
    expect(filterSlashItems('callout')[0].action).toBe('callout')
    // Fuzzy, not just prefix.
    expect(filterSlashItems('bulist').map((i) => i.action)).toContain('bulletList')
  })

  it('returns the curated order for an empty query and nothing for nonsense', () => {
    expect(filterSlashItems('')).toHaveLength(slashItems().length)
    expect(filterSlashItems('zzzqqq')).toEqual([])
  })

  it('appends local snippets as their own group so /<name> works', () => {
    const snippets = [{ id: 's1', name: 'Website link' }]
    const all = filterSlashItems('', snippets)
    expect(all.at(-1)).toMatchObject({ action: 'snippet', title: 'Website link', group: 'snippets' })

    const hit = filterSlashItems('website', snippets)
    expect(hit[0]).toMatchObject({ action: 'snippet', snippetId: 's1' })
  })

  it('maps cmd+alt+0-7 to the Notion block order', () => {
    expect(BLOCK_SHORTCUTS['0']).toBe('text')
    expect(BLOCK_SHORTCUTS['3']).toBe('h3')
    expect(BLOCK_SHORTCUTS['7']).toBe('toggle')
  })

  it('keeps colour palettes aligned and literal (email cannot use CSS variables)', () => {
    expect(textColors()).toHaveLength(backgroundColors().length)
    expect(textColors()[0].value).toBe('')
    // Both palettes lead with a "Default" entry that clears the mark.
    expect(backgroundColors()[0].value).toBe('')
    for (const c of [...textColors(), ...backgroundColors()].filter((x) => x.value)) {
      expect(c.value, c.name).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})

describe('menu triggers', () => {
  it('opens the block menu only at a word start', () => {
    expect(detectSlashTrigger('/')).toEqual({ query: '', from: 1 })
    expect(detectSlashTrigger('/head')).toEqual({ query: 'head', from: 5 })
    expect(detectSlashTrigger('write /quo')).toEqual({ query: 'quo', from: 4 })
    // Mid-word and URLs must not open it.
    expect(detectSlashTrigger('and/or')).toBeNull()
    expect(detectSlashTrigger('https://example.com')).toBeNull()
    // A space closes the menu.
    expect(detectSlashTrigger('/head one')).toBeNull()
  })

  it('requires a shortcode before offering emoji', () => {
    expect(detectEmojiTrigger(':')).toBeNull()
    expect(detectEmojiTrigger('Hi:')).toBeNull()
    expect(detectEmojiTrigger(':smi')).toEqual({ query: 'smi', from: 4 })
    expect(detectEmojiTrigger('note: this')).toBeNull()
    expect(detectEmojiTrigger('12:30')).toBeNull()
  })

  it('searches emoji by name and shortcode, exact first', () => {
    const list = [
      { name: 'smile', emoji: '😄' },
      { name: 'smiley', emoji: '😃' },
      { name: 'rocket', emoji: '🚀', shortcodes: ['ship'] }
    ]
    expect(searchEmoji(list, 'smile').map((e) => e.name)).toEqual(['smile', 'smiley'])
    expect(searchEmoji(list, 'ship')[0].emoji).toBe('🚀')
    expect(searchEmoji(list, 'zzz')).toEqual([])
  })
})

describe('send planning', () => {
  const now = 1_700_000_000_000

  it('sends directly when there is no undo window', () => {
    expect(planSend({ undoSendSeconds: 0, now })).toEqual({ kind: 'send' })
  })

  it('queues through the outbox so Undo has an id to cancel', () => {
    // compose.send returns void, so the undo window is implemented as a short schedule.
    expect(planSend({ undoSendSeconds: 10, now })).toEqual({ kind: 'undoable', at: now + 10_000, undoSeconds: 10 })
  })

  it('prefers an explicit schedule over the undo window', () => {
    const at = now + 86_400_000
    expect(planSend({ undoSendSeconds: 10, scheduledAt: at, now })).toEqual({ kind: 'scheduled', at })
  })

  it('ignores a scheduled time in the past', () => {
    expect(planSend({ undoSendSeconds: 5, scheduledAt: now - 1000, now }).kind).toBe('undoable')
    expect(planSend({ undoSendSeconds: 0, scheduledAt: now - 1000, now }).kind).toBe('send')
  })
})

describe('buildOutgoing', () => {
  const doc = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }]
  }

  it('serialises once into html + text', () => {
    const { message } = buildOutgoing({
      accountId: 'acc1',
      to: [{ email: 'ada@x.test' }], cc: [], bcc: [],
      subject: 'Hi', doc
    })
    expect(message.html).toContain('Hello')
    expect(message.text.trim()).toBe('Hello')
    expect(message.accountId).toBe('acc1')
    expect(message.attachments).toBeUndefined()
  })

  it('turns embedded data: images into inline cid attachments', () => {
    const withImage = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'See:' }] },
        { type: 'image', attrs: { src: `data:image/gif;base64,${GIF_B64}`, alt: 'dot' } }
      ]
    }
    const { message } = buildOutgoing({
      accountId: 'acc1', to: [{ email: 'ada@x.test' }], cc: [], bcc: [],
      subject: 'Hi', doc: withImage, cidPrefix: 'fixed'
    })
    const inline = message.attachments ?? []
    expect(inline).toHaveLength(1)
    expect(inline[0]).toMatchObject({ inline: true, mimeType: 'image/gif', dataBase64: GIF_B64 })
    // The HTML must reference the very cid we attached.
    expect(message.html).toContain(`cid:${inline[0].contentId}`)
    expect(message.html).not.toContain('data:image')
  })

  it('keeps paperclip attachments ahead of inline images', () => {
    const { message } = buildOutgoing({
      accountId: 'a', to: [{ email: 'a@b.test' }], cc: [], bcc: [], subject: 's',
      doc: { type: 'doc', content: [{ type: 'image', attrs: { src: `data:image/gif;base64,${GIF_B64}` } }] },
      attachments: [{ filename: 'report.pdf', mimeType: 'application/pdf', dataBase64: 'AAA' }]
    })
    expect(message.attachments?.map((a) => a.filename)).toEqual(['report.pdf', 'image-1.gif'])
  })

  it('carries the reply reference and appends signature + quote', () => {
    const { message } = buildOutgoing({
      accountId: 'a', to: [{ email: 'a@b.test' }], cc: [], bcc: [], subject: 'Re: hi', doc,
      signatureHtml: '<p>— Anthony</p>',
      quoted: { attribution: 'On 1 Jan 2026 at 09:00, Ada wrote:', text: 'original' },
      inReplyTo: { threadId: 't1', messageId: 'm1', mode: 'reply' },
      draftId: 'd1'
    })
    expect(message.html).toContain('— Anthony')
    expect(message.html).toContain('blockquote type="cite"')
    expect(message.text).toContain('> original')
    // inReplyTo is the local reference object; the RFC header is resolved in main.
    expect(message.inReplyTo).toEqual({ threadId: 't1', messageId: 'm1', mode: 'reply' })
    expect(message.draftId).toBe('d1')
  })

  it('maps inline images without touching the cid', () => {
    expect(inlineImagesToAttachments([
      { cid: 'x@mailroom.local', filename: 'a.png', mimeType: 'image/png', dataBase64: 'AA' }
    ])).toEqual([
      { filename: 'a.png', mimeType: 'image/png', dataBase64: 'AA', contentId: 'x@mailroom.local', inline: true }
    ])
  })
})

describe('attachments', () => {
  it('formats sizes the way a chip should read', () => {
    expect(formatBytes(0)).toBe('0 bytes')
    expect(formatBytes(1)).toBe('1 byte')
    expect(formatBytes(999)).toBe('999 bytes')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024 * 2.4)).toBe('2.4 MB')
    expect(formatBytes(-5)).toBe('0 bytes')
    expect(formatBytes(Number.NaN)).toBe('0 bytes')
  })

  it('totals and flags the provider limit', () => {
    expect(totalBytes([{ size: 10 }, { size: 5 }])).toBe(15)
    expect(isOverSizeLimit([{ size: MAX_TOTAL_BYTES }])).toBe(false)
    expect(isOverSizeLimit([{ size: MAX_TOTAL_BYTES + 1 }])).toBe(true)
  })

  it('recognises inline-able images', () => {
    expect(isImageType('image/png')).toBe(true)
    expect(isImageType('image/jpeg')).toBe(true)
    expect(isImageType('application/pdf')).toBe(false)
    expect(isImageType('')).toBe(false)
  })

  it('splits a drop into body images and paperclip files', () => {
    const f = (name: string, type: string): File => ({ name, type }) as File
    const { images, others } = partitionFiles([f('a.png', 'image/png'), f('b.pdf', 'application/pdf')])
    expect(images.map((i) => i.name)).toEqual(['a.png'])
    expect(others.map((i) => i.name)).toEqual(['b.pdf'])
  })

  it('labels extensions', () => {
    expect(extensionLabel('report.pdf')).toBe('PDF')
    expect(extensionLabel('sheet.xlsx')).toBe('XLSX')
    expect(extensionLabel('noext')).toBe('FILE')
  })

  it('base64-encodes without blowing the stack on a large buffer', () => {
    const big = new Uint8Array(200_000).fill(65) // 'A'
    const encoded = arrayBufferToBase64(big.buffer)
    expect(encoded).toBe(btoa('A'.repeat(200_000)))
  })
})
