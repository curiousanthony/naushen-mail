import { useTranslation } from 'react-i18next'
import { useWhichKey } from './store'
import './whichkey.css'

/** Tiny bottom-left "g …" continuation list. Non-interactive; never takes focus. */
export function WhichKey(): JSX.Element | null {
  const { t } = useTranslation('whichkey')
  const v = useWhichKey((s) => s.visible)
  if (!v) return null
  return (
    <div className="wk" role="status" aria-live="polite">
      <div className="wk__prefix">
        {v.prefix.map((p, i) => <kbd key={i} className="cmd-key">{p.toUpperCase()}</kbd>)}
        <span>{t('then')}</span>
      </div>
      <ul className="wk__opts">
        {v.options.map((o) => (
          <li key={o.keys} className="wk__opt"><kbd className="cmd-key">{o.keys.toUpperCase()}</kbd><span>{o.label}</span></li>
        ))}
      </ul>
    </div>
  )
}
