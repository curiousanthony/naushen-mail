import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApp } from '@/lib/store'
import { groupShortcuts } from './sheet'
import { Keys } from './Keycaps'
import { Overlay } from './Overlay'
import './commands.css'

/** `?` — searchable, sectioned two-column keycap sheet generated from shortcuts.ts. */
export function ShortcutsHelp(): JSX.Element | null {
  const open = useApp((s) => s.overlay === 'shortcuts')
  return open ? <SheetBody /> : null
}

function SheetBody(): JSX.Element {
  const { t } = useTranslation('commands')
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const close = (): void => useApp.getState().setOverlay(null)
  const sections = useMemo(() => groupShortcuts(query), [query])
  useEffect(() => { inputRef.current?.focus() }, [])

  return (
    <Overlay onClose={close} width={760} top="9vh" label={t('sheet.title')} className="cmd-sheet">
      <div className="cmd-sheet__head">
        <h2 className="cmd-sheet__title">{t('sheet.title')}</h2>
        <button className="cmd-iconbtn" aria-label={t('common.close')} onClick={close}><X size={16} strokeWidth={1.5} /></button>
      </div>
      <div className="cmd-inputrow cmd-inputrow--sm cmd-sheet__search">
        <Search size={16} strokeWidth={1.5} className="cmd-inputrow__icon" />
        <input ref={inputRef} className="cmd-input cmd-input--sm" placeholder={t('sheet.search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('sheet.searchLabel')} />
      </div>
      <div className="cmd-sheet__body">
        {sections.length === 0 && <div className="cmd-empty">{t('sheet.noMatch', { query })}</div>}
        <div className="cmd-sheet__cols">
          {sections.map((g) => (
            <section key={g.section} className="cmd-sheet__section">
              <h3 className="cmd-sheet__sectiontitle">{g.section}</h3>
              {g.items.map((s) => (
                <div key={s.id} className="cmd-sheet__row">
                  <span className="cmd-sheet__label">{s.label}</span>
                  <span className="cmd-sheet__keys">
                    <Keys binding={s.keys[0]} display={s.display} then />
                    {!s.display && s.keys.length > 1 && s.keys[1] !== s.keys[0] && s.id !== 'account.switch' && (
                      <>
                        <span className="cmd-keys__or">{t('sheet.or')}</span>
                        <Keys binding={s.keys.find((k, i) => i > 0 && !['backspace'].includes(k)) ?? s.keys[1]} then />
                      </>
                    )}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
      <div className="cmd-footer cmd-footer--sheet">
        <span>{t('sheet.footer')}</span>
        <span><kbd className="cmd-key cmd-key--word">esc</kbd> {t('common.close')}</span>
      </div>
    </Overlay>
  )
}
