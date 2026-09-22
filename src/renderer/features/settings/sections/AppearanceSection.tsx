import { Monitor, Moon, Sun } from 'lucide-react'
import clsx from 'clsx'
import type { AppSettings } from '@shared/types'
import { useApp } from '@/lib/store'
import { Group, Row, SectionTitle, Segmented, Switch } from '../ui'
import { extPatch, readExt, type AutoAdvance, type ThreadStyle } from '../lib/settings-ext'

const STYLES: { value: ThreadStyle; label: string; desc: string }[] = [
  { value: 'side', label: 'Side peek', desc: 'Opens from the right, over the list' },
  { value: 'center', label: 'Center peek', desc: 'A centered popup over the list' },
  { value: 'full', label: 'Full page', desc: 'Replaces the list while open' }
]

function StylePreview({ kind }: { kind: ThreadStyle }): JSX.Element {
  return (
    <span className={clsx('st-tprev', `st-tprev--${kind}`)} aria-hidden>
      <span className="st-tprev__rows"><i /><i /><i /><i /></span>
      <span className="st-tprev__panel"><b /><em /><em /></span>
    </span>
  )
}

export function AppearanceSection(): JSX.Element {
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  const ext = readExt(settings)
  const set = (patch: Partial<AppSettings>): void => { void update(patch) }

  return (
    <div>
      <SectionTitle title="Appearance & inbox" description="How Mailroom looks and how the inbox behaves." />

      <Group title="Appearance">
        <Row label="Theme" description="Follow macOS, or pick light or dark. Changes apply immediately.">
          <Segmented label="Theme" value={settings.theme} onChange={(theme) => set({ theme })} options={[
            { value: 'light', label: 'Light', icon: <Sun size={14} strokeWidth={1.5} /> },
            { value: 'dark', label: 'Dark', icon: <Moon size={14} strokeWidth={1.5} /> },
            { value: 'system', label: 'System', icon: <Monitor size={14} strokeWidth={1.5} /> }
          ]} />
        </Row>
        <Row label="Density" description="Row height in the thread list.">
          <Segmented label="Density" value={settings.density} onChange={(density) => set({ density })} options={[
            { value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }
          ]} />
        </Row>
      </Group>

      <Group title="Thread style">
        <div className="st-tstyle" role="radiogroup" aria-label="Thread style">
          {STYLES.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={ext.threadStyle === o.value}
              className={clsx('st-tstyle__card', ext.threadStyle === o.value && 'is-active')} onClick={() => set(extPatch({ threadStyle: o.value }))}>
              <StylePreview kind={o.value} />
              <span className="st-tstyle__label">{o.label}</span>
              <span className="st-tstyle__desc">{o.desc}</span>
            </button>
          ))}
        </div>
      </Group>

      <Group title="Inbox">
        <Row label="Group by date" description="Group threads under Today, Yesterday, Last 7 days and so on."><Switch label="Group by date" checked={settings.groupByDate} onChange={(groupByDate) => set({ groupByDate })} /></Row>
        <Row label="Mark as read when opened" description="A thread becomes read as soon as you open it."><Switch label="Mark as read when opened" checked={settings.markReadOnOpen} onChange={(markReadOnOpen) => set({ markReadOnOpen })} /></Row>
        <Row label="Block remote images" description="Images in email are loaded only when you allow them. Protects against tracking pixels."><Switch label="Block remote images" checked={settings.blockRemoteImages} onChange={(blockRemoteImages) => set({ blockRemoteImages })} /></Row>
        <Row label="Auto-advance" description="Where to go after you archive, trash or snooze the open thread.">
          <Segmented<AutoAdvance> label="Auto-advance" value={ext.autoAdvance} onChange={(autoAdvance) => set(extPatch({ autoAdvance }))} options={[
            { value: 'next', label: 'Next' }, { value: 'previous', label: 'Previous' }, { value: 'close', label: 'Close' }
          ]} />
        </Row>
      </Group>
    </div>
  )
}
