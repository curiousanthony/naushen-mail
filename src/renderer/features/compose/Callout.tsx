/**
 * Callout block: an emoji cell plus a tinted panel of blocks. Serialises to a 1x1 table
 * (see docs/05-email-html-contract.md), which is the only layout every email client agrees
 * on. Attribute names must stay `emoji` / `background` — the serializer reads them.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { CALLOUT_EMOJI } from './slashItems'

export const CALLOUT_DEFAULT_BG = '#f7f6f3'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attrs?: { emoji?: string; background?: string }) => ReturnType
      toggleCallout: (attrs?: { emoji?: string; background?: string }) => ReturnType
    }
  }
}

function CalloutView({ node, updateAttributes, editor }: ReactNodeViewProps): JSX.Element {
  const { t } = useTranslation('compose')
  const [open, setOpen] = useState(false)
  const emoji = (node.attrs.emoji as string) || '💡'

  return (
    <NodeViewWrapper className="cmp-callout" data-callout="">
      <div className="cmp-callout__icon">
        <button
          type="button"
          className="cmp-callout__emoji"
          contentEditable={false}
          aria-label={t('callout.changeIcon')}
          disabled={!editor.isEditable}
          onMouseDown={(e) => { e.preventDefault(); setOpen((v) => !v) }}
        >
          {emoji}
        </button>
        {open && (
          <div className="cmp-callout__picker" contentEditable={false}>
            {CALLOUT_EMOJI.map((e) => (
              <button
                key={e}
                type="button"
                className="cmp-callout__pick"
                onMouseDown={(ev) => { ev.preventDefault(); updateAttributes({ emoji: e }); setOpen(false) }}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
      <NodeViewContent className="cmp-callout__body" />
    </NodeViewWrapper>
  )
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      emoji: {
        default: '💡',
        parseHTML: (el) => el.getAttribute('data-emoji') ?? '💡',
        renderHTML: (attrs) => ({ 'data-emoji': attrs.emoji as string })
      },
      background: {
        default: CALLOUT_DEFAULT_BG,
        parseHTML: (el) => el.getAttribute('data-background') ?? CALLOUT_DEFAULT_BG,
        renderHTML: (attrs) => ({ 'data-background': attrs.background as string })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '' }), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView)
  },

  addCommands() {
    return {
      setCallout: (attrs) => ({ commands }) => commands.wrapIn(this.name, attrs),
      toggleCallout: (attrs) => ({ commands }) => commands.toggleWrap(this.name, attrs)
    }
  },

  addKeyboardShortcuts() {
    return {
      // A second Enter on an empty trailing paragraph leaves the callout, like Notion.
      'Mod-Shift-9': () => this.editor.commands.toggleCallout()
    }
  }
})
