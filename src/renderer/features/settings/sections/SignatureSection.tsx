import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Trans, useTranslation } from 'react-i18next'
import { ImagePlus, PenLine, Trash2, UserRound } from 'lucide-react'
import { useApp } from '@/lib/store'
import { AccountSelect, Button, ConfirmBar, EmptyState, Group, Row, SavedTick, SectionTitle, Switch } from '../ui'
import { RichTextEditor } from './RichTextEditor'
import { useDebouncedCallback, useFlash } from '../lib/hooks'
import { extPatch, readExt } from '../lib/settings-ext'
import { sanitizeSignature } from '../lib/signatureSanitize'
import { cropToSquareDataUri, readSignaturePhoto, writeSignaturePhoto } from '../lib/signaturePhoto'
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
  const { t } = useTranslation('settings')
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
  const [photoErr, setPhotoErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

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

  const photo = useMemo(() => readSignaturePhoto(previewHtml), [previewHtml])

  /** Swap the signature's photo cell and show it live in the editor + preview. */
  const changePhoto = (next: string | null | 'account'): void => {
    if (!account) return
    const html = writeSignaturePhoto(preview, next, account)
    if (html === null) return
    const clean = sanitizeSignature(html)
    setOverrideHtml(clean)
    setApplyTick((t) => t + 1)
    setPreview(clean)
    save.call(currentId.current, clean)
    save.flush()
  }

  const onPickFile = async (file: File | undefined): Promise<void> => {
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    setPhotoErr('')
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') { setPhotoErr(t('signature.photo.badType')); return }
    try { changePhoto(await cropToSquareDataUri(file)) } catch (e) { setPhotoErr(e instanceof Error ? e.message : t('signature.photo.unusable')) }
  }

  const pickTemplate = (tpl: SignatureTemplate): void => {
    if (hasContent) setPendingTemplate(tpl); else applyTemplate(tpl)
  }

  if (accounts.length === 0) {
    return (
      <div>
        <SectionTitle title={t('signature.title')} />
        <EmptyState icon={<PenLine size={22} strokeWidth={1.5} />} title={t('signature.noAccounts')}>{t('signature.noAccountsBody')}</EmptyState>
      </div>
    )
  }

  return (
    <div>
      <SectionTitle title={t('signature.title')} description={t('signature.description')} />
      <Group>
        {accounts.length > 1 && <Row label={t('signature.account')}><AccountSelect label={t('signature.account')} accounts={accounts} value={accountId} onChange={(id) => { save.flush(); setAccountId(id) }} /></Row>}
        <Row label={t('signature.inReplies.label')} description={t('signature.inReplies.desc')}>
          <Switch label={t('signature.inReplies.aria')} checked={ext.signatureInReplies} onChange={(signatureInReplies) => void update(extPatch({ signatureInReplies }))} />
        </Row>
      </Group>

      <Group title={t('signature.templatesTitle')}>
        <p className="st-muted">{t('signature.templatesIntro')}</p>
        <div className="st-sig-gallery" role="list" aria-label={t('signature.templatesAria')}>
          {SIGNATURE_TEMPLATES.map((tpl) => (
            <button key={tpl.id} type="button" role="listitem" className="st-sig-card" onClick={() => pickTemplate(tpl)}>
              <TemplatePreview kind={tpl.preview} />
              <span className="st-sig-card__label">{t(`signature.templates.${tpl.id}.label`)}</span>
              <span className="st-sig-card__desc">{t(`signature.templates.${tpl.id}.description`)}</span>
            </button>
          ))}
        </div>
        {pendingTemplate && (
          <ConfirmBar
            message={<Trans t={t} i18nKey="signature.replaceConfirm" values={{ name: t(`signature.templates.${pendingTemplate.id}.label`) }} components={{ b: <strong /> }} />}
            confirmLabel={t('signature.replace')}
            onConfirm={() => applyTemplate(pendingTemplate)}
            onCancel={() => setPendingTemplate(null)}
          />
        )}
      </Group>

      {photo.kind !== 'none' && account && (
        <Group title={t('signature.photo.title')}>
          <div className="st-sigphoto">
            <span className="st-sigphoto__thumb" aria-hidden>
              {photo.kind === 'image' ? <img src={photo.src} alt="" /> : <UserRound size={22} strokeWidth={1.5} />}
            </span>
            <div className="st-sigphoto__body">
              <p className="st-muted">{photo.kind === 'image' ? t('signature.photo.hasImage') : t('signature.photo.noImage')}</p>
              <div className="st-sigphoto__actions">
                <Button size="sm" icon={<ImagePlus size={13} />} onClick={() => fileRef.current?.click()}>{photo.kind === 'image' ? t('signature.photo.replace') : t('signature.photo.choose')}</Button>
                {account.avatarUrl && photo.kind === 'image' && photo.src !== account.avatarUrl && (
                  <Button size="sm" variant="ghost" onClick={() => changePhoto('account')}>{t('signature.photo.useAccount')}</Button>
                )}
                {account.avatarUrl && photo.kind === 'initials' && (
                  <Button size="sm" variant="ghost" onClick={() => changePhoto('account')}>{t('signature.photo.useAccount')}</Button>
                )}
                {photo.kind === 'image' && <Button size="sm" variant="ghost" className="st-danger-text" icon={<Trash2 size={13} />} onClick={() => changePhoto(null)}>{t('signature.photo.remove')}</Button>}
              </div>
              {photoErr && <div className="st-inline-error" role="alert">{photoErr}</div>}
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => void onPickFile(e.target.files?.[0])} />
          </div>
        </Group>
      )}

      <Group title={account ? t('signature.editorTitleFor', { email: account.email }) : t('signature.title')} action={<SavedTick show={saved} />}>
        <RichTextEditor label={t('signature.title')} resetKey={`${accountId}:${applyTick}`} initialHtml={initial} placeholder={t('signature.placeholder')} minHeight={132}
          sanitize={sanitizeSignature}
          onChange={(html) => { setPreview(html); save.call(currentId.current, html) }} />
      </Group>

      <Group title={t('signature.preview.title')}>
        <div className="st-sigpreview">
          <div className="st-sigpreview__head">
            <span><Trans t={t} i18nKey="signature.preview.to" components={{ b: <strong /> }} /></span>
            <span>{t('signature.preview.subject')}</span>
          </div>
          <div className="st-sigpreview__body selectable">
            <p>{t('signature.preview.greeting')}</p>
            <p>{t('signature.preview.body')}</p>
            {previewHtml
              ? <div className="st-sigpreview__sig" dangerouslySetInnerHTML={{ __html: previewHtml }} />
              : <div className="st-sigpreview__none">{t('signature.preview.none')}</div>}
          </div>
        </div>
      </Group>
    </div>
  )
}
