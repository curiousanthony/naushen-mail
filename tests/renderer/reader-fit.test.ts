// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { MIN_FIT_SCALE, fitScale } from '../../src/renderer/features/reader/MessageBody'
import { buildBodyCss, buildBodyDocument, type ThemeTokens } from '../../src/renderer/features/reader/bodyDocument'
import { messageCodeText, newestActiveCode, CODE_TTL_MS } from '../../src/renderer/features/reader/codes'

describe('fitScale', () => {
  it('leaves content that fits alone', () => {
    expect(fitScale(500, 523)).toBe(1)
    expect(fitScale(523, 523)).toBe(1)
    expect(fitScale(524, 523)).toBe(1) // 1px of slack is not worth a scale
  })
  it('scales wide content to the frame with a pixel of slack', () => {
    expect(fitScale(880, 523)).toBe(0.593)
    expect(fitScale(700, 523)).toBe(0.745)
  })
  it('never goes below the readable floor', () => {
    expect(fitScale(4000, 500)).toBe(MIN_FIT_SCALE)
  })
  it('ignores nonsense measurements', () => {
    expect(fitScale(0, 500)).toBe(1)
    expect(fitScale(800, 0)).toBe(1)
    expect(fitScale(NaN, 500)).toBe(1)
  })
})

const tokens = new Proxy({}, { get: () => '#123456' }) as ThemeTokens

describe('body document: dark-mode adaptation', () => {
  const base = { html: '<p>x</p>', tokens, dark: true, paper: true }
  it('is off unless asked for', () => {
    expect(buildBodyCss(base)).not.toContain('invert(')
    expect(buildBodyDocument(base)).toContain('data-mr-scheme="paper"')
  })
  it('filters the page and pre-corrects images when adapted', () => {
    const css = buildBodyCss({ ...base, adapt: true })
    expect(css).toContain('html { filter: invert(0.9) hue-rotate(180deg); }')
    expect(css).toContain('img, video { filter: hue-rotate(180deg) invert(1) contrast(1.25); }')
    expect(buildBodyDocument({ ...base, adapt: true })).toContain('data-mr-scheme="adapted"')
  })
  it('never adapts light mode or mail that is not on paper', () => {
    expect(buildBodyCss({ ...base, dark: false, adapt: true })).not.toContain('invert(')
    expect(buildBodyCss({ ...base, paper: false, adapt: true })).not.toContain('invert(')
  })
  it('keeps plain-text spacing but still wraps', () => {
    expect(buildBodyCss(base)).toContain('.mr-plain > div { min-height: 1.55em; white-space: pre-wrap; }')
  })
})

describe('newestActiveCode', () => {
  const now = 1_700_000_000_000
  const msg = (agoMs: number, text: string) => ({ date: now - agoMs, subject: '', snippet: text, bodyText: null, bodyHtml: null })
  it('picks the newest message that still has a live code', () => {
    const r = newestActiveCode([msg(9 * 60_000, 'Your code is 111111'), msg(60_000, 'Your code is 222222')], now)
    expect(r?.code).toBe('222222')
  })
  it('falls back to an older, still-valid message when the newest has none', () => {
    const r = newestActiveCode([msg(2 * 60_000, 'Your code is 111111'), msg(30_000, 'thanks!')], now)
    expect(r?.code).toBe('111111')
  })
  it('is null once everything is past ten minutes', () => {
    expect(newestActiveCode([msg(CODE_TTL_MS + 1, 'Your code is 111111')], now)).toBeNull()
  })
  it('reads codes out of HTML-only bodies, ignoring markup and styles', () => {
    const html = '<style>.c{width:123456px}</style><p>Your <b>verification</b> code is <span>482913</span>.</p>'
    expect(messageCodeText({ subject: 'Hi', snippet: '', bodyText: null, bodyHtml: html })).toContain('482913')
    expect(newestActiveCode([{ date: now, subject: 'Hi', snippet: '', bodyText: null, bodyHtml: html }], now)?.code).toBe('482913')
  })
})
