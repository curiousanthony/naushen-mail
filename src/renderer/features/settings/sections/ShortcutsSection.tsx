import { Keyboard } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApp } from '@/lib/store'
import { Button, Group, SectionTitle } from '../ui'

/** Key glyphs are not translated; the action names are `settings:shortcuts.names.<id>`. */
const KEYS: [string, string[]][] = [
  ['commandMenu', ['⌘', 'K']], ['compose', ['C']], ['archive', ['E']], ['reply', ['R']], ['reminder', ['H']],
  ['label', ['L']], ['search', ['/']], ['undo', ['Z']], ['all', ['?']]
]

export function ShortcutsSection(): JSX.Element {
  const { t } = useTranslation('settings')
  const setOverlay = useApp((s) => s.setOverlay)
  return (
    <div>
      <SectionTitle title={t('shortcuts.title')} description={t('shortcuts.description')} />
      <Group>
        <div className="st-keys">
          {KEYS.map(([id, keys]) => (
            <div key={id} className="st-keys__row"><span>{t(`shortcuts.names.${id}`)}</span><span className="st-keys__caps">{keys.map((k) => <kbd key={k}>{k}</kbd>)}</span></div>
          ))}
        </div>
        <div className="st-keys__foot">
          <Button variant="primary" icon={<Keyboard size={14} />} onClick={() => setOverlay('shortcuts')}>{t('shortcuts.viewAll')}</Button>
        </div>
      </Group>
    </div>
  )
}
