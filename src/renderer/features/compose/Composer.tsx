/**
 * One composer: header, From/To/Cc/Bcc, subject, block editor, bottom toolbar.
 *
 * Placement (floating window vs inline in the reader) is decided by `ComposeHost`; this
 * component is the same either way.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Braces, Check, ChevronDown, ChevronUp, HelpCircle, Maximize2, Minimize2, Minus,
  Paperclip, Send, Trash2, X
} from 'lucide-react'
import type { Address, Draft, Message, OutgoingMessage, ScheduledSend } from '@shared/types'
import type { QuotedOriginal } from '@shared/emailhtml'
import { buildQuoted, forwardHeaderHtml, forwardSubject, replyRecipients, replySubject } from '@shared/emailhtml'
import { sanitizeFragment } from '@shared/sanitize'
import { useApp, type ComposerState } from '@/lib/store'
import { Tooltip } from '@/features/tooltip'
import { editorRegistry } from './registry'
import { avatarHue } from './frecency'
import { EditorSurface, useComposerEditor } from './Editor'
import { RecipientField, type RecipientFieldHandle, type RecipientKind } from './RecipientField'
import { dedupeAddresses, validateCompose } from './recipients'
import { buildOutgoing, planSend } from './send'
import {
  fileToAttachment, formatBytes, isImageType, isOverSizeLimit, partitionFiles,
  totalBytes, type PendingAttachment
} from './attachments'
import { fromLocalInputValue, scheduleOptions, scheduledToast, toLocalInputValue } from './schedule'
import { loadSnippets, upsertSnippet, type Snippet } from './snippets'
import type { SnippetContext } from './snippetVars'
import {
  domainOf, findDomainTypos, replyAllNote, sendNudges, type DomainTypo, type NudgeId
} from './safety'
import { pickReplyAccount, signatureFor } from './identity'
import './compose.css'
import './smart.css'

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
  /** The send-time confirm bar: hard errors, or gentle "are you sure?" nudges. */
  const [problems, setProblems] = useState<{ errors: string[]; nudges: { id: NudgeId; text: string }[] } | null>(null)
  /** Nudges the user has already seen (or dismissed): a second send goes through. */
  const ackedNudges = useRef<Set<NudgeId>>(new Set())
  /** Domain -> how often we have mailed it (own accounts + frequent contacts): the typo detector's dictionary. */
  const [knownDomains, setKnownDomains] = useState<Map<string, number>>(() => new Map())
  const [dismissedNotes, setDismissedNotes] = useState<Set<string>>(() => new Set())
  /** Set on a reply: who "Reply" alone would have gone to, and whether the original was a list mailing. */
  const [replyInfo, setReplyInfo] = useState<{ senderOnly: Address[]; listy: boolean } | null>(null)
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
  const fromMenuRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const dirty = useRef(false)
  const closedRef = useRef(false)

  const draftId = composer.draftId ?? composer.id
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0]
  // The signature follows the From identity: switch account, the signature switches with it.
  const signatureHtml = signatureFor(settings.signatureHtml, accountId)

  const editor = useComposerEditor({
    onUpdate: () => { dirty.current = true },
    smartTypography: () => useApp.getState().settings.smartTypography !== false
  })

  // Latest recipient lists for callbacks that outlive a render (drag end, send).
  const listsRef = useRef({ to, cc, bcc })
  listsRef.current = { to, cc, bcc }
  /** Focus a Cc / Bcc row once it has mounted (only when the *user* asked for it). */
  const focusOnReveal = useRef<RecipientKind | null>(null)
  /** Rows revealed only so a dragged chip has somewhere to land. */
  const dragRevealed = useRef<{ cc: boolean; bcc: boolean }>({ cc: false, bcc: false })

  const snippetContext = useCallback((): SnippetContext => ({
    recipient: to[0] ?? cc[0] ?? null,
    me: account ? { name: account.name, email: account.email } : null,
    locale: navigator.language
  }), [to, cc, account])

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
        // Resume where the draft is incomplete: recipient, then subject, otherwise the body.
        requestAnimationFrame(() => {
          if (!(d.to ?? []).length) toRef.current?.focus()
          else if (!(d.subject ?? '').trim()) subjectRef.current?.focus()
          else editor?.commands.focus('end')
        })
        return
      }
      if (composer.mode === 'new' || !composer.threadId) {
        // A new message opened with recipients (mailto:, "write to Ada") needs a subject next;
        // a blank one focuses To via `autoFocus`.
        if (composer.mode === 'new' && composer.init?.to?.length) {
          requestAnimationFrame(() => {
            if (composer.init?.subject) editor?.commands.focus('start')
            else subjectRef.current?.focus()
          })
        }
        return
      }

      const thread = await window.api.invoke('threads.get', composer.threadId)
      if (cancelled || !thread) return
      const msg: Message | undefined =
        thread.messages.find((m) => m.id === composer.messageId) ?? thread.messages[thread.messages.length - 1]
      if (!msg) return

      const selfEmails = accounts.map((a) => a.email)
      // Reply from the mailbox the conversation lives in, not whichever account was focused.
      setAccountId((cur) => pickReplyAccount(msg, accounts, cur))
      if (composer.mode === 'forward') {
        setSubject(forwardSubject(msg.subject))
      } else {
        const r = replyRecipients(msg, composer.mode === 'replyAll' ? 'replyAll' : 'reply', selfEmails)
        setTo(r.to); setCc(r.cc); setShowCc(r.cc.length > 0)
        setSubject(replySubject(msg.subject))
        setReplyInfo({ senderOnly: replyRecipients(msg, 'reply', selfEmails).to, listy: !!msg.listUnsubscribe })
      }
      const clean = msg.bodyHtml ? sanitizeFragment(msg.bodyHtml) : null
      const q = buildQuoted({ ...msg, bodyHtml: clean })
      setQuoted(composer.mode === 'forward'
        ? { ...q, html: `${forwardHeaderHtml(msg)}${clean ?? ''}` }
        : q)
      setReplyRef({ threadId: thread.id, messageId: msg.id, mode: composer.mode })
    })()
    return () => { cancelled = true }
    // Prefill runs once per composer, when the editor exists.
  }, [editor, composer.draftId, composer.mode, composer.messageId, composer.threadId])

  const [replyRef, setReplyRef] = useState<OutgoingMessage['inReplyTo']>(
    composer.threadId && composer.messageId && composer.mode !== 'new'
      ? { threadId: composer.threadId, messageId: composer.messageId, mode: composer.mode === 'forward' ? 'forward' : composer.mode }
      : undefined
  )

  // Focus: a reply is about the body, a forward needs a recipient. (New messages focus To via
  // `autoFocus`; resumed drafts and prefilled recipients are handled after the prefill above.)
  const focused = useRef(false)
  useEffect(() => {
    if (!editor || focused.current || composer.draftId) return
    if (composer.mode === 'reply' || composer.mode === 'replyAll') { focused.current = true; editor.commands.focus('start') }
    else if (composer.mode === 'forward') { focused.current = true; requestAnimationFrame(() => toRef.current?.focus()) }
  }, [editor, composer.mode, composer.draftId])

  // Reveal-then-focus for Cc / Bcc (the row does not exist until it is shown).
  useEffect(() => {
    const k = focusOnReveal.current
    if (!k) return
    focusOnReveal.current = null
    requestAnimationFrame(() => (k === 'cc' ? ccRef : bccRef).current?.focus())
  }, [showCc, showBcc])

  // The typo detector's dictionary: our own domains plus everyone we actually correspond with.
  useEffect(() => {
    let cancelled = false
    void window.api.invoke('contacts.suggest', '', 300).then((list) => {
      if (cancelled) return
      const m = new Map<string, number>()
      for (const c of list) { const d = domainOf(c.email); if (d) m.set(d, (m.get(d) ?? 0) + Math.max(1, c.useCount)) }
      for (const a of accounts) { const d = domainOf(a.email); if (d) m.set(d, (m.get(d) ?? 0) + 1000) }
      setKnownDomains(m)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [accounts])

  // Snippets edited in Settings while a composer is open.
  useEffect(() => {
    const refresh = (): void => setSnippets(loadSnippets())
    window.addEventListener('mailroom:snippets-changed', refresh)
    window.addEventListener('storage', refresh)
    return () => { window.removeEventListener('mailroom:snippets-changed', refresh); window.removeEventListener('storage', refresh) }
  }, [])

  // ---------------------------------------------------------------- safety notes

  const allRecipients = useMemo(() => [...to, ...cc, ...bcc], [to, cc, bcc])
  const typos = useMemo<DomainTypo[]>(
    () => findDomainTypos(allRecipients, knownDomains).filter((t) => !dismissedNotes.has(`typo:${t.address.email.toLowerCase()}`)),
    [allRecipients, knownDomains, dismissedNotes]
  )
  const suspects = useMemo(() => new Set(typos.map((t) => t.address.email.toLowerCase())), [typos])
  const crowd = useMemo(
    () => (dismissedNotes.has('replyall')
      ? null
      : replyAllNote({ mode: composer.mode, to, cc, selfEmails: accounts.map((a) => a.email), originalIsList: replyInfo?.listy })),
    [composer.mode, to, cc, accounts, replyInfo, dismissedNotes]
  )
  const dismissNote = (key: string): void => setDismissedNotes((s) => new Set(s).add(key))

  const fixTypo = (t: DomainTypo): void => {
    const swap = (l: Address[]): Address[] => dedupeAddresses(l.map((a) => (a.email === t.address.email ? t.fixed : a)))
    setTo(swap); setCc(swap); setBcc(swap)
    // The bar may be showing this very problem; it is gone now.
    setProblems((p) => (p ? { ...p, nudges: p.nudges.filter((n) => n.id !== 'typo') } : p))
  }

  const replySenderOnly = (): void => {
    if (!replyInfo) return
    setTo(replyInfo.senderOnly); setCc([]); setShowCc(false)
    dismissNote('replyall')
  }

  /** Drag a chip between To / Cc / Bcc. */
  const moveRecipient = useCallback((address: Address, from: RecipientKind, target: RecipientKind): void => {
    const setters = { to: setTo, cc: setCc, bcc: setBcc }
    setters[from]((l) => l.filter((a) => a.email !== address.email))
    setters[target]((l) => dedupeAddresses([...l, address]))
  }, [])

  const onChipDragActive = useCallback((active: boolean): void => {
    // Defer: changing the DOM inside `dragstart` can cancel the drag in Chromium.
    setTimeout(() => {
      if (active) {
        dragRevealed.current = { cc: !showCc, bcc: !showBcc }
        setShowCc(true); setShowBcc(true)
      } else {
        const { cc: c, bcc: b } = listsRef.current
        if (dragRevealed.current.cc && !c.length) setShowCc(false)
        if (dragRevealed.current.bcc && !b.length) setShowBcc(false)
        dragRevealed.current = { cc: false, bcc: false }
      }
    }, 0)
  }, [showCc, showBcc])

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
    if (check.errors.length) { setProblems({ errors: check.errors, nudges: [] }); return }

    // Gentle, dismissable "are you sure?": shown once per kind, and a second Send (⌘↵ again,
    // or "Send anyway") goes through. Anything the user has already seen never nags twice.
    const nudges = sendNudges({
      subject, bodyText, attachmentCount: attachments.length,
      hasInlineImage: JSON.stringify(editor.getJSON()).includes('"type":"image"'),
      typos: findDomainTypos([...finalTo, ...finalCc, ...finalBcc], knownDomains)
        .filter((t) => !dismissedNotes.has(`typo:${t.address.email.toLowerCase()}`))
    })
    if (nudges.some((n) => !ackedNudges.current.has(n.id))) {
      nudges.forEach((n) => ackedNudges.current.add(n.id))
      setProblems({ errors: [], nudges })
      return
    }
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
    // Undo (and a failed send) reopen the composer from a draft, so capture it now: closing the
    // composer destroys the editor and `snapshot()` would have nothing left to read.
    const draftForUndo = snapshot()
    const archiveThread = opts.archive && composer.threadId ? composer.threadId : null

    /** Put the message back exactly as it was: draft first, so the reopened composer finds it. */
    const reopen = async (): Promise<void> => {
      if (draftForUndo) await window.api.invoke('drafts.save', draftForUndo)
      useApp.getState().openComposer({ ...composer, draftId })
    }

    // Feels instant: the window goes away *now*; the toast carries the outcome. The IPC call
    // runs behind it, and a failure brings the draft straight back rather than losing it.
    closedRef.current = true
    closeComposer(composer.id)
    if (archiveThread) void act({ type: 'archive' }, [archiveThread], 'Conversation archived')

    if (plan.kind === 'send') {
      // No undo window configured: say "Sending…" until the provider accepts it.
      toast({ message: 'Sending…', duration: 0 })
      const pendingId = useApp.getState().toasts.at(-1)?.id
      try {
        await window.api.invoke('compose.send', message)
        await window.api.invoke('drafts.delete', draftId).catch(() => undefined)
        if (pendingId != null) useApp.getState().dismissToast(pendingId)
        toast({ message: 'Sent', duration: 3000 })
      } catch (e) {
        if (pendingId != null) useApp.getState().dismissToast(pendingId)
        toast({ message: e instanceof Error ? `Not sent: ${e.message}` : 'Could not send the message' })
        await reopen()
      }
      return
    }

    // Undoable / scheduled: queue it, and let the toast's action await that queueing.
    const queued = window.api.invoke('compose.schedule', message, plan.at)
    void queued
      .then(() => window.api.invoke('drafts.delete', draftId).catch(() => undefined))
      .catch((e: unknown) => {
        toast({ message: e instanceof Error ? `Not sent: ${e.message}` : 'Could not send the message' })
        return reopen()
      })

    if (plan.kind === 'scheduled') {
      toast({
        message: scheduledToast(plan.at),
        actionLabel: 'Cancel',
        onAction: () => void queued.then((sc: ScheduledSend) => window.api.invoke('compose.cancelScheduled', sc.id)).catch(() => undefined)
      })
    } else {
      toast({
        message: 'Sent',
        actionLabel: 'Undo',
        duration: plan.undoSeconds * 1000,
        onAction: () => void queued
          .then(async (sc: ScheduledSend) => {
            await window.api.invoke('compose.cancelScheduled', sc.id)
            await reopen()
          })
          .catch(() => undefined)
      })
    }
  }, [editor, sending, to, cc, bcc, subject, attachments, knownDomains, dismissedNotes, accountId, signatureOn, signatureHtml,
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
      // Esc peels one layer at a time: a menu, then the confirm bar, then the composer itself.
      if (e.key === 'Escape' && !menu && !problems) { e.preventDefault(); e.stopPropagation(); close({ save: true }); return }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(null); setProblems(null); return }
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k === 'enter') { e.preventDefault(); e.stopPropagation(); void doSend({ archive: e.shiftKey }); return }
      if (!e.shiftKey) return
      if (k === 'f') { e.preventDefault(); setMenu('account') }
      else if (k === 'c') { e.preventDefault(); if (showCc) ccRef.current?.focus(); else { focusOnReveal.current = 'cc'; setShowCc(true) } }
      else if (k === 'b') { e.preventDefault(); if (showBcc) bccRef.current?.focus(); else { focusOnReveal.current = 'bcc'; setShowBcc(true) } }
      else if (k === 'd') { e.preventDefault(); discard() }
      else if (k === 'p') { e.preventDefault(); subjectRef.current?.focus() }
      else if (k === 'o') { e.preventDefault(); toRef.current?.focus() }
      else if (k === 'y') { e.preventDefault(); editor?.commands.focus() }
      else if (k === 'a') { e.preventDefault(); fileInput.current?.click() }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [close, discard, doSend, menu, problems, showCc, showBcc, editor])

  // Opening the From menu puts focus on the current identity so arrows/Enter just work.
  useEffect(() => {
    if (menu !== 'account') return
    requestAnimationFrame(() => {
      const el = (fromMenuRef.current?.querySelector('.is-active') ?? fromMenuRef.current?.querySelector('button')) as HTMLElement | null
      el?.focus()
    })
  }, [menu])

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
              aria-haspopup="listbox"
              aria-expanded={menu === 'account'}
              onClick={() => setMenu(menu === 'account' ? null : 'account')}
            >
              {account ? <AccountAvatar account={account} size={16} /> : <span className="cmp-from__dot" />}
              {account ? `${account.name} <${account.email}>` : 'No account'}
              {accounts.length > 1 && <ChevronDown size={13} />}
            </button>
            {menu === 'account' && (
              <div
                ref={fromMenuRef}
                className="cmp-pop cmp-pop--from"
                role="listbox"
                aria-label="Send from"
                onKeyDown={(e) => {
                  const rows = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
                  const i = rows.indexOf(document.activeElement as HTMLButtonElement)
                  if (e.key === 'ArrowDown') { e.preventDefault(); rows[(i + 1) % rows.length]?.focus() }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); rows[(i - 1 + rows.length) % rows.length]?.focus() }
                  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(null); accountRef.current?.focus() }
                }}
              >
                {accounts.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="option"
                    aria-selected={a.id === accountId}
                    className={`cmp-menu__row${a.id === accountId ? ' is-active' : ''}`}
                    onClick={() => { setAccountId(a.id); setMenu(null); editor?.commands.focus() }}
                  >
                    <AccountAvatar account={a} size={22} />
                    <span className="cmp-menu__text">
                      <span className="cmp-menu__title">{a.name}</span>
                      <span className="cmp-menu__desc">{a.email}</span>
                    </span>
                    {signatureFor(settings.signatureHtml, a.id) && <span className="cmpx-from-tag">Signature</span>}
                    {a.id === accountId && <Check size={14} className="cmpx-from-check" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <RecipientField
          ref={toRef}
          kind="to"
          label="To"
          value={to}
          onChange={setTo}
          suspects={suspects}
          onDropAddress={moveRecipient}
          onDragActive={onChipDragActive}
          autoFocus={composer.mode === 'new' && !composer.draftId && !composer.init?.to?.length}
          trailing={
            <span className="cmp-field__links">
              {!showCc && <button type="button" tabIndex={-1} className="cmp-link" onClick={() => { focusOnReveal.current = 'cc'; setShowCc(true) }}>Cc</button>}
              {!showBcc && <button type="button" tabIndex={-1} className="cmp-link" onClick={() => { focusOnReveal.current = 'bcc'; setShowBcc(true) }}>Bcc</button>}
            </span>
          }
        />
        {showCc && <RecipientField ref={ccRef} kind="cc" label="Cc" value={cc} onChange={setCc} suspects={suspects} onDropAddress={moveRecipient} onDragActive={onChipDragActive} />}
        {showBcc && <RecipientField ref={bccRef} kind="bcc" label="Bcc" value={bcc} onChange={setBcc} suspects={suspects} onDropAddress={moveRecipient} onDragActive={onChipDragActive} />}

        {(crowd || typos.length > 0) && (
          <div className="cmpx-notes">
            {typos.map((t) => (
              <div key={t.address.email} className="cmpx-note" role="status">
                <AlertTriangle size={13} className="cmpx-note__icon" />
                <span className="cmpx-note__text">
                  <b>{t.typedDomain}</b> looks like a typo of <b>{t.suggestedDomain}</b>
                </span>
                <button type="button" tabIndex={-1} className="cmp-link" onClick={() => fixTypo(t)}>Use {t.suggestedDomain}</button>
                <button type="button" tabIndex={-1} className="cmp-iconbtn" aria-label="Keep as typed" onClick={() => dismissNote(`typo:${t.address.email.toLowerCase()}`)}>
                  <X size={12} />
                </button>
              </div>
            ))}
            {crowd && (
              <div className="cmpx-note" role="status">
                <AlertTriangle size={13} className="cmpx-note__icon" />
                <span className="cmpx-note__text">
                  {crowd.list
                    ? <>This looks like a <b>mailing list</b>; your reply goes to everyone on it.</>
                    : <>Replying to <b>{crowd.count} people</b>.</>}
                </span>
                {replyInfo && replyInfo.senderOnly.length > 0 && (
                  <button type="button" tabIndex={-1} className="cmp-link" onClick={replySenderOnly}>Reply to sender only</button>
                )}
                <button type="button" tabIndex={-1} className="cmp-iconbtn" aria-label="Dismiss" onClick={() => dismissNote('replyall')}>
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
        )}

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
        {editor && <EditorSurface editor={editor} snippets={snippets} snippetContext={snippetContext} onRequestImage={() => imageInput.current?.click()} />}

        {signatureOn && signatureHtml && (
          <div className="cmp__signature" dangerouslySetInnerHTML={{ __html: sanitizeFragment(signatureHtml) }} />
        )}

        {quoted && (
          <div className="cmp__quote">
            <Tooltip label="Show quoted text">
              <button type="button" className="cmp__quote-toggle" aria-expanded={quoteOpen} aria-label="Show quoted text" onClick={() => setQuoteOpen((v) => !v)}>···</button>
            </Tooltip>
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

      {problems && (problems.errors.length > 0 || problems.nudges.length > 0) && (
        <div className={`cmpx-confirm${problems.errors.length ? ' is-error' : ''}`} role="alert">
          <AlertTriangle size={14} className="cmpx-confirm__icon" />
          <span className="cmpx-confirm__text">
            {problems.errors.length ? problems.errors.join(' ') : problems.nudges.map((n) => n.text).join(' ')}
          </span>
          <div className="cmpx-confirm__actions">
            {!problems.errors.length && problems.nudges.some((n) => n.id === 'attachment') && (
              <button type="button" className="cmpx-confirm__btn" onClick={() => { setProblems(null); fileInput.current?.click() }}>Attach a file</button>
            )}
            {!problems.errors.length && problems.nudges.some((n) => n.id === 'subject') && (
              <button type="button" className="cmpx-confirm__btn" onClick={() => { setProblems(null); subjectRef.current?.focus() }}>Add subject</button>
            )}
            {!problems.errors.length && typos[0] && problems.nudges.some((n) => n.id === 'typo') && (
              <button type="button" className="cmpx-confirm__btn" onClick={() => fixTypo(typos[0])}>Use {typos[0].suggestedDomain}</button>
            )}
            {!problems.errors.length && (
              <button type="button" className="cmpx-confirm__btn cmpx-confirm__btn--primary" onClick={() => void doSend()}>
                Send anyway<kbd>⌘↵</kbd>
              </button>
            )}
            <button type="button" className="cmp-iconbtn" aria-label="Dismiss" onClick={() => setProblems(null)}><X size={13} /></button>
          </div>
        </div>
      )}

      <footer className="cmp__toolbar">
        <div className="cmp__tools">
          <Tooltip label="Snippets">
            <button type="button" className="cmp-toolbtn" aria-label="Snippets" onClick={() => setMenu(menu === 'snippets' ? null : 'snippets')}><Braces size={16} /></button>
          </Tooltip>
          <Tooltip label="Attach files">
            <button type="button" className="cmp-toolbtn" aria-label="Attach files" onClick={() => fileInput.current?.click()}><Paperclip size={16} /></button>
          </Tooltip>
          <Tooltip label="Discard draft" shortcut="⌘⇧D">
            <button type="button" className="cmp-toolbtn" aria-label="Discard draft" onClick={discard}><Trash2 size={16} /></button>
          </Tooltip>
          <Tooltip label="Formatting help">
            <button type="button" className="cmp-toolbtn" aria-label="Formatting help" onClick={() => setMenu(menu === 'help' ? null : 'help')}><HelpCircle size={16} /></button>
          </Tooltip>
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
              ['⌘⇧S', 'Strikethrough'], ['⌘E', 'Code'], ['⌘K / ⌘⇧L', 'Link'], [';name', 'Snippet'], ['⌥⌘1–3', 'Headings'],
              ['# ## ###', 'Headings'], ['- or *', 'Bulleted list'], ['1.', 'Numbered list'],
              ['[]', 'To-do'], ['>', 'Quote'], ['```', 'Code block'], ['---', 'Divider'],
              ['⌘↵', 'Send'], ['⌘⇧↵', 'Send & archive'], ['esc', 'Save draft & close']
            ].map(([k, v]) => (
              <div key={k} className="cmp-help__row"><kbd>{k}</kbd><span>{v}</span></div>
            ))}
            <div className="cmp-menu__group">Typing</div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.smartTypography !== false}
              className="cmpx-toggle"
              onClick={() => void useApp.getState().updateSettings({ smartTypography: settings.smartTypography === false })}
            >
              <span>Smart quotes, dashes and ellipsis</span>
              <span className="cmpx-toggle__track" />
            </button>
          </div>
        )}
      </footer>

      <input ref={fileInput} type="file" multiple hidden onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />

      {dragging && <div className="cmp__drop">Drop files to attach</div>}
    </section>
  )
}

/** Profile photo when the provider gave one, otherwise the account colour with an initial. */
function AccountAvatar({ account, size }: { account: { name: string; email: string; color: string; avatarUrl?: string }; size: number }): JSX.Element {
  const [broken, setBroken] = useState(false)
  const initial = (account.name || account.email).charAt(0).toUpperCase()
  return (
    <span
      className="cmpx-from-avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5), background: account.color || `hsl(${avatarHue(account.email)} 45% 45%)` }}
      aria-hidden
    >
      {account.avatarUrl && !broken
        ? <img src={account.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        : initial}
    </span>
  )
}
