import { useEffect, useState } from 'react'
import { ExternalLink, Mail } from 'lucide-react'
import { Button, Group, Row, SectionTitle } from '../ui'

const REPO = 'https://github.com/curiousanthony/mailroom'
const LINKS = [
  { label: 'Provider setup guide', desc: 'Connect Gmail and Outlook', url: `${REPO}/blob/main/docs/06-provider-setup.md` },
  { label: 'Decisions & architecture', desc: 'Stack, trade-offs, definition of done', url: `${REPO}/blob/main/docs/00-decisions.md` },
  { label: 'Design system', desc: 'Tokens, type, motion', url: `${REPO}/blob/main/docs/03-design-system.md` },
  { label: 'Source code', desc: 'Naushen Mail on GitHub', url: REPO }
]
const CREDITS = ['Electron', 'React', 'TipTap', 'Zustand', 'Lucide icons', 'date-fns', 'DOMPurify', 'Nodemailer', 'cmdk']

export function AboutSection(): JSX.Element {
  const [info, setInfo] = useState<{ platform: string; version: string } | null>(null)
  useEffect(() => { void window.api.invoke('app.platform').then(setInfo).catch(() => undefined) }, [])
  const platform = info?.platform === 'darwin' ? 'macOS' : info?.platform ?? ''
  return (
    <div>
      <SectionTitle title="About" />
      <div className="st-about">
        <span className="st-about__logo"><Mail size={26} strokeWidth={1.5} /></span>
        <div>
          <div className="st-about__name">Naushen Mail</div>
          <div className="st-about__ver">{info ? `Version ${info.version}${platform ? ` · ${platform}` : ''}` : 'Version …'}</div>
        </div>
      </div>
      <p className="st-muted st-about__blurb">A calm, keyboard-first desktop mail client for Gmail and Outlook. Your mail is cached on this Mac and account tokens are kept in the macOS Keychain. Naushen Mail has no servers of its own and no AI features.</p>

      <Group title="Documentation">
        {LINKS.map((l) => (
          <Row key={l.url} label={l.label} description={l.desc}>
            <Button size="sm" icon={<ExternalLink size={13} />} onClick={() => void window.api.invoke('app.openExternal', l.url)}>Open</Button>
          </Row>
        ))}
      </Group>

      <Group title="Built with">
        <div className="st-credits">{CREDITS.map((c) => <span key={c} className="st-pill">{c}</span>)}</div>
        <p className="st-muted st-muted--small">Open-source software, used under its own licences.</p>
      </Group>
    </div>
  )
}
