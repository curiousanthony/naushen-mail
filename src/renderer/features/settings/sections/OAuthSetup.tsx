import { forwardRef, useRef, useState } from 'react'
import clsx from 'clsx'
import { Check, ChevronRight, Eye, EyeOff, ExternalLink, KeyRound, TriangleAlert } from 'lucide-react'
import { useApp } from '@/lib/store'
import { Button, IconButton, SavedTick, TextInput } from '../ui'
import { useDebouncedCallback, useFlash } from '../lib/hooks'
import { validateGoogleClientId, validateMicrosoftClientId } from '../lib/errors'
import {
  GOOGLE_CONSOLE_URL, GOOGLE_PUBLISH_NOTE, GOOGLE_STEPS, MICROSOFT_ENTRA_URL, MICROSOFT_STEPS, type GuideStep
} from '../lib/oauth-guide'

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

export const OAuthSetup = forwardRef<HTMLDivElement, { open: boolean; onToggle: (open: boolean) => void }>(function OAuthSetup({ open, onToggle }, ref) {
  const oauth = useApp((s) => s.settings.oauth)
  const updateSettings = useApp((s) => s.updateSettings)
  const [draft, setDraft] = useState(oauth)
  const [showSecret, setShowSecret] = useState(false)
  const [saved, flash] = useFlash()
  const latest = useRef(draft)

  const persist = useDebouncedCallback(() => {
    const d = latest.current
    void updateSettings({ oauth: { googleClientId: d.googleClientId.trim(), googleClientSecret: d.googleClientSecret.trim(), microsoftClientId: d.microsoftClientId.trim() } }).then(flash)
  }, 600)

  const set = (patch: Partial<typeof draft>): void => {
    const next = { ...latest.current, ...patch }
    latest.current = next
    setDraft(next)
    persist.call()
  }

  const googleOk = !!draft.googleClientId.trim() && !!draft.googleClientSecret.trim()
  const msOk = !!draft.microsoftClientId.trim()
  const open_ = (url: string): void => { void window.api.invoke('app.openExternal', url) }

  return (
    <div ref={ref} className={clsx('st-disclosure', open && 'is-open')}>
      <button type="button" className="st-disclosure__head" aria-expanded={open} onClick={() => onToggle(!open)}>
        <ChevronRight className="st-disclosure__chev" size={16} strokeWidth={1.75} aria-hidden />
        <KeyRound size={16} strokeWidth={1.5} aria-hidden />
        <span className="st-disclosure__title">OAuth setup</span>
        <span className="st-disclosure__meta">
          <span className={clsx('st-pill', googleOk && 'st-pill--ok')}>{googleOk && <Check size={11} strokeWidth={2.5} />}Google</span>
          <span className={clsx('st-pill', msOk && 'st-pill--ok')}>{msOk && <Check size={11} strokeWidth={2.5} />}Microsoft</span>
        </span>
      </button>

      {open && (
        <div className="st-disclosure__body">
          <p className="st-muted">
            Mailroom has no backend, so you own the OAuth apps (free, about ten minutes each). These values are stored only on this Mac and are sent
            nowhere except to Google and Microsoft. The demo account works without any of this.
          </p>

          <div className="st-oauth">
            <div className="st-oauth__panel">
              <div className="st-oauth__head">
                <h4>Google (Gmail)</h4>
                <Button size="sm" icon={<ExternalLink size={13} />} onClick={() => open_(GOOGLE_CONSOLE_URL)}>Open Google Cloud Console</Button>
              </div>
              <Field id="oauth-gid" label="Client ID" error={validateGoogleClientId(draft.googleClientId)}>
                <TextInput id="oauth-gid" value={draft.googleClientId} placeholder="1234567890-abc123.apps.googleusercontent.com"
                  invalid={!!validateGoogleClientId(draft.googleClientId)} onChange={(e) => set({ googleClientId: e.target.value })} onBlur={persist.flush} />
              </Field>
              <Field id="oauth-gsecret" label="Client secret" hint="Google treats a desktop-app secret as non-confidential, but the token endpoint still requires it.">
                <div className="st-input-wrap">
                  <TextInput id="oauth-gsecret" type={showSecret ? 'text' : 'password'} value={draft.googleClientSecret} placeholder="GOCSPX-…"
                    onChange={(e) => set({ googleClientSecret: e.target.value })} onBlur={persist.flush} />
                  <IconButton label={showSecret ? 'Hide secret' : 'Show secret'} onClick={() => setShowSecret((v) => !v)}>
                    {showSecret ? <EyeOff size={15} strokeWidth={1.5} /> : <Eye size={15} strokeWidth={1.5} />}
                  </IconButton>
                </div>
              </Field>
              <Steps steps={GOOGLE_STEPS} />
              <div className="st-callout" role="note">
                <TriangleAlert size={16} strokeWidth={1.5} aria-hidden />
                <p>{GOOGLE_PUBLISH_NOTE}</p>
              </div>
            </div>

            <div className="st-oauth__panel">
              <div className="st-oauth__head">
                <h4>Microsoft (Outlook)</h4>
                <Button size="sm" icon={<ExternalLink size={13} />} onClick={() => open_(MICROSOFT_ENTRA_URL)}>Open Microsoft Entra</Button>
              </div>
              <Field id="oauth-mid" label="Application (client) ID" error={validateMicrosoftClientId(draft.microsoftClientId)}>
                <TextInput id="oauth-mid" value={draft.microsoftClientId} placeholder="00000000-0000-0000-0000-000000000000"
                  invalid={!!validateMicrosoftClientId(draft.microsoftClientId)} onChange={(e) => set({ microsoftClientId: e.target.value })} onBlur={persist.flush} />
              </Field>
              <Steps steps={MICROSOFT_STEPS} />
              <p className="st-muted st-muted--small">Work or school tenants may require admin consent for some permissions; personal accounts do not.</p>
            </div>
          </div>
          <div className="st-oauth__foot"><SavedTick show={saved} /></div>
        </div>
      )}
    </div>
  )
})
