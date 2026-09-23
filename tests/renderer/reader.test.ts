// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import DOMPurify from 'dompurify'
import type { Attachment, Message } from '@shared/types'
import { sanitizeEmailHtml } from '@shared/sanitize'
import { findUnsubscribe, parseListUnsubscribe } from '@/features/reader/unsubscribe'
import {
  LIST_MIN, PEEK_DEFAULT, PEEK_MIN, PEEK_STORAGE_KEY, clampPeekWidth, loadPeekWidth, savePeekWidth
} from '@/features/reader/peek'
import { attachmentKind, extensionOf, isPreviewable, visibleAttachments } from '@/features/reader/fileKinds'
import { dataUrlToBlob } from '@/features/reader/AttachmentPreview'
import { buildBodyCss, buildBodyDocument, type ThemeTokens } from '@/features/reader/bodyDocument'

// ------------------------------------------------------------------ unsubscribe

describe('parseListUnsubscribe', () => {
  it('prefers the https URL over the mailto', () => {
    const t = parseListUnsubscribe('<mailto:u@list.test?subject=stop>, <https://list.test/u?id=1>')
    expect(t).toEqual({ url: 'https://list.test/u?id=1', kind: 'http' })
  })

  it('falls back to mailto when that is all there is', () => {
    expect(parseListUnsubscribe('<mailto:u@list.test>')).toEqual({ url: 'mailto:u@list.test', kind: 'mailto' })
  })

  it('tolerates missing angle brackets and stray whitespace', () => {
    expect(parseListUnsubscribe('  https://list.test/u ')).toEqual({ url: 'https://list.test/u', kind: 'http' })
  })

  it('returns null for empty, missing or unusable headers', () => {
    expect(parseListUnsubscribe(undefined)).toBeNull()
    expect(parseListUnsubscribe('')).toBeNull()
    expect(parseListUnsubscribe('<ftp://list.test/u>')).toBeNull()
    expect(parseListUnsubscribe('<javascript:alert(1)>')).toBeNull()
  })
})

const msg = (over: Partial<Message>): Message => ({
  id: 'm', threadId: 't', accountId: 'a', remoteId: 'r',
  from: { email: 'a@b.test' }, to: [], cc: [], bcc: [],
  subject: 's', date: 0, snippet: '', bodyHtml: null, bodyText: null,
  attachments: [], unread: false, labelIds: [], isDraft: false, ...over
})

describe('findUnsubscribe', () => {
  it('takes the newest message that carries a header', () => {
    const t = findUnsubscribe([
      msg({ id: '1', listUnsubscribe: '<https://old.test/u>' }),
      msg({ id: '2', listUnsubscribe: '<https://new.test/u>' })
    ])
    expect(t?.url).toBe('https://new.test/u')
  })

  it('searches back through messages without one', () => {
    const t = findUnsubscribe([msg({ id: '1', listUnsubscribe: '<https://old.test/u>' }), msg({ id: '2' })])
    expect(t?.url).toBe('https://old.test/u')
  })

  it('returns null when no message has one', () => {
    expect(findUnsubscribe([msg({}), msg({})])).toBeNull()
  })
})

// ------------------------------------------------------------------ peek width

describe('clampPeekWidth', () => {
  it('keeps a comfortable width unchanged', () => {
    expect(clampPeekWidth(700, 1400)).toBe(700)
  })

  it('never goes below the minimum', () => {
    expect(clampPeekWidth(120, 1400)).toBe(PEEK_MIN)
  })

  it('always leaves room for the list', () => {
    expect(clampPeekWidth(1300, 1000)).toBe(1000 - LIST_MIN)
  })

  it('prefers the minimum width over the list room in a very narrow window', () => {
    // The list floor and the peek floor cannot both be honoured — the peek wins.
    expect(clampPeekWidth(800, 500)).toBe(PEEK_MIN)
  })

  it('falls back to the default for a non-numeric stored value', () => {
    expect(clampPeekWidth(NaN, 1400)).toBe(PEEK_DEFAULT)
    // 600px of room cannot fit the default, so the fallback is clamped like any other value.
    expect(clampPeekWidth(NaN, 600)).toBe(PEEK_MIN)
  })

  it('rounds fractional drag positions', () => {
    expect(clampPeekWidth(640.6, 1400)).toBe(641)
  })
})

describe('peek width persistence', () => {
  /**
   * This jsdom build exposes `localStorage` as a bare object with no methods, which is exactly
   * the degraded shape the production code guards against — so the working case is exercised
   * against an in-memory stand-in and the broken shapes are asserted separately.
   */
  const fakeStorage = (): Storage => {
    const map = new Map<string, string>()
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, String(v)) },
      removeItem: (k: string) => { map.delete(k) },
      clear: () => map.clear(),
      key: (i: number) => [...map.keys()][i] ?? null,
      get length() { return map.size }
    } as Storage
  }

  afterEach(() => { vi.unstubAllGlobals() })

  it('round-trips a width, clamped on read', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    savePeekWidth(880)
    expect(loadPeekWidth(1600)).toBe(880)
    // Same stored value, smaller window: clamped rather than stranding the list.
    expect(loadPeekWidth(900)).toBe(900 - LIST_MIN)
  })

  it('returns the default when nothing is stored', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    expect(loadPeekWidth(1600)).toBe(PEEK_DEFAULT)
  })

  it('ignores a stored value that is not a number', () => {
    const s = fakeStorage()
    s.setItem(PEEK_STORAGE_KEY, 'not-a-number')
    vi.stubGlobal('localStorage', s)
    expect(loadPeekWidth(1600)).toBe(PEEK_DEFAULT)
  })

  it('survives storage that throws (private mode, blocked site data)', () => {
    vi.stubGlobal('localStorage', {
      getItem() { throw new DOMException('denied') },
      setItem() { throw new DOMException('denied') }
    })
    expect(loadPeekWidth(1600)).toBe(PEEK_DEFAULT)
    expect(() => savePeekWidth(700)).not.toThrow()
  })

  it('survives storage that is missing its methods entirely', () => {
    vi.stubGlobal('localStorage', {})
    expect(loadPeekWidth(1600)).toBe(PEEK_DEFAULT)
    expect(() => savePeekWidth(700)).not.toThrow()
  })
})

// ------------------------------------------------------------------ attachments

describe('attachmentKind', () => {
  it('classifies by MIME type', () => {
    expect(attachmentKind('image/png', 'a.png')).toBe('image')
    expect(attachmentKind('application/pdf', 'a.pdf')).toBe('pdf')
    expect(attachmentKind('audio/mpeg', 'a.mp3')).toBe('audio')
    expect(attachmentKind('video/mp4', 'a.mp4')).toBe('video')
    expect(attachmentKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'a.xlsx')).toBe('sheet')
    expect(attachmentKind('application/vnd.ms-powerpoint', 'a.ppt')).toBe('slides')
    expect(attachmentKind('application/msword', 'a.doc')).toBe('doc')
    expect(attachmentKind('application/zip', 'a.zip')).toBe('archive')
  })

  it('falls back to the extension for the generic octet-stream mail sends everywhere', () => {
    expect(attachmentKind('application/octet-stream', 'statement.pdf')).toBe('pdf')
    expect(attachmentKind('application/octet-stream', 'photo.JPG')).toBe('image')
    expect(attachmentKind('', 'notes.md')).toBe('text')
    expect(attachmentKind('application/octet-stream', 'archive.tar.gz')).toBe('archive')
  })

  it('degrades to a plain file icon when nothing identifies it', () => {
    expect(attachmentKind('application/octet-stream', 'mystery')).toBe('file')
    expect(attachmentKind('', '')).toBe('file')
  })

  it('extensionOf ignores dotfiles and paths', () => {
    expect(extensionOf('a/b/c.png')).toBe('png')
    expect(extensionOf('.gitignore')).toBe('')
    expect(extensionOf('noext')).toBe('')
  })

  it('isPreviewable allows the kinds the reader can render inline, no others', () => {
    for (const k of ['image', 'pdf', 'audio', 'video', 'text', 'code'] as const) expect(isPreviewable(k), k).toBe(true)
    for (const k of ['doc', 'sheet', 'slides', 'archive', 'file'] as const) expect(isPreviewable(k), k).toBe(false)
  })
})

describe('dataUrlToBlob', () => {
  it('decodes a base64 data: URL with its mime type', async () => {
    const blob = dataUrlToBlob('data:application/pdf;base64,JVBERi0xLjQK')
    expect(blob.type).toBe('application/pdf')
    expect(await blob.text()).toBe('%PDF-1.4\n')
  })

  it('decodes a plain (non-base64) data: URL', async () => {
    const blob = dataUrlToBlob('data:text/plain,hello%20world')
    expect(blob.type).toBe('text/plain')
    expect(await blob.text()).toBe('hello world')
  })

  it('rejects anything that is not a data: URL', () => {
    expect(() => dataUrlToBlob('blob:file:///abc')).toThrow()
    expect(() => dataUrlToBlob('https://example.com/x.pdf')).toThrow()
  })
})

describe('visibleAttachments', () => {
  const att = (o: Partial<Attachment>): Attachment =>
    ({ id: 'a', filename: 'f', mimeType: 'application/pdf', size: 1, inline: false, ...o })

  it('hides inline images the body already renders, keeps real attachments', () => {
    const list = [att({ id: '1' }), att({ id: '2', inline: true, contentId: 'logo' }), att({ id: '3', inline: true })]
    expect(visibleAttachments(list).map((a) => a.id)).toEqual(['1', '3'])
  })
})

// ------------------------------------------------------------------ body document

const tokens: ThemeTokens = {
  '--font-ui': 'system-ui', '--font-mono': 'monospace',
  '--c-bg': '#191919',
  '--c-text': '#111', '--c-text-2': '#555', '--c-text-3': '#999', '--c-accent': '#2383e2',
  '--c-divider': '#eee', '--c-border': '#ddd', '--c-bg-hover': '#f5f5f5', '--c-bg-input': '#fafafa',
  '--reader-paper-bg': '#ffffff', '--reader-paper-text': '#37352f', '--reader-paper-text-2': '#666',
  '--reader-paper-divider': '#e3e3e3', '--reader-paper-accent': '#2383e2', '--reader-paper-fill': '#f1f1f1'
}

describe('buildBodyDocument', () => {
  const doc = (over = {}): string =>
    buildBodyDocument({ html: '<p>hi</p>', tokens, dark: false, paper: false, ...over })

  it('carries a CSP that forbids scripts and any non-image fetch', () => {
    const out = doc()
    expect(out).toContain('Content-Security-Policy')
    expect(out).toContain("default-src 'none'")
  })

  it('embeds no script affordance of its own', () => {
    expect(doc()).not.toMatch(/<script|\son[a-z]+=/i)
  })

  it('puts colour-carrying mail on the light paper surface even in dark mode', () => {
    const css = buildBodyCss({ html: '', tokens, dark: true, paper: true })
    expect(css).toContain('color-scheme: light')
    expect(css).toContain(tokens['--reader-paper-bg'])
    expect(css).not.toContain('filter: invert')
  })

  it('follows the app tokens for plain mail in dark mode', () => {
    const css = buildBodyCss({ html: '', tokens, dark: true, paper: false })
    expect(css).toContain('color-scheme: dark')
    expect(css).toContain(tokens['--c-text'])
  })

  it('neutralises author text colours only on the dark surface', () => {
    const darkPlain = buildBodyCss({ html: '', tokens, dark: true, paper: false })
    expect(darkPlain).toContain(`[data-mr-fg] { color: ${tokens['--c-text']} !important; }`)

    // On paper the author's colours are the right ones — leave them be.
    expect(buildBodyCss({ html: '', tokens, dark: true, paper: true })).not.toContain('data-mr-fg')
    expect(buildBodyCss({ html: '', tokens, dark: false, paper: false })).not.toContain('data-mr-fg')
  })

  it('emits no empty declarations — every token it interpolates must have a value', () => {
    // A missing token would render `background: ;`, which browsers drop silently and which
    // once made dark-mode newsletters transparent.
    const css = buildBodyCss({ html: '', tokens, dark: true, paper: true })
    expect(css).not.toMatch(/:\s*;/)
  })

  it('names the surface explicitly so the frame does not show a UA canvas', () => {
    // `transparent` here lets a dark color-scheme paint #121212 over the app's own background.
    const css = buildBodyCss({ html: '', tokens, dark: true, paper: false })
    expect(css).toContain(`html { background: ${tokens['--c-bg']}`)
    expect(css).toContain(`background: ${tokens['--c-bg']}`)
    expect(css).not.toMatch(/background:\s*transparent/)
  })

  it('hides quoted history until the parent opts in', () => {
    const css = buildBodyCss({ html: '', tokens, dark: false, paper: false })
    expect(css).toContain('[data-mr-quote] { display: none; }')
    expect(css).toContain('.mr-show-quote [data-mr-quote]')
  })
})

// ------------------------------------------------------------------ sanitiser isolation

describe('sanitiser isolation', () => {
  it('does not install its hooks on the shared DOMPurify export', () => {
    // The composer sanitises pasted HTML through the same library. If our mail hooks lived on
    // the default instance they would rewrite its links and blank its images.
    sanitizeEmailHtml('<a href="https://x.test">x</a><img src="https://x.test/p.gif">')
    const other = DOMPurify.sanitize('<a href="https://x.test">x</a><img src="https://x.test/p.gif">')
    expect(other).toContain('https://x.test/p.gif')
    expect(other).not.toContain('target="_blank"')
    expect(other).not.toContain('data-mr-blocked')
  })
})
