import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Braces, Info, Keyboard, LayoutList, ListFilter, Palette, PenLine, Send, Tag, UserRound, X } from 'lucide-react'
import { useApp } from '@/lib/store'
import { Tooltip } from '@/features/tooltip'
import { Avatar } from './ui'
import { AccountsSection } from './sections/AccountsSection'
import { AppearanceSection } from './sections/AppearanceSection'
import { SignatureSection } from './sections/SignatureSection'
import { SendingSection } from './sections/SendingSection'
import { LabelsSection } from './sections/LabelsSection'
import { ViewsSection } from './sections/ViewsSection'
import { SnippetsSection } from './sections/SnippetsSection'
import { ShortcutsSection } from './sections/ShortcutsSection'
import { AboutSection } from './sections/AboutSection'
import { RulesSection } from '@/features/rules/RulesSection'
import { safeLocalGet, safeLocalSet } from './lib/hooks'
import { useFocusTrap } from './lib/focus-trap'
import './settings.css'

type SectionId = 'accounts' | 'appearance' | 'signature' | 'sending' | 'labels' | 'views' | 'snippets' | 'rules' | 'shortcuts' | 'about'

interface NavItem { id: SectionId; icon: ReactNode; render: () => JSX.Element }
const icon = (I: typeof Palette): ReactNode => <I size={16} strokeWidth={1.5} />

/** Group and item names are translated as `settings:nav.group.<group>` / `settings:nav.<id>`. */
const NAV: { group: 'account' | 'mail' | 'app'; items: NavItem[] }[] = [
  { group: 'account', items: [{ id: 'accounts', icon: icon(UserRound), render: () => <AccountsSection /> }] },
  {
    group: 'mail', items: [
      { id: 'appearance', icon: icon(Palette), render: () => <AppearanceSection /> },
      { id: 'signature', icon: icon(PenLine), render: () => <SignatureSection /> },
      { id: 'sending', icon: icon(Send), render: () => <SendingSection /> },
      { id: 'labels', icon: icon(Tag), render: () => <LabelsSection /> },
      { id: 'views', icon: icon(LayoutList), render: () => <ViewsSection /> },
      { id: 'snippets', icon: icon(Braces), render: () => <SnippetsSection /> },
      { id: 'rules', icon: icon(ListFilter), render: () => <RulesSection /> }
    ]
  },
  {
    group: 'app', items: [
      { id: 'shortcuts', icon: icon(Keyboard), render: () => <ShortcutsSection /> },
      { id: 'about', icon: icon(Info), render: () => <AboutSection /> }
    ]
  }
]
const ALL = NAV.flatMap((g) => g.items)
const SECTION_KEY = 'mailroom.settings.section'

/** Notion-style settings modal. Shown when `useApp().overlay === 'settings'`. */
export function SettingsModal(): JSX.Element | null {
  const open = useApp((s) => s.overlay === 'settings')
  return open ? <SettingsDialog /> : null
}

function SettingsDialog(): JSX.Element {
  const { t } = useTranslation('settings')
  const setOverlay = useApp((s) => s.setOverlay)
  const accounts = useApp((s) => s.accounts)
  const [section, setSection] = useState<SectionId>(() => {
    const saved = safeLocalGet(SECTION_KEY) as SectionId | null
    return saved && ALL.some((i) => i.id === saved) ? saved : 'accounts'
  })
  const dialog = useRef<HTMLDivElement>(null)
  const pane = useRef<HTMLDivElement>(null)

  // Traps Tab/Shift+Tab inside the dialog, focuses the first focusable element on open, and
  // restores focus to whatever opened it when this component unmounts (SettingsModal only
  // mounts SettingsDialog while overlay === 'settings', so mount/unmount tracks open/close).
  useFocusTrap(dialog)
  useEffect(() => { pane.current?.scrollTo({ top: 0 }) }, [section])

  const close = (): void => setOverlay(null)
  const choose = (id: SectionId): void => { setSection(id); safeLocalSet(SECTION_KEY, id) }
  const current = ALL.find((i) => i.id === section) ?? ALL[0]
  const primary = accounts[0]

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') { if (!e.defaultPrevented) { e.preventDefault(); close() } return }
    // Modal: keep global single-key shortcuts (j/k/e/#…) from firing behind the dialog.
    e.nativeEvent.stopPropagation()
  }

  return (
    <div className="st-scrim no-drag" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div ref={dialog} className="st-modal" role="dialog" aria-modal="true" aria-label={t('modal.label')} tabIndex={-1} onKeyDown={onKeyDown}>
        <nav className="st-nav" aria-label={t('modal.sections')}>
          <div className="st-nav__who">
            {primary ? <Avatar account={primary} size={22} /> : <span className="st-nav__who-empty"><UserRound size={14} strokeWidth={1.5} /></span>}
            <span className="st-nav__who-text">
              <strong>{primary ? primary.name || primary.email : 'Naushen Mail'}</strong>
              <span>{accounts.length > 1 ? t('modal.accountCount', { count: accounts.length }) : primary ? primary.email : t('modal.noAccounts')}</span>
            </span>
          </div>
          {NAV.map((g) => (
            <div key={g.group} className="st-nav__group">
              <div className="st-nav__title">{t(`nav.group.${g.group}`)}</div>
              {g.items.map((i) => (
                <button key={i.id} type="button" className={clsx('st-nav__item', i.id === section && 'is-active')} aria-current={i.id === section ? 'page' : undefined} onClick={() => choose(i.id)}>
                  {i.icon}<span>{t(`nav.${i.id}`)}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="st-pane" ref={pane}>
          <Tooltip label={t('modal.close')} shortcut="Esc">
            <button type="button" className="st-close" aria-label={t('modal.closeAria')} onClick={close}><X size={16} strokeWidth={1.75} /></button>
          </Tooltip>
          <div className="st-pane__inner" key={current.id}>{current.render()}</div>
        </div>
      </div>
    </div>
  )
}
