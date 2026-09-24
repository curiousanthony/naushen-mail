/**
 * The block editor surface: TipTap content plus the `/` menu, the `:` emoji menu and the
 * floating selection toolbar.
 *
 * The menus are driven from React state rather than `@tiptap/suggestion` so that the
 * trigger rules stay pure and testable (`trigger.ts`) and so Escape/arrow handling is in
 * one place — a capture-phase listener that runs before ProseMirror sees the key.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { gitHubEmojis } from '@tiptap/extension-emoji'
import { buildExtensions } from './extensions'
import { SlashMenu, type MenuAnchor } from './SlashMenu'
import { SelectionToolbar } from './SelectionToolbar'
import { detectEmojiTrigger, detectSlashTrigger, detectSnippetTrigger, searchEmoji, type EmojiEntry } from './trigger'
import { cleanPastedHtml } from '@shared/emailhtml'
import { LinkPopover, type LinkAnchor } from './LinkPopover'
import type { SnippetContext } from './snippetVars'
import { BLOCK_SHORTCUTS } from './slashItems'
import { applyBlockAction } from './SlashMenu'
import { fileToDataUri, isImageType } from './attachments'
import type { Snippet } from './snippets'

const EMOJI_LIST: EmojiEntry[] = (gitHubEmojis as unknown as EmojiEntry[]).filter((e) => !!e.emoji)

export interface ComposerEditorOptions {
  /** Initial TipTap JSON (restored draft) or HTML string. */
  content?: unknown
  onUpdate?: (editor: Editor) => void
  editable?: boolean
  /** Smart quotes / dashes / ellipsis on? Read per keystroke so the setting applies live. */
  smartTypography?: () => boolean
}

export function useComposerEditor({ content, onUpdate, editable = true, smartTypography }: ComposerEditorOptions): Editor | null {
  const smartRef = useRef(smartTypography)
  smartRef.current = smartTypography
  const extensions = useMemo(() => buildExtensions(undefined, { smartTypography: () => smartRef.current?.() ?? true }), [])
  return useEditor({
    extensions,
    content: (content as never) ?? '',
    editable,
    autofocus: false,
    // Electron renders the editor immediately; no SSR hydration concerns.
    immediatelyRender: true,
    editorProps: {
      attributes: { class: 'cmp-prose', spellcheck: 'true' },
      // Word / Docs / web copies: strip colours, junk wrappers and fake lists. ProseMirror's own
      // slices (`data-pm-slice`) keep everything — callouts, colours and image sizes round-trip.
      transformPastedHTML: (html) => (html.includes('data-pm-slice') ? html : cleanPastedHtml(html)),
      handlePaste: (view, event) => {
        const cd = event.clipboardData
        const files = Array.from(cd?.files ?? []).filter((f) => isImageType(f.type))
        if (!files.length) return false
        // Word, Excel and Pages put a rendered bitmap in `files` *next to* the real HTML/text;
        // only a bare image (screenshot, "Copy image") should become an inline picture.
        if (cd?.getData('text/plain').trim()) return false
        event.preventDefault()
        void insertImageFiles(view, files)
        return true
      },
      handleDrop: (view, event) => {
        const dt = (event as DragEvent).dataTransfer
        const files = Array.from(dt?.files ?? []).filter((f) => isImageType(f.type))
        if (!files.length) return false
        event.preventDefault()
        void insertImageFiles(view, files)
        return true
      }
    },
    onUpdate: ({ editor }) => onUpdate?.(editor)
  })
}

type PMView = Parameters<NonNullable<NonNullable<Parameters<typeof useEditor>[0]>['editorProps']>['handlePaste'] & object>[0]

/** Images live in the document as `data:` URIs; the serializer turns them into `cid:` parts. */
async function insertImageFiles(view: PMView, files: File[]): Promise<void> {
  for (const file of files) {
    const src = await fileToDataUri(file)
    const node = view.state.schema.nodes.image?.create({ src, alt: file.name, title: file.name })
    if (node) view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView())
  }
}

interface SurfaceProps {
  editor: Editor
  snippets: Snippet[]
  /** Called when the user picks "Image" so the composer can open its file picker. */
  onRequestImage: () => void
  /** Recipient / sender facts for `{{first_name}}` & co, read at insert time. */
  snippetContext?: () => SnippetContext
}

interface TriggerState {
  kind: 'slash' | 'emoji' | 'snippet'
  query: string
  /** Document position of the trigger character. */
  from: number
  anchor: MenuAnchor
}

export function EditorSurface({ editor, snippets, onRequestImage, snippetContext }: SurfaceProps): JSX.Element {
  const [trigger, setTrigger] = useState<TriggerState | null>(null)
  const [selRect, setSelRect] = useState<SelectionToolbarRect | null>(null)
  const [emojiActive, setEmojiActive] = useState(0)
  const [linkPop, setLinkPop] = useState<LinkAnchor | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const snippetsRef = useRef(snippets)
  snippetsRef.current = snippets

  const emojiMatches = useMemo(
    () => (trigger?.kind === 'emoji' ? searchEmoji(EMOJI_LIST, trigger.query) : []),
    [trigger]
  )

  /** Re-evaluate the trigger and the selection after every transaction. */
  const sync = useCallback(() => {
    const { state, view } = editor
    const { from, empty } = state.selection

    // Selection toolbar: only for a real text selection outside code.
    if (!empty && !editor.isActive('codeBlock')) {
      const start = view.coordsAtPos(state.selection.from)
      const end = view.coordsAtPos(state.selection.to)
      const left = Math.min(start.left, end.left)
      setSelRect({ left, top: start.top, bottom: end.bottom, width: Math.max(0, Math.max(start.left, end.left) - left) })
    } else {
      setSelRect(null)
    }

    if (!empty || editor.isActive('codeBlock')) { setTrigger(null); return }

    const textBefore = state.doc.textBetween(Math.max(0, from - 80), from, '\n', '\n')
    const slash = detectSlashTrigger(textBefore)
    const emoji = slash ? null : detectEmojiTrigger(textBefore)
    // `;sig` only opens when a snippet actually has that shortcut, so plain prose never triggers.
    const snip = slash || emoji ? null : detectSnippetTrigger(textBefore)
    const snipOk = snip && snippetsRef.current.some((s) => s.shortcut?.toLowerCase().startsWith(snip.query.toLowerCase()))
    const match = slash ?? emoji ?? (snipOk ? snip : null)
    if (!match) { setTrigger(null); return }

    const triggerPos = from - match.from
    const coords = view.coordsAtPos(triggerPos)
    setTrigger({
      kind: slash ? 'slash' : emoji ? 'emoji' : 'snippet',
      query: match.query,
      from: triggerPos,
      anchor: { x: coords.left, y: coords.top, bottom: coords.bottom }
    })
    setEmojiActive(0)
  }, [editor])

  useEffect(() => {
    editor.on('transaction', sync)
    editor.on('selectionUpdate', sync)
    return () => { editor.off('transaction', sync); editor.off('selectionUpdate', sync) }
  }, [editor, sync])

  /** Delete the `/query` (or `:query`) text before inserting a block. */
  const consumeTrigger = useCallback(() => {
    if (!trigger) return
    editor.chain().focus().deleteRange({ from: trigger.from, to: editor.state.selection.from }).run()
  }, [editor, trigger])

  const insertEmoji = useCallback((entry: EmojiEntry) => {
    if (!trigger) return
    editor.chain().focus()
      .deleteRange({ from: trigger.from, to: editor.state.selection.from })
      .insertContent(entry.emoji)
      .run()
    setTrigger(null)
  }, [editor, trigger])

  // Emoji menu keys (the slash menu binds its own listener while it is open).
  useEffect(() => {
    if (trigger?.kind !== 'emoji' || !emojiMatches.length) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setEmojiActive((i) => (i + 1) % emojiMatches.length) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setEmojiActive((i) => (i - 1 + emojiMatches.length) % emojiMatches.length) }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); insertEmoji(emojiMatches[emojiActive]) }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setTrigger(null) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [trigger, emojiMatches, emojiActive, insertEmoji])

  /** Open the link popover at the selection (or, on a link, over the whole link). */
  const openLinkPopover = useCallback(() => {
    const { view, state } = editor
    if (state.selection.empty && editor.isActive('link')) editor.commands.extendMarkRange('link')
    const { from, to } = editor.state.selection
    const a = view.coordsAtPos(from)
    const b = view.coordsAtPos(to)
    setLinkPop({ left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) })
  }, [editor])

  // Typing, moving away or clicking elsewhere in the document leaves nothing stale on screen.
  const closeLinkPopover = useCallback(() => setLinkPop(null), [])

  /** Block shortcuts (cmd+alt+0-7), the link popover (cmd+shift+L / cmd+K) and `;` snippet expansion. */
  const onKeyDownCapture = (e: React.KeyboardEvent): void => {
    if (!(e.metaKey || e.ctrlKey)) return
    if (e.altKey && BLOCK_SHORTCUTS[e.key]) {
      e.preventDefault()
      applyBlockAction(editor, BLOCK_SHORTCUTS[e.key], { snippets, onRequestImage, onRequestLink: openLinkPopover, snippetContext })
      return
    }
    const k = e.key.toLowerCase()
    if ((k === 'k' && !e.shiftKey) || (k === 'l' && e.shiftKey && !e.altKey)) {
      e.preventDefault()
      e.stopPropagation()
      openLinkPopover()
    }
  }

  /** Cmd-click follows a link; a plain click on one opens its popover (edit / open / remove). */
  const onClick = (e: React.MouseEvent): void => {
    const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null
    if (!a || !wrapRef.current?.contains(a)) return
    if (e.metaKey || e.ctrlKey) { e.preventDefault(); void window.api.invoke('app.openExternal', a.getAttribute('href') ?? ''); return }
    requestAnimationFrame(() => {
      if (!editor.isActive('link')) return
      const r = a.getBoundingClientRect()
      editor.commands.extendMarkRange('link')
      setLinkPop({ left: r.left, top: r.top, bottom: r.bottom })
    })
  }

  return (
    <div className="cmp-editor" ref={wrapRef} onKeyDownCapture={onKeyDownCapture} onClick={onClick}>
      <EditorContent editor={editor} />

      {(trigger?.kind === 'slash' || trigger?.kind === 'snippet') && (
        <SlashMenu
          mode={trigger.kind === 'snippet' ? 'snippet' : 'slash'}
          snippetContext={snippetContext}
          editor={editor}
          query={trigger.query}
          anchor={trigger.anchor}
          snippets={snippets}
          onClose={() => setTrigger(null)}
          onConsume={consumeTrigger}
          onRequestImage={onRequestImage}
          onRequestLink={openLinkPopover}
        />
      )}

      {trigger?.kind === 'emoji' && emojiMatches.length > 0 && (
        <div className="cmp-menu cmp-menu--emoji" style={{ left: trigger.anchor.x, top: trigger.anchor.bottom + 6 }} role="listbox">
          {emojiMatches.map((e, i) => (
            <button
              key={e.name}
              type="button"
              className={`cmp-menu__row cmp-menu__row--emoji${i === emojiActive ? ' is-active' : ''}`}
              onMouseEnter={() => setEmojiActive(i)}
              onMouseDown={(ev) => { ev.preventDefault(); insertEmoji(e) }}
            >
              <span className="cmp-menu__emoji">{e.emoji}</span>
              <span className="cmp-menu__title">:{e.name}:</span>
            </button>
          ))}
        </div>
      )}

      {selRect && !trigger && !linkPop && (
        <SelectionToolbar editor={editor} rect={selRect} onRequestImage={onRequestImage} />
      )}

      {linkPop && <LinkPopover editor={editor} anchor={linkPop} onClose={closeLinkPopover} />}
    </div>
  )
}

interface SelectionToolbarRect { left: number; top: number; bottom: number; width: number }
