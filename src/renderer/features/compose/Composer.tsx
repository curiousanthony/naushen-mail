/**
 * One composer: header, From/To/Cc/Bcc, subject, block editor, bottom toolbar.
 *
 * Placement (floating window vs inline in the reader) is decided by `ComposeHost`; this
 * component is the same either way.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Braces, ChevronDown, ChevronUp, HelpCircle, Maximize2, Minimize2, Minus,
  Paperclip, Send, Trash2, X
} from 'lucide-react'
import type { Address, Draft, Message, OutgoingMessage, ScheduledSend } from '@shared/types'
import type { QuotedOriginal } from '@shared/emailhtml'
import { buildQuoted, forwardHeaderHtml, forwardSubject, replyRecipients, replySubject } from '@shared/emailhtml'
import { sanitizeFragment } from '@shared/sanitize'
import { useApp, type ComposerState } from '@/lib/store'
import { editorRegistry } from './registry'
import { EditorSurface, useComposerEditor } from './Editor'
import { RecipientField, type RecipientFieldHandle } from './RecipientField'
import { dedupeAddresses, validateCompose } from './recipients'
import { buildOutgoing, planSend } from './send'
import {
  fileToAttachment, formatBytes, isImageType, isOverSizeLimit, partitionFiles,
  totalBytes, type PendingAttachment
} from './attachments'
import { fromLocalInputValue, scheduleOptions, scheduledToast, toLocalInputValue } from './schedule'
import { loadSnippets, upsertSnippet, type Snippet } from './snippets'
import './compose.css'

interface Props {
  composer: ComposerState
  /** Floating-window chrome is hidden for the inline placement. */
  inline?: boolean
  /** Distance from the right edge, in px. `ComposeHost` lays the row out so that a
   *  minimised bar and an open window never overlap (or, when they don't all fit, cascade
   *  deliberately rather than clip — see `layout.ts`). */
  offsetRight: number
  /** Window width in px, computed by `layout.ts` from the viewport and how many composers
   *  are open. Ignored for the inline placement, which fills its slot. */
  width?: number
  /** Paint order: later composers sit on top. */
  stack: number
  minimised: boolean
  onMinimise: (value: boolean) => void
}

const AUTOSAVE_MS = 2000

export function Composer({ composer, inline = false, offsetRight, width, stack, minimised, onMinimise }: Props): JSX.Element {
  // Atomic selectors: a selector returning a fresh object re-renders forever under zustand v5.
  const accounts = useApp((s) => s.accounts)
  const settings = useApp((s) => s.settings)
  const closeComposer = useApp((s) => s.closeComposer)
  const toast = useApp((s) => s.toast)
  const act = useApp((s) => s.act)

  const [accountId, setAccountId] = useState(composer.accountId || accounts[0]?.id || '')
  const [to, setTo] = useState<Address[]>(composer.init?.to ?? [])
  const [cc, setCc] = useState<Address[]>(composer.init?.cc ?? [])
  const [bcc, setBcc] = useState<Address[]>(composer.init?.bcc ?? [])
  const [subject, setSubject] = useState(composer.init?.subject ?? '')
  const [showCc, setShowCc] = useState((composer.init?.cc ?? []).length > 0)
  const [showBcc, setShowBcc] = useState((composer.init?.bcc ?? []).length > 0)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [quoted, setQuoted] = useState<QuotedOriginal | null>(null)
  const [quoteOpen, setQuoteOpen] = useState(false)
  const [signatureOn, setSignatureOn] = useState(true)
  const [maximised, setMaximised] = useState(false)
  const [menu, setMenu] = useState<null | 'schedule' | 'snippets' | 'help' | 'account'>(null)
  const [customTime, setCustomTime] = useState('')
  const [snippets, setSnippets] = useState<Snippet[]>(() => loadSnippets())
  /** Non-null while naming a new snippet (Electron has no window.prompt). */
  const [newSnippet, setNewSnippet] = useState<string | null>(null)
  const [problems, setProblems] = useState<{ errors: string[]; warnings: string[] } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [sending, setSending] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const fileInput = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const subjectRef = useRef<HTMLInputElement>(null)
  const toRef = useRef<RecipientFieldHandle>(null)
  const ccRef = useRef<RecipientFieldHandle>(null)
  const bccRef = useRef<RecipientFieldHandle>(null)
  const accountRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const dirty = useRef(false)
  const closedRef = useRef(false)

  const draftId = composer.draftId ?? composer.id
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0]
  const signatureHtml = settings.signatureHtml?.[accountId]?.trim() || ''

  const editor = useComposerEditor({ onUpdate: () => { dirty.current = true } })

  useEffect(() => {
    if (!editor) return
    editorRegistry.set(composer.id, editor)
    return () => { editorRegistry.delete(composer.id) }
  }, [editor, composer.id])

  // ---------------------------------------------------------------- prefill

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Restoring a saved draft wins over reply prefill.
      if (composer.draftId) {
        const d = await window.api.invoke('drafts.get', composer.draftId)
        if (cancelled || !d) return
        setTo(d.to ?? []); setCc(d.cc ?? []); setBcc(d.bcc ?? []); setSubject(d.subject ?? '')
        setShowCc((d.cc ?? []).length > 0); setShowBcc((d.bcc ?? []).length > 0)
        if (d.accountId) setAccountId(d.accountId)
        if (d.doc) editor?.commands.setContent(d.doc as never)
        return
      }
      if (composer.mode === 'new' || !composer.threadId) return

      const thread = await window.api.invoke('threads.get', composer.threadId)
      if (cancelled || !thread) return
      const msg: Message | undefined =
        thread.messages.find((m) => m.id === composer.messageId) ?? thread.messages[thread.messages.length - 1]
      if (!msg) return

      const selfEmails = accounts.map((a) => a.email)
      if (composer.mode === 'forward') {
        setSubject(forwardSubject(msg.subject))
      } else {
        const r = replyRecipients(msg, composer.mode === 'replyAll' ? 'replyAll' : 'reply', selfEmails)
        setTo(r.to); setCc(r.cc); setShowCc(r.cc.length > 0)
        setSubject(replySubject(msg.subject))
      }
      const clean = msg.bodyHtml ? sanitizeFragment(msg.bodyHtml) : null
      const q = buildQuoted({ ...msg, bodyHtml: clean })
      setQuoted(composer.mode === 'forward'
        ? { ...q, html: `${forwardHeaderHtml(msg)}${clean ?? ''}` }
        : q)
      setReplyRef({ threadId: thread.id, messageId: msg.id, mode: composer.mode })
      editor?.commands.focus('start')
    })()
    return () => { cancelled = true }
    // Prefill runs once per composer, when the editor exists.
  }, [editor, composer.draftId, composer.mode, composer.messageId, composer.threadId])

  const [replyRef, setReplyRef] = useState<OutgoingMessage['inReplyTo']>(
    composer.threadId && composer.messageId && composer.mode !== 'new'
      ? { threadId: composer.threadId, messageId: composer.messageId, mode: composer.mode === 'forward' ? 'forward' : composer.mode }
      : undefined
  )

  // ---------------------------------------------------------------- autosave

  const snapshot = useCallback((): Draft | null => {
    if (!editor) return null
    const { message, text } = buildOutgoing({
      accountId, to, cc, bcc, subject,
      doc: editor.getJSON(),
      ...(signatureOn && signatureHtml ? { signatureHtml } : {}),
      ...(quoted ? { quoted } : {}),
      attachments,
      ...(replyRef ? { inReplyTo: replyRef } : {})
    })
    return {
      id: draftId, accountId, to, cc, bcc, subject,
      doc: editor.getJSON(), html: message.html, text, updatedAt: Date.now(),
      ...(message.attachments ? { attachments: message.attachments } : {}),
      ...(replyRef ? { inReplyTo: replyRef } : {})
    }
  }, [editor, accountId, to, cc, bcc, subject, signatureOn, signatureHtml, quoted, attachments, replyRef, draftId])

  const isEmpty = useCallback((): boolean =>
    !to.length && !cc.length && !bcc.length && !subject.trim() && !attachments.length &&
    !(editor?.getText().trim())
  , [to, cc, bcc, subject, attachments, editor])

  const saveDraft = useCallback(async (): Promise<void> => {
    const d = snapshot()
    if (!d || isEmpty()) return
    await window.api.invoke('drafts.save', d)
    setSavedAt(Date.now())
  }, [snapshot, isEmpty])

  useEffect(() => {
    const t = setInterval(() => {
      if (!dirty.current || closedRef.current) return
      dirty.current = false
      void saveDraft()
    }, AUTOSAVE_MS)
    return () => clearInterval(t)
  }, [saveDraft])

  useEffect(() => { dirty.current = true }, [to, cc, bcc, subject, attachments, accountId, signatureOn])

  // ---------------------------------------------------------------- actions

  const close = useCallback((opts: { save: boolean }) => {
    closedRef.current = true
    if (opts.save && !isEmpty()) void saveDraft()
    closeComposer(composer.id)
  }, [closeComposer, composer.id, isEmpty, saveDraft])

  const discard = useCallback(() => {
    closedRef.current = true
    void window.api.invoke('drafts.delete', draftId).catch(() => undefined)
    closeComposer(composer.id)
    toast({ message: 'Draft discarded' })
  }, [closeComposer, composer.id, draftId, toast])

  const doSend = useCallback(async (opts: { scheduledAt?: number | null; archive?: boolean } = {}) => {
    if (!editor || sending) return
    // A mouse-click Send gets any pending recipient text committed for free (the input blurs
    // before the click fires); ⌘Enter doesn't blur anything, so force it here too, or a typed
    // address never followed by Enter/comma would be silently dropped from the sent message.
    // The commits update `to`/`cc`/`bcc` state, but that won't be visible until a re-render, so
    // merge the returned addresses in locally rather than reading stale `to`/`cc`/`bcc` below.
    const pendingTo = toRef.current?.commitPending()
    const pendingCc = ccRef.current?.commitPending()
    const pendingBcc = bccRef.current?.commitPending()
    const finalTo = pendingTo ? dedupeAddresses([...to, pendingTo]) : to
    const finalCc = pendingCc ? dedupeAddresses([...cc, pendingCc]) : cc
    const finalBcc = pendingBcc ? dedupeAddresses([...bcc, pendingBcc]) : bcc

    const bodyText = editor.getText()
    const check = validateCompose({ to: finalTo, cc: finalCc, bcc: finalBcc, subject, bodyText, attachmentCount: attachments.length })
    // Warnings are confirmable: showing them once and sending on the second press is the
    // Notion/Gmail behaviour ("Send anyway").
    if (check.errors.length || (check.warnings.length && !problems)) { setProblems(check); return }
    setProblems(null)
    setSending(true)

    // NOTE: `draftId` here is `composer.draftId ?? composer.id` — the *local* autosave draft's
    // primary key (src/main/db/repo.ts). It never corresponds to a server-side Gmail/Outlook draft
    // (`drafts.save` only ever writes to the local SQLite `drafts` table, never to a provider), so
    // it must never be forwarded as `OutgoingMessage.draftId`: both adapters treat that field as
    // "an existing remote draft to PUT/PATCH-then-send", and PUTting a remote draft that was never
    // created 404s — which is why every real send was silently failing.
    const { message } = buildOutgoing({
      accountId, to: finalTo, cc: finalCc, bcc: finalBcc, subject,
      doc: editor.getJSON(),
      ...(signatureOn && signatureHtml ? { signatureHtml } : {}),
      ...(quoted ? { quoted } : {}),
      attachments,
      ...(replyRef ? { inReplyTo: replyRef } : {})
    })

    const plan = planSend({ undoSendSeconds: settings.undoSendSeconds, scheduledAt: opts.scheduledAt })
    // Undo reopens the composer from a draft, so capture it now: closing the composer
    // destroys the editor and `snapshot()` would have nothing left to read.
    const draftForUndo = snapshot()
    try {
      let scheduled: ScheduledSend | null = null
      if (plan.kind === 'send') await window.api.invoke('compose.send', message)
      else scheduled = await window.api.invoke('compose.schedule', message, plan.at)

      await window.api.invoke('drafts.delete', draftId).catch(() => undefined)
      closedRef.current = true
      closeComposer(composer.id)

      if (plan.kind === 'scheduled') {
        toast({
          message: scheduledToast(plan.at),
          actionLabel: 'Cancel',
          onAction: scheduled ? () => void window.api.invoke('compose.cancelScheduled', scheduled.id) : undefined
        })
      } else {
        toast({
          message: 'Message sent',
          actionLabel: scheduled ? 'Undo' : undefined,
          duration: plan.kind === 'undoable' ? plan.undoSeconds * 1000 : 5000,
          // Restore the draft *before* reopening, or the new composer's `drafts.get`
          // races the save and finds the draft we deleted on send.
          onAction: scheduled
            ? () => void (async () => {
                await window.api.invoke('compose.cancelScheduled', scheduled.id)
                if (draftForUndo) await window.api.invoke('drafts.save', draftForUndo)
                useApp.getState().openComposer({ ...composer, draftId })
              })()
            : undefined
        })
      }
      if (opts.archive && composer.threadId) void act({ type: 'archive' }, [composer.threadId], 'Conversation archived')
    } catch (e) {
      setSending(false)
      toast({ message: e instanceof Error ? e.message : 'Could not send the message' })
    }
  }, [editor, sending, to, cc, bcc, subject, attachments, problems, accountId, signatureOn, signatureHtml,
      quoted, replyRef, draftId, settings.undoSendSeconds, closeComposer, composer, toast, act, snapshot])

  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length) return
    const { images, others } = partitionFiles(files)
    // Images go into the body as inline blocks; anything else becomes a paperclip chip.
    for (const img of images) {
      const src = await new Promise<string>((resolve) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.readAsDataURL(img)
      })
      editor?.chain().focus().setImage({ src, alt: img.name }).run()
    }
    if (others.length) {
      const read = await Promise.all(others.map(fileToAttachment))
      setAttachments((list) => [...list, ...read])
    }
    dirty.current = true
  }, [editor])

  // ---------------------------------------------------------------- shortcuts

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape' && !menu) { e.preventDefault(); e.stopPropagation(); close({ save: true }); return }
      if (e.key === 'Escape') { setMenu(null); setProblems(null); return }
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k === 'enter') { e.preventDefault(); e.stopPropagation(); void doSend({ archive: e.shiftKey }); return }
      if (!e.shiftKey) return
      if (k === 'f') { e.preventDefault(); setMenu('account'); accountRef.current?.focus() }
      else if (k === 'c') { e.preventDefault(); setShowCc(true) }
      else if (k === 'b') { e.preventDefault(); setShowBcc(true) }
      else if (k === 'd') { e.preventDefault(); discard() }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [close, discard, doSend, menu])

  // Close popovers on an outside click.
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent): void => {
      if (!(e.target instanceof Node) || !rootRef.current?.contains(e.target)) setMenu(null)
      else if (!(e.target as HTMLElement).closest('.cmp-pop, .cmp-toolbtn, .cmp-from__btn, .cmp-send__caret')) setMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menu])

  // ---------------------------------------------------------------- render

  const options = useMemo(() => scheduleOptions(new Date()), [menu])
  const title = subject.trim() || (composer.mode === 'new' ? 'New message' : replySubject(''))
  const over = isOverSizeLimit(attachments)

  const chrome = !inline
  const style: React.CSSProperties | undefined = chrome && !maximised
    ? { right: offsetRight, bottom: 0, zIndex: 40 + stack, ...(width ? { width } : {}) }
    : undefined

  if (chrome && minimised) {
    return (
      <div className="cmp-min" style={{ right: offsetRight, zIndex: 40 + stack }}>
        <button type="button" className="cmp-min__title" onClick={() => onMinimise(false)}>{title}</button>
        <button type="button" className="cmp-iconbtn" aria-label="Expand" onClick={() => onMinimise(false)}><ChevronUp size={15} /></button>
        <button type="button" className="cmp-iconbtn" aria-label="Close" onClick={() => close({ save: true })}><X size={15} /></button>
      </div>
    )
  }

  return (
    <section
      ref={rootRef}
      className={`cmp${chrome ? ' cmp--window' : ' cmp--inline'}${maximised ? ' is-max' : ''}${dragging ? ' is-dragging' : ''}`}
      style={style}
      aria-label="Message composer"
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }}
      onDrop={(e) => {
        const files = Array.from(e.dataTransfer.files)
        if (!files.length) return
        e.preventDefault(); setDragging(false); void addFiles(files)
      }}
    >
      {chrome && (
        <header className="cmp__header">
          <span className="cmp__title">{title}</span>
          <div className="cmp__chrome">
            <button type="button" className="cmp-iconbtn" aria-label="Minimise" onClick={() => onMinimise(true)}><Minus size={15} /></button>
            <button type="button" className="cmp-iconbtn" aria-label={maximised ? 'Restore' : 'Maximise'} onClick={() => setMaximised((v) => !v)}>
              {maximised ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button type="button" className="cmp-iconbtn" aria-label="Close" onClick={() => close({ save: true })}><X size={15} /></button>
          </div>
        </header>
      )}

      <div className="cmp__fields">
        <div className="cmp-field cmp-field--from">
          <span className="cmp-field__label">From</span>
          <div className="cmp-from">
            <button
              ref={accountRef}
              type="button"
              className="cmp-from__btn"
              onClick={() => setMenu(menu === 'account' ? null : 'account')}
            >
              <span className="cmp-from__dot" style={{ background: account?.color ?? 'var(--c-text-3)' }} />
              {account ? `${account.name} <${account.email}>` : 'No account'}
              <ChevronDown size={13} />
            </button>
            {menu === 'account' && (
              <div className="cmp-pop cmp-pop--from">
                {accounts.map((a) => (
                  <button key={a.id} type="button" className={`cmp-menu__row${a.id === accountId ? ' is-active' : ''}`} onClick={() => { setAccountId(a.id); setMenu(null) }}>
                    <span className="cmp-from__dot" style={{ background: a.color }} />
                    <span className="cmp-menu__text">
                      <span className="cmp-menu__title">{a.name}</span>
                      <span className="cmp-menu__desc">{a.email}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <RecipientField
          ref={toRef}
          label="To"
          value={to}
          onChange={setTo}
          autoFocus={composer.mode === 'new' && !composer.init?.to?.length}
          trailing={
            <span className="cmp-field__links">
              {!showCc && <button type="button" className="cmp-link" onClick={() => setShowCc(true)}>Cc</button>}
              {!showBcc && <button type="button" className="cmp-link" onClick={() => setShowBcc(true)}>Bcc</button>}
            </span>
          }
        />
        {showCc && <RecipientField ref={ccRef} label="Cc" value={cc} onChange={setCc} autoFocus />}
        {showBcc && <RecipientField ref={bccRef} label="Bcc" value={bcc} onChange={setBcc} autoFocus />}

        <div className="cmp-field">
          <span className="cmp-field__label">Subject</span>
          <input
            ref={subjectRef}
            className="cmp-input"
            value={subject}
            aria-label="Subject"
            onChange={(e) => setSubject(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); editor?.commands.focus('start') } }}
          />
        </div>
      </div>

      <div className="cmp__body">
        {editor && <EditorSurface editor={editor} snippets={snippets} onRequestImage={() => imageInput.current?.click()} />}

        {signatureOn && signatureHtml && (
          <div className="cmp__signature" dangerouslySetInnerHTML={{ __html: sanitizeFragment(signatureHtml) }} />
        )}

        {quoted && (
          <div className="cmp__quote">
            <button type="button" className="cmp__quote-toggle" aria-expanded={quoteOpen} title="Show quoted text" onClick={() => setQuoteOpen((v) => !v)}>···</button>
            {quoteOpen && (
              <blockquote className="cmp__quoted">
                <p className="cmp__quote-attr">{quoted.attribution}</p>
                {quoted.html
                  ? <div dangerouslySetInnerHTML={{ __html: sanitizeFragment(quoted.html) }} />
                  : <pre className="cmp__quote-text">{quoted.text}</pre>}
              </blockquote>
            )}
          </div>
        )}
      </div>

      {attachments.length > 0 && (
        <div className="cmp__attachments">
          {attachments.map((a) => (
            <span key={a.id} className={`cmp-att${isImageType(a.mimeType) ? ' is-image' : ''}`}>
              <span className="cmp-att__name">{a.filename}</span>
              <span className="cmp-att__size">{formatBytes(a.size)}</span>
              <button type="button" className="cmp-att__x" aria-label={`Remove ${a.filename}`} onClick={() => setAttachments((l) => l.filter((x) => x.id !== a.id))}>
                <X size={11} strokeWidth={2.5} />
              </button>
            </span>
          ))}
          <span className={`cmp-att__total${over ? ' is-over' : ''}`}>
            {formatBytes(totalBytes(attachments))}{over ? ' — over the 25 MB limit' : ''}
          </span>
        </div>
      )}

      {problems && (problems.errors.length || problems.warnings.length) > 0 && (
        <div className={`cmp__alert${problems.errors.length ? ' is-error' : ''}`} role="alert">
          <span>{[...problems.errors, ...problems.warnings].join(' ')}</span>
          {!problems.errors.length && (
            <button type="button" className="cmp-link" onClick={() => void doSend()}>Send anyway</button>
          )}
          <button type="button" className="cmp-iconbtn" aria-label="Dismiss" onClick={() => setProblems(null)}><X size={13} /></button>
        </div>
      )}

      <footer className="cmp__toolbar">
        <div className="cmp__tools">
          <button type="button" className="cmp-toolbtn" title="Snippets" aria-label="Snippets" onClick={() => setMenu(menu === 'snippets' ? null : 'snippets')}><Braces size={16} /></button>
          <button type="button" className="cmp-toolbtn" title="Attach files" aria-label="Attach files" onClick={() => fileInput.current?.click()}><Paperclip size={16} /></button>
          <button type="button" className="cmp-toolbtn" title="Discard draft (⌘⇧D)" aria-label="Discard draft" onClick={discard}><Trash2 size={16} /></button>
          <button type="button" className="cmp-toolbtn" title="Formatting help" aria-label="Formatting help" onClick={() => setMenu(menu === 'help' ? null : 'help')}><HelpCircle size={16} /></button>
          {signatureHtml && (
            <button type="button" className={`cmp-toolbtn cmp-toolbtn--text${signatureOn ? ' is-on' : ''}`} onClick={() => setSignatureOn((v) => !v)}>Signature</button>
          )}
          {savedAt && <span className="cmp__saved">Draft saved</span>}
        </div>

        <div className="cmp__send">
          <button type="button" className="cmp-send" disabled={sending} onClick={() => void doSend()}>
            <Send size={14} /> Send
          </button>
          <button type="button" className="cmp-send__caret" aria-label="Schedule send" disabled={sending} onClick={() => setMenu(menu === 'schedule' ? null : 'schedule')}>
            <ChevronDown size={14} />
          </button>

          {menu === 'schedule' && (
            <div className="cmp-pop cmp-pop--schedule">
              <div className="cmp-menu__group">Schedule send</div>
              {options.map((o) => (
                o.at
                  ? (
                    <button key={o.id} type="button" className="cmp-menu__row" onClick={() => { setMenu(null); void doSend({ scheduledAt: o.at }) }}>
                      <span className="cmp-menu__title">{o.label}</span>
                      <span className="cmp-menu__hint">{o.detail}</span>
                    </button>
                  )
                  : (
                    <div key={o.id} className="cmp-pop__custom">
                      <label htmlFor={`when-${composer.id}`}>{o.label}</label>
                      <input
                        id={`when-${composer.id}`}
                        type="datetime-local"
                        className="cmp-input"
                        value={customTime || toLocalInputValue(new Date(Date.now() + 36e5))}
                        onChange={(e) => setCustomTime(e.target.value)}
                      />
                      <button
                        type="button"
                        className="cmp-send cmp-send--sm"
                        onClick={() => {
                          const at = fromLocalInputValue(customTime || toLocalInputValue(new Date(Date.now() + 36e5)))
                          if (!at) { toast({ message: 'Pick a time in the future' }); return }
                          setMenu(null); void doSend({ scheduledAt: at })
                        }}
                      >Schedule</button>
                    </div>
                  )
              ))}
            </div>
          )}
        </div>

        {menu === 'snippets' && (
          <div className="cmp-pop cmp-pop--snippets">
            <div className="cmp-menu__group">Snippets</div>
            {snippets.length === 0 && <div className="cmp-menu__empty">No snippets yet</div>}
            {snippets.map((s) => (
              <button key={s.id} type="button" className="cmp-menu__row" onClick={() => { editor?.chain().focus().insertContent((s.doc.content ?? s.doc) as never).run(); setMenu(null) }}>
                <span className="cmp-menu__icon"><Braces size={15} /></span>
                <span className="cmp-menu__title">{s.name}</span>
              </button>
            ))}
            {/* Electron does not implement window.prompt(), so name it inline. */}
            {newSnippet === null ? (
              <button
                type="button"
                className="cmp-menu__row cmp-menu__row--new"
                onClick={() => setNewSnippet('')}
              >+ New snippet from this draft</button>
            ) : (
              <div className="cmp-pop__custom">
                <label htmlFor={`snip-${composer.id}`}>Snippet name</label>
                <input
                  id={`snip-${composer.id}`}
                  className="cmp-input"
                  autoFocus
                  value={newSnippet}
                  placeholder="Website link"
                  onChange={(e) => setNewSnippet(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (!newSnippet.trim() || !editor) return
                      setSnippets(upsertSnippet({ name: newSnippet, doc: editor.getJSON() as never }))
                      setNewSnippet(null)
                      setMenu(null)
                    }
                    if (e.key === 'Escape') { e.preventDefault(); setNewSnippet(null) }
                  }}
                />
              </div>
            )}
          </div>
        )}

        {menu === 'help' && (
          <div className="cmp-pop cmp-pop--help">
            <div className="cmp-menu__group">Formatting</div>
            {[
              ['/', 'Insert a block'], [':', 'Emoji'], ['⌘B / ⌘I / ⌘U', 'Bold, italic, underline'],
              ['⌘⇧S', 'Strikethrough'], ['⌘E', 'Code'], ['⌘K', 'Link'], ['⌥⌘1–3', 'Headings'],
              ['# ## ###', 'Headings'], ['- or *', 'Bulleted list'], ['1.', 'Numbered list'],
              ['[]', 'To-do'], ['>', 'Quote'], ['```', 'Code block'], ['---', 'Divider'],
              ['⌘↵', 'Send'], ['⌘⇧↵', 'Send & archive'], ['esc', 'Save draft & close']
            ].map(([k, v]) => (
              <div key={k} className="cmp-help__row"><kbd>{k}</kbd><span>{v}</span></div>
            ))}
          </div>
        )}
      </footer>

      <input ref={fileInput} type="file" multiple hidden onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />

      {dragging && <div className="cmp__drop">Drop files to attach</div>}
    </section>
  )
}
