/**
 * Image node with Notion-style resize handles (drag the left/right edge) and an align
 * toolbar (left/center/right) that appears on hover, like Notion's own image block.
 *
 * `width` (already declared by the stock `@tiptap/extension-image` node) and `align` (added
 * here) are read straight out of the TipTap JSON by `renderImage()` in
 * `src/shared/emailhtml/serialize.ts` — keep the attribute names in sync with that file.
 * They round-trip through a saved draft for free: TipTap's own JSON serialisation includes
 * every declared node attribute, and `Composer.tsx`'s draft restore calls
 * `editor.commands.setContent(d.doc)` with that JSON directly.
 */

import { useCallback, useRef, useState } from 'react'
import { Image as TiptapImage } from '@tiptap/extension-image'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react'
import { Tooltip } from '@/features/tooltip'
import { IMAGE_MIN_WIDTH, resizedWidth, type ImageResizeSide } from './imageResize'

export type ImageAlign = 'left' | 'center' | 'right'

const ALIGN_OPTIONS: { value: ImageAlign; label: string; Icon: typeof AlignLeft }[] = [
  { value: 'left', label: 'Align left', Icon: AlignLeft },
  { value: 'center', label: 'Align center', Icon: AlignCenter },
  { value: 'right', label: 'Align right', Icon: AlignRight }
]

function readAlign(v: unknown): ImageAlign {
  return v === 'center' || v === 'right' ? v : 'left'
}

interface DragState {
  side: ImageResizeSide
  startX: number
  startWidth: number
  maxWidth: number
  pointerId: number
}

function ImageView({ node, updateAttributes, selected, editor }: ReactNodeViewProps): JSX.Element {
  const [hovered, setHovered] = useState(false)
  // Only committed to the doc (via `updateAttributes`) on pointer-up — every ProseMirror
  // transaction re-triggers the composer's autosave, so committing on every `pointermove`
  // would hammer SQLite with a base64 image on each frame. The live value drives the visual
  // resize; `dragRef` carries the numbers the move handler needs without closing over stale
  // state.
  const [liveWidth, setLiveWidth] = useState<number | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<DragState | null>(null)

  const src = typeof node.attrs.src === 'string' ? node.attrs.src : ''
  const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : ''
  const title = typeof node.attrs.title === 'string' ? node.attrs.title : undefined
  const align = readAlign(node.attrs.align)
  const savedWidth = typeof node.attrs.width === 'number' && node.attrs.width > 0 ? node.attrs.width : null
  const width = liveWidth ?? savedWidth
  const dragging = liveWidth != null
  const editable = editor.isEditable
  const showControls = editable && (hovered || selected || dragging)

  const beginDrag = useCallback((side: ImageResizeSide) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!editable) return
    e.preventDefault()
    e.stopPropagation()
    const img = imgRef.current
    if (!img) return
    const startWidth = savedWidth ?? img.getBoundingClientRect().width
    // The image can never be resized wider than the editor's content column can show.
    const contentEl = frameRef.current?.closest<HTMLElement>('.cmp-prose')
    const maxWidth = contentEl ? contentEl.clientWidth : startWidth
    dragRef.current = { side, startX: e.clientX, startWidth, maxWidth, pointerId: e.pointerId }
    setLiveWidth(startWidth)
    // Redirects every later pointer event to this handle regardless of where the cursor
    // ends up, so a fast drag off the (small) handle never loses tracking. Synthetic pointer
    // events (e.g. a test harness) can fail to capture — that's fine, the harness dispatches
    // move/up directly at the handle anyway.
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not capturable, ignore */ }
  }, [editable, savedWidth])

  const onDragMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || e.pointerId !== drag.pointerId) return
    e.preventDefault()
    setLiveWidth(resizedWidth({
      startWidth: drag.startWidth,
      deltaX: e.clientX - drag.startX,
      side: drag.side,
      maxWidth: drag.maxWidth,
      minWidth: IMAGE_MIN_WIDTH
    }))
  }, [])

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || e.pointerId !== drag.pointerId) return
    dragRef.current = null
    setLiveWidth((w) => {
      if (w != null) updateAttributes({ width: w })
      return null
    })
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
  }, [updateAttributes])

  const setAlign = useCallback((value: ImageAlign) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    updateAttributes({ align: value })
  }, [updateAttributes])

  // The stock Image node is `draggable: true` (so the block itself can be dragged around the
  // doc); a mousedown-then-move starting on a descendant with no `draggable` of its own still
  // walks up to that ancestor and hijacks the gesture as a native HTML5 drag unless stopped.
  const noNativeDrag = (e: React.DragEvent): void => e.preventDefault()

  return (
    <NodeViewWrapper className="cmp-image-node" style={{ textAlign: align }}>
      <div
        className="cmp-image-node__frame"
        ref={frameRef}
        style={width ? { width: `${width}px` } : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          title={title}
          draggable={false}
          style={width ? { width: `${width}px` } : undefined}
        />

        {showControls && (
          <>
            <div
              className="cmp-image-handle cmp-image-handle--left"
              contentEditable={false}
              onDragStart={noNativeDrag}
              onPointerDown={beginDrag('left')}
              onPointerMove={onDragMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            />
            <div
              className="cmp-image-handle cmp-image-handle--right"
              contentEditable={false}
              onDragStart={noNativeDrag}
              onPointerDown={beginDrag('right')}
              onPointerMove={onDragMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            />
            <div className="cmp-image-align" contentEditable={false} onDragStart={noNativeDrag}>
              {ALIGN_OPTIONS.map(({ value, label, Icon }) => (
                <Tooltip key={value} label={label}>
                  <button
                    type="button"
                    className={`cmp-image-align__btn${align === value ? ' is-active' : ''}`}
                    aria-label={label}
                    aria-pressed={align === value}
                    onMouseDown={setAlign(value)}
                  >
                    <Icon size={14} />
                  </button>
                </Tooltip>
              ))}
            </div>
          </>
        )}
      </div>
    </NodeViewWrapper>
  )
}

/**
 * Extends the stock image node rather than replacing it, so `width`/`height` (already
 * declared upstream, default `null`) and every other option keep working unchanged — only
 * `align` and the NodeView are new.
 */
export const ImageBlock = TiptapImage.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: 'left',
        parseHTML: (el: HTMLElement) => readAlign(el.getAttribute('data-align')),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.align && attrs.align !== 'left' ? { 'data-align': attrs.align as string } : {}
      }
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  }
})
