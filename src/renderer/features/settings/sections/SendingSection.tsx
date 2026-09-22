import type { AppSettings } from '@shared/types'
import { useApp } from '@/lib/store'
import { Group, Row, SectionTitle, Segmented, Switch } from '../ui'

export function SendingSection(): JSX.Element {
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  return (
    <div>
      <SectionTitle title="Sending & notifications" />
      <Group title="Sending">
        <Row label="Undo send" description="Hold each message for a moment after you press Send, so you can take it back.">
          <Segmented<AppSettings['undoSendSeconds']> label="Undo send delay" value={settings.undoSendSeconds} onChange={(undoSendSeconds) => void update({ undoSendSeconds })} options={[
            { value: 0, label: 'Off' }, { value: 5, label: '5s' }, { value: 10, label: '10s' }, { value: 20, label: '20s' }, { value: 30, label: '30s' }
          ]} />
        </Row>
      </Group>
      <Group title="Notifications">
        <Row label="Desktop notifications" description="Show a macOS notification when new mail arrives in your inbox.">
          <Switch label="Desktop notifications" checked={settings.notifications} onChange={(notifications) => void update({ notifications })} />
        </Row>
      </Group>
    </div>
  )
}
