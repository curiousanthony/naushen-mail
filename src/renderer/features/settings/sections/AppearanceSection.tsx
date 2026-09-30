import { Monitor, Moon, Sun } from 'lucide-react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import type { AppSettings } from '@shared/types'
import { LANGUAGES, type LanguagePref } from '@shared/languages'
import { useApp } from '@/lib/store'
import { Group, Row, SectionTitle, Segmented, Select, Switch } from '../ui'
import { extPatch, readExt, type Accent, type AutoAdvance, type CountMode, type ThreadStyle } from '../lib/settings-ext'
import { ACCENTS } from '../lib/appearance'
import { readShowListCount, showListCountPatch } from '@/features/threadlist/listPrefs'

/** Names and blurbs are `settings:appearance.threadStyle.<value>.{label,desc}`. */
const STYLES: ThreadStyle[] = ['side', 'center', 'full']

function StylePreview({ kind }: { kind: ThreadStyle }): JSX.Element {
  return (
    <span className={clsx('st-tprev', `st-tprev--${kind}`)} aria-hidden>
      <span className="st-tprev__rows"><i /><i /><i /><i /></span>
      <span className="st-tprev__panel"><b /><em /><em /></span>
    </span>
  )
}

/** Names and blurbs are `settings:appearance.density.<value>.{label,desc}`. */
const DENSITIES: ('comfortable' | 'compact')[] = ['comfortable', 'compact']

function DensityPreview({ kind }: { kind: 'comfortable' | 'compact' }): JSX.Element {
  return (
    <span className={clsx('st-dprev', `st-dprev--${kind}`)} aria-hidden>
      <i /><i /><i /><i />
    </span>
  )
}

export function AppearanceSection(): JSX.Element {
  const { t } = useTranslation('settings')
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  const ext = readExt(settings)
  const set = (patch: Partial<AppSettings>): void => { void update(patch) }

  return (
    <div>
      <SectionTitle title={t('appearance.title')} description={t('appearance.description')} />

      <Group title={t('appearance.groups.appearance')}>
        <Row label={t('appearance.language.label')} description={t('appearance.language.desc')} htmlFor="st-language">
          <Select<LanguagePref> id="st-language" label={t('appearance.language.label')} width={200}
            value={settings.language ?? 'system'} onChange={(language) => set({ language })}
            options={[{ value: 'system', label: t('appearance.language.system') }, ...LANGUAGES.map((l) => ({ value: l.code as LanguagePref, label: l.native }))]} />
        </Row>
        <Row label={t('appearance.theme.label')} description={t('appearance.theme.desc')}>
          <Segmented label={t('appearance.theme.label')} value={settings.theme} onChange={(theme) => set({ theme })} options={[
            { value: 'light', label: t('appearance.theme.light'), icon: <Sun size={14} strokeWidth={1.5} /> },
            { value: 'dark', label: t('appearance.theme.dark'), icon: <Moon size={14} strokeWidth={1.5} /> },
            { value: 'system', label: t('appearance.theme.system'), icon: <Monitor size={14} strokeWidth={1.5} /> }
          ]} />
        </Row>
        <div className="st-tstyle st-tstyle--pair" role="radiogroup" aria-label={t('appearance.density.label')}>
          {DENSITIES.map((v) => (
            <button key={v} type="button" role="radio" aria-checked={settings.density === v}
              className={clsx('st-tstyle__card', settings.density === v && 'is-active')} onClick={() => set({ density: v })}>
              <DensityPreview kind={v} />
              <span className="st-tstyle__label">{t(`appearance.density.${v}.label`)}</span>
              <span className="st-tstyle__desc">{t(`appearance.density.${v}.desc`)}</span>
            </button>
          ))}
        </div>
        <Row label={t('appearance.accent.label')} description={t('appearance.accent.desc')}>
          <div className="st-accents" role="radiogroup" aria-label={t('appearance.accent.label')}>
            {ACCENTS.map((a) => (
              <button key={a.value} type="button" role="radio" aria-checked={ext.accent === a.value} aria-label={t(`appearance.accents.${a.value}`)} title={t(`appearance.accents.${a.value}`)}
                className={clsx('st-accent', ext.accent === a.value && 'is-active')} style={{ '--sw': `var(--sw-${a.value})` } as React.CSSProperties}
                onClick={() => set(extPatch({ accent: a.value as Accent }))} />
            ))}
          </div>
        </Row>
      </Group>

      <Group title={t('appearance.groups.counts')}>
        <Row label={t('appearance.counts.label')} description={t('appearance.counts.desc')}>
          <Segmented<CountMode> label={t('appearance.counts.label')} value={ext.sidebarCountMode} onChange={(sidebarCountMode) => set(extPatch({ sidebarCountMode }))} options={[
            { value: 'cap', label: t('appearance.counts.cap') }, { value: 'exact', label: t('appearance.counts.exact') }
          ]} />
        </Row>
      </Group>

      <Group title={t('appearance.groups.threadStyle')}>
        <div className="st-tstyle" role="radiogroup" aria-label={t('appearance.groups.threadStyle')}>
          {STYLES.map((v) => (
            <button key={v} type="button" role="radio" aria-checked={ext.threadStyle === v}
              className={clsx('st-tstyle__card', ext.threadStyle === v && 'is-active')} onClick={() => set(extPatch({ threadStyle: v }))}>
              <StylePreview kind={v} />
              <span className="st-tstyle__label">{t(`appearance.threadStyle.${v}.label`)}</span>
              <span className="st-tstyle__desc">{t(`appearance.threadStyle.${v}.desc`)}</span>
            </button>
          ))}
        </div>
      </Group>

      <Group title={t('appearance.groups.listTitle')}>
        <Row label={t('appearance.listCount.label')} description={t('appearance.listCount.desc')}>
          <Switch label={t('appearance.listCount.label')} checked={readShowListCount(settings)} onChange={(v) => set(showListCountPatch(v))} />
        </Row>
      </Group>

      <Group title={t('appearance.groups.inbox')}>
        <Row label={t('appearance.groupByDate.label')} description={t('appearance.groupByDate.desc')}><Switch label={t('appearance.groupByDate.label')} checked={settings.groupByDate} onChange={(groupByDate) => set({ groupByDate })} /></Row>
        <Row label={t('appearance.markRead.label')} description={t('appearance.markRead.desc')}><Switch label={t('appearance.markRead.label')} checked={settings.markReadOnOpen} onChange={(markReadOnOpen) => set({ markReadOnOpen })} /></Row>
        <Row label={t('appearance.remoteImages.label')} description={t('appearance.remoteImages.desc')}><Switch label={t('appearance.remoteImages.label')} checked={settings.blockRemoteImages} onChange={(blockRemoteImages) => set({ blockRemoteImages })} /></Row>
        <Row label={t('appearance.hideCategories.label')} description={t('appearance.hideCategories.desc')}>
          <Switch label={t('appearance.hideCategories.label')} checked={!!settings.hideCategoriesFromInbox} onChange={(hideCategoriesFromInbox) => set({ hideCategoriesFromInbox })} />
        </Row>
        <Row label={t('appearance.avatars.label')} description={t('appearance.avatars.desc')}><Switch label={t('appearance.avatars.label')} checked={settings.showAvatars} onChange={(showAvatars) => set({ showAvatars })} /></Row>
        <Row label={t('appearance.swipe.label')} description={t('appearance.swipe.desc')}><Switch label={t('appearance.swipe.label')} checked={ext.swipeGestures} onChange={(swipeGestures) => set(extPatch({ swipeGestures }))} /></Row>
        <Row label={t('appearance.autoAdvance.label')} description={t('appearance.autoAdvance.desc')}>
          <Segmented<AutoAdvance> label={t('appearance.autoAdvance.label')} value={ext.autoAdvance} onChange={(autoAdvance) => set(extPatch({ autoAdvance }))} options={[
            { value: 'next', label: t('appearance.autoAdvance.next') }, { value: 'previous', label: t('appearance.autoAdvance.previous') }, { value: 'close', label: t('appearance.autoAdvance.close') }
          ]} />
        </Row>
      </Group>
    </div>
  )
}
