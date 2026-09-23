/**
 * The editor schema.
 *
 * Every node and mark here must be one `src/shared/emailhtml/serialize.ts` knows how to
 * render — the serializer is the contract, this is the input side of it. StarterKit 3
 * already bundles Link, Underline, the list extensions and a plain CodeBlock, so those are
 * configured rather than re-registered (registering a duplicate name throws).
 */

import { Extension, markInputRule, markPasteRule, wrappingInputRule } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extension-placeholder'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { createLowlight, common } from 'lowlight'
import { Callout } from './Callout'
import { ImageBlock } from './ImageBlock'

export const PLACEHOLDER = "Write, or press '/' for blocks"

/** Single-tilde strike, per the spec (`~s~`). StarterKit only binds `~~double~~`. */
const singleStrikeInput = /(?:^|\s)(~(?!\s|~)([^~]+)~)$/
const singleStrikePaste = /(?:^|\s)(~(?!\s|~)([^~]+)~)/g

/**
 * Markdown aliases the bundled extensions do not bind: Notion's `"` for a quote (plain
 * markdown `>` is already handled by StarterKit's Blockquote) and single-tilde strike.
 * Their own extension, so Blockquote and Strike are not re-registered.
 */
const MarkdownAliases = Extension.create({
  name: 'markdownAliases',
  addInputRules() {
    const quote = this.editor.schema.nodes.blockquote
    const strike = this.editor.schema.marks.strike
    return [
      ...(quote ? [wrappingInputRule({ find: /^\s*"\s$/, type: quote })] : []),
      ...(strike ? [markInputRule({ find: singleStrikeInput, type: strike })] : [])
    ]
  },
  addPasteRules() {
    const strike = this.editor.schema.marks.strike
    return strike ? [markPasteRule({ find: singleStrikePaste, type: strike })] : []
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
    MarkdownAliases,
    TaskList,
    TaskItem.configure({ nested: true }),
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
    TableKit.configure({ table: { resizable: false, HTMLAttributes: { class: 'cmp-table' } } }),
    ImageBlock.configure({ allowBase64: true, inline: false, HTMLAttributes: { class: 'cmp-image' } }),
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
