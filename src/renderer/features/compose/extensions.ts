/**
 * The editor schema.
 *
 * Every node and mark here must be one `src/shared/emailhtml/serialize.ts` knows how to
 * render — the serializer is the contract, this is the input side of it. StarterKit 3
 * already bundles Link, Underline, the list extensions and a plain CodeBlock, so those are
 * configured rather than re-registered (registering a duplicate name throws).
 */

import { Extension, wrappingInputRule } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Image } from '@tiptap/extension-image'
import { Placeholder } from '@tiptap/extension-placeholder'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { createLowlight, common } from 'lowlight'
import { Callout } from './Callout'

export const PLACEHOLDER = "Write, or press '/' for blocks"

/**
 * Notion types `"` for a quote; plain markdown uses `>`. StarterKit binds `>` already, so
 * this only adds the `"` alias (as its own extension, to avoid re-registering Blockquote).
 */
const QuoteInputRule = Extension.create({
  name: 'quoteInputRule',
  addInputRules() {
    const type = this.editor.schema.nodes.blockquote
    return type ? [wrappingInputRule({ find: /^\s*"\s$/, type })] : []
  }
})

export function buildExtensions(placeholder: string = PLACEHOLDER): ReturnType<typeof StarterKit.configure>[] {
  const lowlight = createLowlight(common)

  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      // Replaced by CodeBlockLowlight below.
      codeBlock: false,
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        protocols: ['http', 'https', 'mailto', 'tel'],
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' }
      },
      // Email has no undo history to share; the defaults are fine.
      trailingNode: false
    }),
    QuoteInputRule,
    TaskList,
    TaskItem.configure({ nested: true }),
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
    TableKit.configure({ table: { resizable: false, HTMLAttributes: { class: 'cmp-table' } } }),
    Image.configure({ allowBase64: true, inline: false, HTMLAttributes: { class: 'cmp-image' } }),
    // `textStyle.color` / `textStyle.backgroundColor` are exactly what the serializer reads.
    TextStyleKit.configure({ fontFamily: false, fontSize: false, lineHeight: false }),
    Details.configure({ persist: false, HTMLAttributes: { class: 'cmp-details' } }),
    DetailsSummary,
    DetailsContent,
    Callout,
    Placeholder.configure({
      placeholder: ({ node, editor }) => {
        if (node.type.name === 'detailsSummary') return 'Toggle'
        if (node.type.name === 'heading') return `Heading ${node.attrs.level as number}`
        // Only the very first empty paragraph carries the long prompt.
        const isFirst = editor.state.doc.firstChild === node
        return isFirst ? placeholder : "Write, or press '/'"
      },
      showOnlyWhenEditable: true,
      includeChildren: true
    })
  ] as ReturnType<typeof StarterKit.configure>[]
}
