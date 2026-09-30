import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { bindingToKeycaps } from './keys'

const isMac = (): boolean => (typeof navigator !== 'undefined' ? /mac/i.test(navigator.platform || navigator.userAgent) : true)

const SYMBOL = /^[⌘⌃⌥⇧↵↑↓←→⌫⌦⇥]$/

/** Keycaps for one binding (`g i` renders two steps). `display` overrides the caps (e.g. ⌃ 1–9). */
export function Keys({ binding, display, then = false }: { binding?: string; display?: string[][]; then?: boolean }): JSX.Element | null {
  const { t } = useTranslation('commands')
  const steps = display ?? (binding ? bindingToKeycaps(binding, isMac()) : [])
  if (!steps.length) return null
  return (
    <span className="cmd-keys" aria-label={steps.map((s) => s.join(' ')).join(` ${t('keys.then')} `)}>
      {steps.map((caps, i) => (
        <Fragment key={i}>
          {i > 0 && then && <span className="cmd-keys__then">{t('keys.then')}</span>}
          {caps.map((c, j) => <kbd key={j} className={'cmd-key' + (c.length > 1 && !SYMBOL.test(c) ? ' cmd-key--word' : '')}>{c}</kbd>)}
        </Fragment>
      ))}
    </span>
  )
}
