import { describe, expect, it } from 'vitest'
import { KeyMatcher, SEQUENCE_TIMEOUT_MS, bindingToKeycaps, bindingToText, eventToCombo, isEditableElement, normalizeBinding, type KeyLike } from '@/features/commands/keys'

const ev = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods })

describe('eventToCombo', () => {
  it('lower-cases letters and records shift for letters', () => {
    expect(eventToCombo(ev('e'), true)).toBe('e')
    expect(eventToCombo(ev('E', { shiftKey: true }), true)).toBe('shift+e')
  })
  it('does not record shift for symbols (# ! ? are shifted characters)', () => {
    expect(eventToCombo(ev('#', { shiftKey: true }), true)).toBe('#')
    expect(eventToCombo(ev('!', { shiftKey: true }), true)).toBe('!')
    expect(eventToCombo(ev('?', { shiftKey: true }), true)).toBe('?')
    expect(eventToCombo(ev('/'), true)).toBe('/')
  })
  it('maps cmd to mod on mac and ctrl to mod elsewhere', () => {
    expect(eventToCombo(ev('k', { metaKey: true }), true)).toBe('mod+k')
    expect(eventToCombo(ev('k', { ctrlKey: true }), false)).toBe('mod+k')
    expect(eventToCombo(ev('1', { ctrlKey: true }), true)).toBe('ctrl+1')
    expect(eventToCombo(ev('\\', { metaKey: true }), true)).toBe('mod+\\')
  })
  it('names special keys', () => {
    expect(eventToCombo(ev('Escape'), true)).toBe('esc')
    expect(eventToCombo(ev('Enter', { metaKey: true, shiftKey: true }), true)).toBe('mod+shift+enter')
    expect(eventToCombo(ev('ArrowDown', { shiftKey: true }), true)).toBe('shift+down')
    expect(eventToCombo(ev(' '), true)).toBe('space')
    expect(eventToCombo(ev('Backspace'), true)).toBe('backspace')
  })
  it('recovers the physical key under Option', () => {
    expect(eventToCombo({ ...ev('¡', { altKey: true, metaKey: true }), code: 'Digit1' }, true)).toBe('mod+alt+1')
  })
  it('ignores bare modifier presses', () => {
    expect(eventToCombo(ev('Shift', { shiftKey: true }), true)).toBeNull()
    expect(eventToCombo(ev('Meta', { metaKey: true }), true)).toBeNull()
  })
})

describe('normalizeBinding', () => {
  it('canonicalises aliases and modifier order', () => {
    expect(normalizeBinding('Cmd+Shift+Enter')).toBe('mod+shift+enter')
    expect(normalizeBinding('shift+ctrl+K')).toBe('ctrl+shift+k')
    expect(normalizeBinding('G  I')).toBe('g i')
    expect(normalizeBinding('mod+\\')).toBe('mod+\\')
    expect(normalizeBinding('Escape')).toBe('esc')
  })
})

describe('KeyMatcher (g-then sequences)', () => {
  const m = (): KeyMatcher => new KeyMatcher([
    { binding: 'g i', id: 'go.inbox' }, { binding: 'g t', id: 'go.sent' }, { binding: 'e', id: 'archive' }, { binding: 'shift+e', id: 'inbox' }, { binding: 'mod+k', id: 'palette' }
  ])
  it('matches single keys immediately', () => {
    expect(m().feed('e', 0)).toEqual({ kind: 'match', id: 'archive' })
    expect(m().feed('shift+e', 0)).toEqual({ kind: 'match', id: 'inbox' })
    expect(m().feed('mod+k', 0)).toEqual({ kind: 'match', id: 'palette' })
    expect(m().feed('q', 0)).toEqual({ kind: 'none' })
  })
  it('matches a sequence and resets after', () => {
    const k = m()
    expect(k.feed('g', 0)).toEqual({ kind: 'pending', prefix: ['g'] })
    expect(k.feed('i', 200)).toEqual({ kind: 'match', id: 'go.inbox' })
    expect(k.pending).toEqual([])
    expect(k.feed('i', 300)).toEqual({ kind: 'none' })
  })
  it('lists continuations for the hint', () => {
    const k = m()
    k.feed('g', 0)
    expect(k.continuations().map((c) => c.keys).sort()).toEqual(['i', 't'])
  })
  it('swallows a key that breaks a pending sequence (no accidental archive)', () => {
    const k = m()
    k.feed('g', 0)
    expect(k.feed('e', 100)).toEqual({ kind: 'cancel' })
    expect(k.feed('e', 200)).toEqual({ kind: 'match', id: 'archive' })
  })
  it('times out a pending prefix', () => {
    const k = m()
    k.feed('g', 0)
    // After the timeout `i` is a fresh key, not the tail of `g i`.
    expect(k.feed('i', SEQUENCE_TIMEOUT_MS + 1)).toEqual({ kind: 'none' })
    k.feed('g', 5000)
    expect(k.feed('t', 5000 + SEQUENCE_TIMEOUT_MS - 1)).toEqual({ kind: 'match', id: 'go.sent' })
  })
  it('esc cancels a pending sequence', () => {
    const k = m()
    k.feed('g', 0)
    expect(k.feed('esc', 10)).toEqual({ kind: 'cancel' })
  })
})

describe('keycap formatting', () => {
  it('renders symbols', () => {
    expect(bindingToKeycaps('mod+shift+enter')).toEqual([['⌘', '⇧', '↵']])
    expect(bindingToKeycaps('g i')).toEqual([['G'], ['I']])
    expect(bindingToKeycaps('#')).toEqual([['#']])
    expect(bindingToKeycaps('shift+down')).toEqual([['⇧', '↓']])
    expect(bindingToKeycaps('mod+k', false)).toEqual([['Ctrl', 'K']])
  })
  it('renders searchable text', () => {
    expect(bindingToText('mod+k')).toBe('⌘K')
    expect(bindingToText('g a')).toBe('G then A')
  })
})

describe('isEditableElement', () => {
  const el = (tagName: string, extra: Record<string, unknown> = {}, attrs: Record<string, string> = {}) =>
    ({ tagName, ...extra, getAttribute: (n: string) => attrs[n] ?? null })
  it('detects typing targets', () => {
    expect(isEditableElement(el('INPUT'))).toBe(true)
    expect(isEditableElement(el('INPUT', {}, { type: 'search' }))).toBe(true)
    expect(isEditableElement(el('INPUT', {}, { type: 'checkbox' }))).toBe(false)
    expect(isEditableElement(el('TEXTAREA'))).toBe(true)
    expect(isEditableElement(el('DIV', { isContentEditable: true }))).toBe(true)
    expect(isEditableElement(el('DIV'))).toBe(false)
    expect(isEditableElement(null)).toBe(false)
  })
})
