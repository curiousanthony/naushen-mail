import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ThreadWithMessages } from '@shared/types'
import { useApp } from '@/lib/store'
import { ThreadHeader } from './ThreadHeader'
import { MessageCard } from './MessageCard'
import { ReplyBar } from './ReplyBar'
import { PEEK_DEFAULT, clampPeekWidth, loadPeekWidth, savePeekWidth } from './peek'
import './reader.css'

export { ReplyBar } from './ReplyBar'
export type { ReplyMode } from './ReplyBar'

/**
 * The thread view.
 *
 * Presented as a side peek (default), a centre peek or a full page, per
 * `settings.threadStyle`. Mounted always; renders nothing until `openThreadId` is set.
 */
export function Reader(): JSX.Element | null {
  const openThreadId = useApp((s) => s.openThreadId)
  const openThread = useApp((s) => s.openThread)
  const settings = useApp((s) => s.settings)
  const labels = useApp((s) => s.labels)
  const overlay = useApp((s) => s.overlay)
  const composers = useApp((s) => s.composers)

  const [thread, setThread] = useState<ThreadWithMessages | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [reloadKey, setReloadKey] = useState(0)

  const style = settings.threadStyle ?? 'side'
  const rootRef = useRef<HTMLDivElement>(null)
  const markedRead = useRef<Set<string>>(new Set())
  const expandedFor = useRef<string | null>(null)

  const hasInlineComposer = composers.some(
    (c) => c.placement === 'inline' && c.threadId === openThreadId
  )

  // -------------------------------------------------------------- data

  useEffect(() => {
    if (!openThreadId) { setThread(null); return }
    let alive = true
    setLoading(true)
    void window.api.invoke('threads.get', openThreadId).then((t) => {
      if (!alive) return
      setThread(t)
      setLoading(false)
    })
    return () => { alive = false }
  }, [openThreadId, reloadKey])

  // Sync pushed a change: refetch the open thread (coalesced — bursts are normal).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = window.api.onEvent(() => {
      if (timer) return
      timer = setTimeout(() => { timer = null; setReloadKey((k) => k + 1) }, 180)
    })
    return () => { off(); if (timer) clearTimeout(timer) }
  }, [])

  // Expand the last message (and anything unread) — once per thread, not per refetch.
  useEffect(() => {
    if (!thread) { expandedFor.current = null; return }
    if (expandedFor.current === thread.id) return
    expandedFor.current = thread.id
    const last = thread.messages[thread.messages.length - 1]
    const next = new Set(thread.messages.filter((m) => m.unread).map((m) => m.id))
    if (last) next.add(last.id)
    setExpanded(next)
  }, [thread])

  // Mark read on open. Once per thread id, and only when there is something to mark.
  useEffect(() => {
    if (!thread || !settings.markReadOnOpen) return
    if (!thread.unread || markedRead.current.has(thread.id)) return
    markedRead.current.add(thread.id)
    void window.api.invoke('threads.act', [thread.id], { type: 'markRead' })
  }, [thread, settings.markReadOnOpen])

  const close = useCallback(() => { openThread(null) }, [openThread])

  // -------------------------------------------------------------- keyboard
  //
  // Escape-closes-thread and r/a/f-to-reply are handled once, globally, by
  // commands/runner.ts ('nav.back' and 'msg.reply'/'msg.replyAll'/'msg.forward') — a second,
  // reader-local listener for the same keys used to double-fire on every keypress (two
  // window-level 'keydown' listeners both run for one event), opening two reply composers
  // from a single 'r'. `hasInlineComposer` below still guards the *button* row.

  const lastMessageId = thread?.messages[thread.messages.length - 1]?.id

  // -------------------------------------------------------------- side-peek width

  const [width, setWidth] = useState(PEEK_DEFAULT)
  const [dragging, setDragging] = useState(false)
  const hostWidth = useRef(0)
  const drag = useRef({ x: 0, w: 0 })

  // Measure the area the peek sits in, and keep the width inside it as the window resizes.
  useLayoutEffect(() => {
    if (style !== 'side' || !openThreadId) return
    const host = rootRef.current?.parentElement
    if (!host) return
    const apply = (): void => {
      hostWidth.current = host.clientWidth
      setWidth((w) => clampPeekWidth(w, host.clientWidth))
    }
    hostWidth.current = host.clientWidth
    setWidth(loadPeekWidth(host.clientWidth))
    const ro = new ResizeObserver(apply)
    ro.observe(host)
    return () => ro.disconnect()
  }, [style, openThreadId])

  const onResizeStart = (e: React.PointerEvent<HTMLButtonElement>): void => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, w: width }
    setDragging(true)
  }

  const onResizeMove = (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (!dragging) return
    // The handle is on the left edge: dragging left widens the peek.
    setWidth(clampPeekWidth(drag.current.w + (drag.current.x - e.clientX), hostWidth.current))
  }

  const onResizeEnd = (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (!dragging) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    setDragging(false)
    savePeekWidth(width)
  }

  const onResizeKey = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    const step = e.shiftKey ? 48 : 16
    let next: number | null = null
    if (e.key === 'ArrowLeft') next = width + step
    else if (e.key === 'ArrowRight') next = width - step
    else if (e.key === 'Home') next = PEEK_DEFAULT
    if (next === null) return
    e.preventDefault()
    const clamped = clampPeekWidth(next, hostWidth.current)
    setWidth(clamped)
    savePeekWidth(clamped)
  }

  const resetWidth = (): void => {
    const next = clampPeekWidth(PEEK_DEFAULT, hostWidth.current)
    setWidth(next)
    savePeekWidth(next)
  }

  // -------------------------------------------------------------- render

  if (!openThreadId) return null

  const toggle = (id: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const body = (
    <>
      {thread && <ThreadHeader thread={thread} labels={labels} onClose={close} />}

      <div className="reader__scroll">
        {loading && !thread ? (
          <div className="reader__skeleton" aria-busy="true" aria-label="Loading conversation">
            <div className="reader__skeleton-line" />
            <div className="reader__skeleton-line" />
            <div className="reader__skeleton-line" />
            <div className="reader__skeleton-line" />
          </div>
        ) : !thread ? (
          <div className="reader__state">
            <span className="reader__state-title">This conversation is no longer available.</span>
            <span>It may have been deleted or moved.</span>
          </div>
        ) : (
          <div className="reader__inner">
            {thread.messages.map((m) => (
              <MessageCard
                key={m.id}
                message={m}
                expanded={expanded.has(m.id)}
                onToggle={() => toggle(m.id)}
                blockRemoteImages={settings.blockRemoteImages}
              />
            ))}

            {lastMessageId && (
              <ReplyBar threadId={thread.id} messageId={lastMessageId} hidden={hasInlineComposer} />
            )}
            {/* The compose feature mounts the inline composer here. */}
            <div id="reader-inline-compose-slot" />
          </div>
        )}
      </div>
    </>
  )

  if (style === 'center') {
    return (
      <div className="reader__backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
        <div className="reader reader--centre" role="dialog" aria-modal="true" aria-label={thread?.subject || 'Conversation'} ref={rootRef}>
          {body}
        </div>
      </div>
    )
  }

  if (style === 'full') {
    return (
      <div className="reader reader--full" role="region" aria-label={thread?.subject || 'Conversation'} ref={rootRef}>
        {body}
      </div>
    )
  }

  return (
    <div
      className="reader reader--side"
      role="region"
      aria-label={thread?.subject || 'Conversation'}
      style={{ width }}
      ref={rootRef}
    >
      <button
        className={`reader__resizer no-drag${dragging ? ' is-dragging' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize conversation panel"
        aria-valuenow={Math.round(width)}
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        onDoubleClick={resetWidth}
        onKeyDown={onResizeKey}
      />
      {body}
    </div>
  )
}
