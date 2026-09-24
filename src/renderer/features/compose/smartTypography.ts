/**
 * Smart punctuation as markdown-style input rules: `...` -> …, `--` -> —, straight quotes
 * -> curly. Being input rules, Backspace right after the substitution undoes it (TipTap's
 * `undoInputRule`), which is the whole "toggle": nothing to configure per message. A global
 * on/off lives in settings (`smartTypography`) for people who never want it.
 *
 * A `"` at the very start of a block is left alone: `" ` there is the Notion blockquote
 * shortcut (see `MarkdownAliases`). The pair is curled when the closing quote arrives.
 */

import { Extension, InputRule } from '@tiptap/core'

const OPENING_CONTEXT = /[\s([{<—–“‘«]$/

/**
 * The curly quote for a typed `"` / `'`, given the character before it. `null` = leave it
 * straight (block-start double quote).
 */
export function smartQuote(typed: '"' | "'", prev: string, atBlockStart: boolean): string | null {
  const opening = atBlockStart || !prev || OPENING_CONTEXT.test(prev)
  if (typed === '"') {
    if (atBlockStart) return null
    return opening ? '“' : '”'
  }
  return opening ? '‘' : '’'
}

export interface SmartTypographyOptions {
  /** Read on every keystroke, so the setting can flip without rebuilding the editor. */
  enabled: () => boolean
}

export const SmartTypography = Extension.create<SmartTypographyOptions>({
  name: 'smartTypography',

  addOptions() {
    return { enabled: () => true }
  },

  addInputRules() {
    const editor = this.editor
    const active = (): boolean =>
      this.options.enabled() && !editor.isActive('code') && !editor.isActive('codeBlock')

    const replace = (find: RegExp, out: string): InputRule =>
      new InputRule({
        find,
        handler: ({ state, range }) => {
          if (!active()) return null
          state.tr.insertText(out, range.from, range.to)
          return undefined
        }
      })

    const quote = (typed: '"' | "'"): InputRule =>
      new InputRule({
        find: typed === '"' ? /"$/ : /'$/,
        handler: ({ state, range }) => {
          if (!active()) return null
          const $from = state.doc.resolve(range.from)
          const atStart = $from.parentOffset === 0
          const prev = atStart ? '' : state.doc.textBetween(Math.max(0, range.from - 1), range.from)
          const out = smartQuote(typed, prev, atStart)
          if (!out) return null
          state.tr.insertText(out, range.from, range.to)
          // Closing a pair that opened with a straight quote at the block start: curl that one too.
          if (typed === '"' && out === '”') {
            const start = $from.start()
            const before = state.doc.textBetween(start, range.from)
            if (before.startsWith('"') && !/["“”]/.test(before.slice(1))) {
              state.tr.insertText('“', start, start + 1)
            }
          }
          return undefined
        }
      })

    return [replace(/\.\.\.$/, '…'), replace(/--$/, '—'), quote('"'), quote("'")]
  }
})
