import { Keyboard } from 'lucide-react'
import { useApp } from '@/lib/store'
import { Button, Group, SectionTitle } from '../ui'

const KEYS: [string, string[]][] = [
  ['Command menu', ['⌘', 'K']], ['Compose', ['C']], ['Archive', ['E']], ['Reply', ['R']], ['Set reminder', ['H']],
  ['Label', ['L']], ['Search', ['/']], ['Undo', ['Z']], ['Show all shortcuts', ['?']]
]

export function ShortcutsSection(): JSX.Element {
  const setOverlay = useApp((s) => s.setOverlay)
  return (
    <div>
      <SectionTitle title="Keyboard shortcuts" description="Mailroom is built to be driven from the keyboard. Shortcuts are fixed for now." />
      <Group>
        <div className="st-keys">
          {KEYS.map(([name, keys]) => (
            <div key={name} className="st-keys__row"><span>{name}</span><span className="st-keys__caps">{keys.map((k) => <kbd key={k}>{k}</kbd>)}</span></div>
          ))}
        </div>
        <div className="st-keys__foot">
          <Button variant="primary" icon={<Keyboard size={14} />} onClick={() => setOverlay('shortcuts')}>View all shortcuts</Button>
        </div>
      </Group>
    </div>
  )
}
