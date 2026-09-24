/**
 * Inserting a snippet into the editor: expand variables from the current recipients, drop
 * the content at the caret, then move the caret to `{{cursor}}` if the snippet had one.
 */

import type { Editor } from '@tiptap/react'
import { CURSOR_MARK, containsCursor, expandDoc, type SnippetContext } from './snippetVars'
import type { Snippet } from './snippets'

export function insertSnippet(editor: Editor, snippet: Pick<Snippet, 'doc'>, ctx: SnippetContext): void {
  const expanded = expandDoc(snippet.doc, ctx)
  const content = (expanded.content ?? expanded) as never
  const from = editor.state.selection.from
  editor.chain().focus().insertContent(content).run()
  if (!containsCursor(expanded)) return

  // Find the sentinel we just inserted (first occurrence at/after the insertion point),
  // delete it and put the caret there. Done in one transaction so undo is a single step.
  const { state } = editor
  let at = -1
  state.doc.descendants((node, pos) => {
    if (at >= 0 || !node.isText || pos + node.nodeSize < from) return
    const i = node.text?.indexOf(CURSOR_MARK) ?? -1
    if (i >= 0) at = pos + i
  })
  if (at < 0) return
  editor.chain().focus().deleteRange({ from: at, to: at + 1 }).setTextSelection(at).run()
}
