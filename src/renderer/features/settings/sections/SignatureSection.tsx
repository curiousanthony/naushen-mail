import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { PenLine } from 'lucide-react'
import { useApp } from '@/lib/store'
import { AccountSelect, ConfirmBar, EmptyState, Group, Row, SavedTick, SectionTitle, Switch } from '../ui'
import { RichTextEditor } from './RichTextEditor'
import { useDebouncedCallback, useFlash } from '../lib/hooks'
import { extPatch, readExt } from '../lib/settings-ext'
import { sanitizeSignature } from '../lib/signatureSanitize'
import { renderSignatureTemplate, SIGNATURE_TEMPLATES, type SignaturePreviewKind, type SignatureTemplate } from './signatureTemplates'

/** CSS-only mock of a template's layout — never the template's real HTML (see AppearanceSection's `StylePreview`). */
function TemplatePreview({ kind }: { kind: SignaturePreviewKind }): JSX.Element {
  if (kind === 'photo') {
    return (
      <span className={clsx('st-sig-prev', 'st-sig-prev--photo')} aria-hidden>
        <b />
        <span className="st-sig-prev__lines"><i /><em /></span>
      </span>
    )
  }
  if (kind === 'compact') {
    return (
      <span className={clsx('st-sig-prev', 'st-sig-prev--compact')} aria-hidden>
        <i /><span>·</span><em /><span>·</span><i />
      </span>
    )
  }
  if (kind === 'classic') {
    return (
      <span className={clsx('st-sig-prev', 'st-sig-prev--classic')} aria-hidden>
        <i /><em /><span className="st-sig-prev__rule" /><i />
      </span>
    )
  }
  return (
    <span className={clsx('st-sig-prev', 'st-sig-prev--minimal')} aria-hidden>
      <i /><em />
    </span>
  )
}

export function SignatureSection(): JSX.Element {
  const accounts = useApp((s) => s.accounts)
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [preview, setPreview] = useState('')
  const [saved, flash] = useFlash()
  const currentId = useRef(accountId)

  // A template replaces the editor's content immediately (before the async settings save
  // resolves), so the applied HTML is held locally rather than read back from the store —
  // otherwise the editor would briefly re-render with the *old* signature. `applyTick` forces
  // `RichTextEditor` (uncontrolled) to pick up `overrideHtml` even when the account doesn't change.
  const [overrideHtml, setOverrideHtml] = useState<string | null>(null)
  const [applyTick, setApplyTick] = useState(0)
  const [pendingTemplate, setPendingTemplate] = useState<SignatureTemplate | null>(null)

  useEffect(() => { if (!accounts.some((a) => a.id === accountId)) setAccountId(accounts[0]?.id ?? '') }, [accounts, accountId])
  currentId.current = accountId

  const account = accounts.find((a) => a.id === accountId)
  const stored = settings.signatureHtml[accountId] ?? ''
  const initial = overrideHtml ?? stored
  useEffect(() => {
    setPreview(useApp.getState().settings.signatureHtml[accountId] ?? '')
    setOverrideHtml(null)
    setPendingTemplate(null)
  }, [accountId])

  const save = useDebouncedCallback((id: string, html: string) => {
    const map = { ...useApp.getState().settings.signatureHtml }
    if (html) map[id] = html; else delete map[id]
    void update({ signatureHtml: map }).then(flash)
  }, 600)

  const ext = readExt(settings)
  const previewHtml = useMemo(() => sanitizeSignature(preview), [preview])
  const hasContent = !!previewHtml

  const applyTemplate = (tpl: SignatureTemplate): void => {
    if (!account) return
    const html = sanitizeSignature(renderSignatureTemplate(tpl, account))
    setOverrideHtml(html)
    setApplyTick((t) => t + 1)
    setPreview(html)
    save.call(currentId.current, html)
    save.flush()
    setPendingTemplate(null)
  }

  const pickTemplate = (tpl: SignatureTemplate): void => {
    if (hasContent) setPendingTemplate(tpl); else applyTemplate(tpl)
  }

  if (accounts.length === 0) {
    return (
      <div>
        <SectionTitle title="Signature" />
        <EmptyState icon={<PenLine size={22} strokeWidth={1.5} />} title="No accounts yet">Connect an account first; each account has its own signature.</EmptyState>
      </div>
    )
  }

  return (
    <div>
      <SectionTitle title="Signature" description="Added to the bottom of new messages. Each account has its own signature." />
      <Group>
        {accounts.length > 1 && <Row label="Account"><AccountSelect label="Account" accounts={accounts} value={accountId} onChange={(id) => { save.flush(); setAccountId(id) }} /></Row>}
        <Row label="Include in replies and forwards" description="When off, the signature is only added to new messages.">
          <Switch label="Include signature in replies and forwards" checked={ext.signatureInReplies} onChange={(signatureInReplies) => void update(extPatch({ signatureInReplies }))} />
        </Row>
      </Group>

      <Group title="Templates">
        <p className="st-muted">Start from a common layout, then edit the placeholder text like any other part of the signature.</p>
        <div className="st-sig-gallery" role="list" aria-label="Signature templates">
          {SIGNATURE_TEMPLATES.map((tpl) => (
            <button key={tpl.id} type="button" role="listitem" className="st-sig-card" onClick={() => pickTemplate(tpl)}>
              <TemplatePreview kind={tpl.preview} />
              <span className="st-sig-card__label">{tpl.label}</span>
              <span className="st-sig-card__desc">{tpl.description}</span>
            </button>
          ))}
        </div>
        {pendingTemplate && (
          <ConfirmBar
            message={<>Replace your current signature with <strong>{pendingTemplate.label}</strong>? This can't be undone.</>}
            confirmLabel="Replace"
            onConfirm={() => applyTemplate(pendingTemplate)}
            onCancel={() => setPendingTemplate(null)}
          />
        )}
      </Group>

      <Group title={`Signature${account ? ` for ${account.email}` : ''}`} action={<SavedTick show={saved} />}>
        <RichTextEditor label="Signature" resetKey={`${accountId}:${applyTick}`} initialHtml={initial} placeholder="Write a signature, e.g. your name and title…" minHeight={132}
          sanitize={sanitizeSignature}
          onChange={(html) => { setPreview(html); save.call(currentId.current, html) }} />
      </Group>

      <Group title="Preview">
        <div className="st-sigpreview">
          <div className="st-sigpreview__head">
            <span>To: <strong>Sam Rivera</strong></span>
            <span>Subject: Following up</span>
          </div>
          <div className="st-sigpreview__body selectable">
            <p>Hi Sam,</p>
            <p>Thanks for the quick call today. I’ll send the notes over tomorrow morning.</p>
            {previewHtml
              ? <div className="st-sigpreview__sig" dangerouslySetInnerHTML={{ __html: previewHtml }} />
              : <div className="st-sigpreview__none">No signature</div>}
          </div>
        </div>
      </Group>
    </div>
  )
}
