import { ExternalLink, Mail } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, Group, Row, SectionTitle } from '../ui'
import { docUrl, ISSUES_URL, LICENSE_ID, platformName, providerCtx, REPO, storeKey, usePlatformInfo } from '../lib/project'

const CREDITS = ['Electron', 'React', 'TipTap', 'Zustand', 'Lucide icons', 'date-fns', 'DOMPurify', 'Nodemailer', 'cmdk']

export function AboutSection(): JSX.Element {
  const { t } = useTranslation('settings')
  const info = usePlatformInfo()
  const platform = platformName(info?.platform)
  const links = [
    { id: 'setup', url: docUrl('google-setup.md'), ctx: providerCtx },
    { id: 'decisions', url: docUrl('00-decisions.md'), ctx: {} },
    { id: 'design', url: docUrl('03-design-system.md'), ctx: {} },
    { id: 'privacy', url: docUrl('PRIVACY.md'), ctx: {} },
    { id: 'issues', url: ISSUES_URL, ctx: {} },
    { id: 'source', url: REPO, ctx: {} }
  ]
  return (
    <div>
      <SectionTitle title={t('about.title')} />
      <div className="st-about">
        <span className="st-about__logo"><Mail size={26} strokeWidth={1.5} /></span>
        <div>
          <div className="st-about__name">Naushen Mail</div>
          <div className="st-about__ver">
            {info ? `${t('about.version', { version: info.version })}${platform ? ` · ${platform}` : ''}` : t('about.versionLoading')}
            {` · ${t('about.license', { license: LICENSE_ID })}`}
          </div>
        </div>
      </div>
      <p className="st-muted st-about__blurb">
        {t('about.blurb', { store: t(`store.${storeKey(info?.platform)}`), ...providerCtx })}
      </p>

      <Group title={t('about.docsTitle')}>
        {links.map((l) => (
          <Row key={l.id} label={t(`about.links.${l.id}.label`)} description={t(`about.links.${l.id}.desc`, { ...l.ctx })}>
            <Button size="sm" icon={<ExternalLink size={13} />} onClick={() => void window.api.invoke('app.openExternal', l.url)}>{t('about.open')}</Button>
          </Row>
        ))}
      </Group>

      <Group title={t('about.builtWith')}>
        <div className="st-credits">{CREDITS.map((c) => <span key={c} className="st-pill">{c}</span>)}</div>
        <p className="st-muted st-muted--small">{t('about.openSource')}</p>
      </Group>
    </div>
  )
}
