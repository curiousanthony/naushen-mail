import { useEffect, useMemo, useRef, useState } from 'react'
import { PenLine } from 'lucide-react'
import { useApp } from '@/lib/store'
import { AccountSelect, EmptyState, Group, Row, SavedTick, SectionTitle, Switch } from '../ui'
import { RichTextEditor } from './RichTextEditor'
import { useDebouncedCallback, useFlash } from '../lib/hooks'
import { extPatch, readExt } from '../lib/settings-ext'
import { sanitizeRich } from '../lib/sanitize'

export function SignatureSection(): JSX.Element {
  const accounts = useApp((s) => s.accounts)
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [preview, setPreview] = useState('')
  const [saved, flash] = useFlash()
  const currentId = useRef(accountId)

  useEffect(() => { if (!accounts.some((a) => a.id === accountId)) setAccountId(accounts[0]?.id ?? '') }, [accounts, accountId])
  currentId.current = accountId

  const account = accounts.find((a) => a.id === accountId)
  const initial = settings.signatureHtml[accountId] ?? ''
  useEffect(() => { setPreview(useApp.getState().settings.signatureHtml[accountId] ?? '') }, [accountId])

  const save = useDebouncedCallback((id: string, html: string) => {
    const map = { ...useApp.getState().settings.signatureHtml }
    if (html) map[id] = html; else delete map[id]
    void update({ signatureHtml: map }).then(flash)
  }, 600)

  const ext = readExt(settings)
  const previewHtml = useMemo(() => sanitizeRich(preview), [preview])

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

      <Group title={`Signature${account ? ` for ${account.email}` : ''}`} action={<SavedTick show={saved} />}>
        <RichTextEditor label="Signature" resetKey={accountId} initialHtml={initial} placeholder="Write a signature, e.g. your name and title…" minHeight={132}
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
