import { forwardRef, useRef, useState } from 'react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Check, ChevronRight, Copy, Eye, EyeOff, ExternalLink, KeyRound, Mail, TriangleAlert } from 'lucide-react'
import { OUTLOOK_ENABLED } from '@shared/features'
import { useApp } from '@/lib/store'
import { Button, IconButton, SavedTick, TextInput } from '../ui'
import { useDebouncedCallback, useFlash } from '../lib/hooks'
import { validateGoogleClientId, validateMicrosoftClientId } from '../lib/errors'
import {
  GOOGLE_APP_NAME, GOOGLE_LINKS, GOOGLE_SCOPES, MICROSOFT_ENTRA_URL, microsoftSteps, type GuideStep
} from '../lib/oauth-guide'
import { docUrl, providerCtx } from '../lib/project'

const openExternal = (url: string): void => { void window.api.invoke('app.openExternal', url) }

function Steps({ steps }: { steps: GuideStep[] }): JSX.Element {
  return (
    <ol className="st-steps">
      {steps.map((s, i) => (
        <li key={i}>
          <span>{s.text}</span>
          {s.code && <span className="st-steps__codes">{s.code.map((c) => <code key={c}>{c}</code>)}</span>}
        </li>
      ))}
    </ol>
  )
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: React.ReactNode }): JSX.Element {
  return (
    <div className="st-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? <div className="st-field__msg is-error">{error}</div> : hint ? <div className="st-field__msg">{hint}</div> : null}
    </div>
  )
}

/** One numbered step of the Google setup wizard. */
function WizStep({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }): JSX.Element {
  return (
    <li className={clsx('st-wiz__step', done && 'is-done')}>
      <span className="st-wiz__num" aria-hidden>{done ? <Check size={12} strokeWidth={2.5} /> : n}</span>
      <div className="st-wiz__body">
        <h5>{title}</h5>
        {children}
      </div>
    </li>
  )
}

interface Props {
  open: boolean
  onToggle: (open: boolean) => void
  /** The release build ships a Google client: this panel is then an optional, collapsed "advanced" section. */
  builtIn: boolean
  /** Connect Gmail once the credentials are saved. */
  onConnect?: () => void
  connecting?: boolean
}

export const OAuthSetup = forwardRef<HTMLDivElement, Props>(function OAuthSetup({ open, onToggle, builtIn, onConnect, connecting }, ref) {
  const { t } = useTranslation('settings')
  const oauth = useApp((s) => s.settings.oauth)
  const updateSettings = useApp((s) => s.updateSettings)
  const [draft, setDraft] = useState(oauth)
  const [showSecret, setShowSecret] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [saved, flash] = useFlash()
  const latest = useRef(draft)

  const save = (): Promise<void> => {
    const d = latest.current
    return updateSettings({ oauth: { googleClientId: d.googleClientId.trim(), googleClientSecret: d.googleClientSecret.trim(), microsoftClientId: d.microsoftClientId.trim() } }).then(flash)
  }
  const persist = useDebouncedCallback(() => { void save() }, 600)

  const set = (patch: Partial<typeof draft>): void => {
    const next = { ...latest.current, ...patch }
    latest.current = next
    setDraft(next)
    persist.call()
  }

  const idError = validateGoogleClientId(draft.googleClientId)
  const googleOk = !!draft.googleClientId.trim() && !!draft.googleClientSecret.trim() && !idError
  const msOk = !!draft.microsoftClientId.trim()

  const copy = (key: string, text: string): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600)
    }).catch(() => undefined)
  }
  const CopyBtn = ({ id, text, label }: { id: string; text: string; label: string }): JSX.Element => (
    <Button size="sm" icon={copied === id ? <Check size={13} /> : <Copy size={13} />} onClick={() => copy(id, text)}>{copied === id ? t('oauth.copied') : label}</Button>
  )
  const OpenBtn = ({ url }: { url: string }): JSX.Element => (
    <Button size="sm" icon={<ExternalLink size={13} />} onClick={() => openExternal(url)}>{t('oauth.openConsole')}</Button>
  )

  const connectNow = async (): Promise<void> => {
    persist.flush()
    await save()
    onConnect?.()
  }

  const wizard = (
    <>
      <ol className="st-wiz">
        <WizStep n={1} title={t('oauth.wizard.project.title')}>
          <p>{t('oauth.wizard.project.body')}</p>
          <div className="st-wiz__actions"><OpenBtn url={GOOGLE_LINKS.createProject} /></div>
        </WizStep>
        <WizStep n={2} title={t('oauth.wizard.api.title')}>
          <p>{t('oauth.wizard.api.body')}</p>
          <div className="st-wiz__actions"><OpenBtn url={GOOGLE_LINKS.enableGmail} /></div>
        </WizStep>
        <WizStep n={3} title={t('oauth.wizard.consent.title')}>
          <p>{t('oauth.wizard.consent.body')}</p>
          <div className="st-wiz__actions">
            <OpenBtn url={GOOGLE_LINKS.consent} />
            <CopyBtn id="name" text={GOOGLE_APP_NAME} label={t('oauth.wizard.consent.copyName')} />
          </div>
        </WizStep>
        <WizStep n={4} title={t('oauth.wizard.scopes.title')}>
          <p>{t('oauth.wizard.scopes.body')}</p>
          <span className="st-steps__codes">{GOOGLE_SCOPES.map((s) => <code key={s}>{s}</code>)}</span>
          <div className="st-wiz__actions">
            <OpenBtn url={GOOGLE_LINKS.scopes} />
            <CopyBtn id="scopes" text={GOOGLE_SCOPES.join('\n')} label={t('oauth.wizard.scopes.copy')} />
          </div>
        </WizStep>
        <WizStep n={5} title={t('oauth.wizard.testUser.title')}>
          <p>{t('oauth.wizard.testUser.body')}</p>
          <div className="st-wiz__actions"><OpenBtn url={GOOGLE_LINKS.audience} /></div>
        </WizStep>
        <WizStep n={6} title={t('oauth.wizard.client.title')}>
          <p>{t('oauth.wizard.client.body')}</p>
          <div className="st-wiz__actions"><OpenBtn url={GOOGLE_LINKS.createClient} /></div>
        </WizStep>
        <WizStep n={7} title={t('oauth.wizard.paste.title')} done={googleOk}>
          <p>{t('oauth.wizard.paste.body')}</p>
          <Field id="oauth-gid" label={t('oauth.clientId')} error={idError}>
            <TextInput id="oauth-gid" value={draft.googleClientId} placeholder="1234567890-abc123.apps.googleusercontent.com"
              invalid={!!idError} onChange={(e) => set({ googleClientId: e.target.value })} onBlur={persist.flush} />
          </Field>
          <Field id="oauth-gsecret" label={t('oauth.clientSecret')} hint={t('oauth.secretHint')}>
            <div className="st-input-wrap">
              <TextInput id="oauth-gsecret" type={showSecret ? 'text' : 'password'} value={draft.googleClientSecret} placeholder="GOCSPX-…"
                onChange={(e) => set({ googleClientSecret: e.target.value })} onBlur={persist.flush} />
              <IconButton label={showSecret ? t('oauth.hideSecret') : t('oauth.showSecret')} onClick={() => setShowSecret((v) => !v)}>
                {showSecret ? <EyeOff size={15} strokeWidth={1.5} /> : <Eye size={15} strokeWidth={1.5} />}
              </IconButton>
            </div>
          </Field>
          <div className="st-wiz__actions">
            {onConnect && (
              <Button variant="primary" busy={connecting} disabled={!googleOk} icon={<Mail size={14} />} onClick={() => void connectNow()}>{t('accounts.providers.gmail.title')}</Button>
            )}
            <SavedTick show={saved} />
          </div>
          {onConnect && !googleOk && <p className="st-muted st-muted--small">{t('oauth.wizard.paste.connectHint')}</p>}
        </WizStep>
      </ol>

      <div className="st-callout" role="note">
        <TriangleAlert size={16} strokeWidth={1.5} aria-hidden />
        <div>
          <p><strong>{t('oauth.expiry.title')}</strong></p>
          <p>{t('oauth.expiry.body')}</p>
          <div className="st-wiz__actions"><Button size="sm" icon={<ExternalLink size={13} />} onClick={() => openExternal(GOOGLE_LINKS.audience)}>{t('oauth.expiry.open')}</Button></div>
        </div>
      </div>
    </>
  )

  const microsoft = OUTLOOK_ENABLED && (
    <div className="st-oauth__panel">
      <div className="st-oauth__head">
        <h4>{t('oauth.microsoft.title')}</h4>
        <Button size="sm" icon={<ExternalLink size={13} />} onClick={() => openExternal(MICROSOFT_ENTRA_URL)}>{t('oauth.microsoft.open')}</Button>
      </div>
      <Field id="oauth-mid" label={t('oauth.microsoft.clientId')} error={validateMicrosoftClientId(draft.microsoftClientId)}>
        <TextInput id="oauth-mid" value={draft.microsoftClientId} placeholder="00000000-0000-0000-0000-000000000000"
          invalid={!!validateMicrosoftClientId(draft.microsoftClientId)} onChange={(e) => set({ microsoftClientId: e.target.value })} onBlur={persist.flush} />
      </Field>
      <Steps steps={microsoftSteps()} />
      <p className="st-muted st-muted--small">{t('oauth.microsoft.adminNote')}</p>
    </div>
  )

  const body = (
    <>
      <p className="st-muted">
        {builtIn
          ? t('oauth.introBuiltIn')
          : OUTLOOK_ENABLED ? t('oauth.intro_outlook') : t('oauth.intro')}
      </p>
      {!builtIn && (
        <p className="st-muted st-muted--small">
          <button type="button" className="st-link" onClick={() => openExternal(docUrl('06-provider-setup.md'))}>{t('oauth.guideLink', { ...providerCtx })}</button>
        </p>
      )}
      <div className="st-oauth">
        <div className="st-oauth__panel">
          <div className="st-oauth__head"><h4>{t('oauth.google.title')}</h4></div>
          {wizard}
        </div>
        {microsoft}
      </div>
      {OUTLOOK_ENABLED && <div className="st-oauth__foot"><SavedTick show={saved} /></div>}
    </>
  )

  // Release builds ship a Google client, so this is only an optional "advanced" section there.
  if (!builtIn) {
    return (
      <div ref={ref} className="st-oauthbox">
        <div className="st-oauthbox__head">
          <KeyRound size={16} strokeWidth={1.5} aria-hidden />
          <span className="st-disclosure__title">{t('oauth.wizardTitle')}</span>
          <span className="st-disclosure__meta">
            <span className={clsx('st-pill', googleOk && 'st-pill--ok')}>{googleOk && <Check size={11} strokeWidth={2.5} />}Google</span>
            {OUTLOOK_ENABLED && <span className={clsx('st-pill', msOk && 'st-pill--ok')}>{msOk && <Check size={11} strokeWidth={2.5} />}Microsoft</span>}
          </span>
        </div>
        <div className="st-oauthbox__body">{body}</div>
      </div>
    )
  }

  return (
    <div ref={ref} className={clsx('st-disclosure', open && 'is-open')}>
      <button type="button" className="st-disclosure__head" aria-expanded={open} onClick={() => onToggle(!open)}>
        <ChevronRight className="st-disclosure__chev" size={16} strokeWidth={1.75} aria-hidden />
        <KeyRound size={16} strokeWidth={1.5} aria-hidden />
        <span className="st-disclosure__title">{t('oauth.advancedTitle')}</span>
        <span className="st-disclosure__meta">
          <span className={clsx('st-pill', googleOk && 'st-pill--ok')}>{googleOk && <Check size={11} strokeWidth={2.5} />}Google</span>
          {OUTLOOK_ENABLED && <span className={clsx('st-pill', msOk && 'st-pill--ok')}>{msOk && <Check size={11} strokeWidth={2.5} />}Microsoft</span>}
        </span>
      </button>
      {open && <div className="st-disclosure__body">{body}</div>}
    </div>
  )
})
