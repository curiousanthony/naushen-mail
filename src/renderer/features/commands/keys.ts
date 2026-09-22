/**
 * Pure keyboard helpers: event -> canonical combo strings, binding parsing, the sequence
 * matcher (`g` then `i`) and keycap formatting. No DOM / store access so it is unit-testable.
 *
 * Canonical combo grammar: `[mod+][ctrl+][alt+][shift+]<key>`; a sequence is space separated
 * (`g i`). `mod` is Cmd on macOS and Ctrl elsewhere. `shift` is only recorded for letters and
 * named keys (`shift+e`, `shift+down`); for symbols it is implied by the character (`#`, `?`).
 */

export interface KeyLike {
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

const MOD_ORDER = ['mod', 'ctrl', 'alt', 'shift'] as const

const NAMED: Record<string, string> = {
  escape: 'esc', esc: 'esc', enter: 'enter', return: 'enter', arrowup: 'up', arrowdown: 'down', arrowleft: 'left',
  arrowright: 'right', ' ': 'space', spacebar: 'space', backspace: 'backspace', delete: 'delete', tab: 'tab',
  home: 'home', end: 'end', pageup: 'pageup', pagedown: 'pagedown', up: 'up', down: 'down', left: 'left', right: 'right', space: 'space'
}

export const isModifierKey = (key: string): boolean => ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn', 'AltGraph'].includes(key)

function normalizeKey(e: Pick<KeyLike, 'key' | 'code' | 'altKey'>): string {
  const named = NAMED[e.key.toLowerCase()]
  if (named && e.key.length > 1) return named
  if (e.key === ' ') return 'space'
  if (e.altKey && e.code) {
    // Option remaps characters on macOS (opt+1 -> ¡); recover the physical key.
    const m = /^Key([A-Z])$/.exec(e.code) ?? /^Digit(\d)$/.exec(e.code)
    if (m) return m[1].toLowerCase()
  }
  return e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase()
}

/** Turn a keyboard event into a canonical combo, or null for bare modifier presses. */
export function eventToCombo(e: KeyLike, isMac: boolean): string | null {
  if (isModifierKey(e.key)) return null
  const key = normalizeKey(e)
  const mods: string[] = []
  if (isMac ? e.metaKey : e.ctrlKey) mods.push('mod')
  if (isMac && e.ctrlKey) mods.push('ctrl')
  if (e.altKey) mods.push('alt')
  if (e.shiftKey && (key.length > 1 || /^[a-z]$/.test(key))) mods.push('shift')
  return [...mods, key].join('+')
}

/** Canonicalise a binding written by hand (`shift+E`, `cmd+k`, `G  I`). */
export function normalizeBinding(binding: string): string {
  return binding.trim().split(/\s+/).map(normalizeStep).join(' ')
}

function normalizeStep(step: string): string {
  // Split on "+" but keep a literal "+" key (e.g. `mod++`).
  const parts = step === '+' ? ['+'] : step.split(/\+(?=.)/)
  const key = parts[parts.length - 1]
  const mods = new Set<string>()
  for (const raw of parts.slice(0, -1)) {
    const m = raw.toLowerCase()
    if (m === 'cmd' || m === 'command' || m === 'meta' || m === 'mod') mods.add('mod')
    else if (m === 'control' || m === 'ctrl') mods.add('ctrl')
    else if (m === 'option' || m === 'opt' || m === 'alt') mods.add('alt')
    else if (m === 'shift') mods.add('shift')
  }
  const k = NAMED[key.toLowerCase()] ?? (key.length === 1 ? key.toLowerCase() : key.toLowerCase())
  return [...MOD_ORDER.filter((m) => mods.has(m)), k].join('+')
}

export const splitSequence = (binding: string): string[] => binding.trim().split(/\s+/).filter(Boolean)

// ------------------------------------------------------------------ sequence matcher

export interface BindingEntry { binding: string; id: string }

export type MatchResult =
  | { kind: 'match'; id: string }
  /** A valid prefix of at least one sequence; wait for more keys. */
  | { kind: 'pending'; prefix: string[] }
  /** The key broke a pending sequence. The key is swallowed (Gmail behaviour). */
  | { kind: 'cancel' }
  | { kind: 'none' }

export const SEQUENCE_TIMEOUT_MS = 1500

export class KeyMatcher {
  private exact = new Map<string, string>()
  private prefixes = new Set<string>()
  private pendingKeys: string[] = []
  private lastAt = 0

  constructor(entries: BindingEntry[], private timeoutMs = SEQUENCE_TIMEOUT_MS) {
    for (const { binding, id } of entries) {
      const steps = splitSequence(normalizeBinding(binding))
      this.exact.set(steps.join(' '), id)
      for (let i = 1; i < steps.length; i++) this.prefixes.add(steps.slice(0, i).join(' '))
    }
  }

  get pending(): string[] { return this.pendingKeys }

  reset(): void { this.pendingKeys = [] }

  /** Continuations of the current pending prefix (for the on-screen hint). */
  continuations(): { keys: string; id: string }[] {
    if (!this.pendingKeys.length) return []
    const p = this.pendingKeys.join(' ') + ' '
    const out: { keys: string; id: string }[] = []
    for (const [b, id] of this.exact) if (b.startsWith(p)) out.push({ keys: b.slice(p.length), id })
    return out
  }

  feed(combo: string, now: number): MatchResult {
    if (this.pendingKeys.length && now - this.lastAt > this.timeoutMs) this.pendingKeys = []
    const hadPending = this.pendingKeys.length > 0
    const seq = [...this.pendingKeys, combo].join(' ')
    const id = this.exact.get(seq)
    if (id !== undefined) { this.pendingKeys = []; return { kind: 'match', id } }
    if (this.prefixes.has(seq)) {
      this.pendingKeys = [...this.pendingKeys, combo]
      this.lastAt = now
      return { kind: 'pending', prefix: this.pendingKeys }
    }
    this.pendingKeys = []
    return hadPending ? { kind: 'cancel' } : { kind: 'none' }
  }
}

// ------------------------------------------------------------------ display

const SYMBOLS: Record<string, string> = {
  mod: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧', enter: '↵', up: '↑', down: '↓', left: '←', right: '→',
  backspace: '⌫', delete: '⌦', esc: 'esc', tab: '⇥', space: 'Space', home: 'Home', end: 'End', pageup: 'PgUp', pagedown: 'PgDn'
}

/** `mod+shift+enter` -> ['⌘', '⇧', '↵']. Non-mac shows Ctrl / Shift / Alt words. */
export function stepToKeycaps(step: string, isMac = true): string[] {
  const parts = normalizeStep(step).split(/\+(?=.)/)
  return parts.map((p) => {
    if (!isMac && (p === 'mod' || p === 'ctrl')) return 'Ctrl'
    if (!isMac && p === 'alt') return 'Alt'
    if (!isMac && p === 'shift') return 'Shift'
    return SYMBOLS[p] ?? (p.length === 1 ? p.toUpperCase() : p)
  })
}

/** A binding as steps of keycaps: `g i` -> [['G'], ['I']]. */
export const bindingToKeycaps = (binding: string, isMac = true): string[][] => splitSequence(binding).map((s) => stepToKeycaps(s, isMac))

/** Plain-text rendering used for filtering the shortcut sheet (`⌘K`, `G then I`). */
export const bindingToText = (binding: string, isMac = true): string =>
  bindingToKeycaps(binding, isMac).map((s) => s.join('')).join(' then ')

/** Focus targets where typing must never trigger single-key shortcuts. */
export function isEditableElement(el: { tagName?: string; isContentEditable?: boolean; getAttribute?(n: string): string | null } | null): boolean {
  if (!el) return false
  const tag = (el.tagName ?? '').toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const t = (el.getAttribute?.('type') ?? 'text').toLowerCase()
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(t)
  }
  if (el.isContentEditable) return true
  const ce = el.getAttribute?.('contenteditable')
  return ce === '' || ce === 'true' || ce === 'plaintext-only'
}
