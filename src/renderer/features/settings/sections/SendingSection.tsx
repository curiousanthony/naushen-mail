import { useTranslation } from 'react-i18next'
import type { AppSettings } from '@shared/types'
import { useApp } from '@/lib/store'
import { Group, Row, SectionTitle, Segmented, Switch } from '../ui'

export function SendingSection(): JSX.Element {
  const { t } = useTranslation('settings')
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  return (
    <div>
      <SectionTitle title={t('sending.title')} />
      <Group title={t('sending.groups.sending')}>
        <Row label={t('sending.undo.label')} description={t('sending.undo.desc')}>
          <Segmented<AppSettings['undoSendSeconds']> label={t('sending.undo.aria')} value={settings.undoSendSeconds} onChange={(undoSendSeconds) => void update({ undoSendSeconds })} options={[
            { value: 0, label: t('sending.undo.off') }, { value: 5, label: t('sending.undo.seconds', { seconds: 5 }) }, { value: 10, label: t('sending.undo.seconds', { seconds: 10 }) },
            { value: 20, label: t('sending.undo.seconds', { seconds: 20 }) }, { value: 30, label: t('sending.undo.seconds', { seconds: 30 }) }
          ]} />
        </Row>
      </Group>
      <Group title={t('sending.groups.notifications')}>
        <Row label={t('sending.notifications.label')} description={t('sending.notifications.desc')}>
          <Segmented<'off' | 'all' | 'people'> label={t('sending.notifications.label')}
            value={!settings.notifications ? 'off' : settings.notifyScope === 'people' ? 'people' : 'all'}
            onChange={(v) => void update(v === 'off' ? { notifications: false } : { notifications: true, notifyScope: v })}
            options={[{ value: 'off', label: t('sending.notifications.off') }, { value: 'all', label: t('sending.notifications.all') }, { value: 'people', label: t('sending.notifications.people') }]} />
        </Row>
        <Row label={t('sending.dock.label')} description={t('sending.dock.desc')}>
          <Switch label={t('sending.dock.label')} checked={settings.dockBadge !== false} onChange={(dockBadge) => void update({ dockBadge })} />
        </Row>
      </Group>
    </div>
  )
}
