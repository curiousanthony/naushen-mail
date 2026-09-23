import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Braces, Info, Keyboard, LayoutList, Palette, PenLine, Send, Tag, UserRound, X } from 'lucide-react'
import { useApp } from '@/lib/store'
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
import { safeLocalGet, safeLocalSet } from './lib/hooks'
import './settings.css'

type SectionId = 'accounts' | 'appearance' | 'signature' | 'sending' | 'labels' | 'views' | 'snippets' | 'shortcuts' | 'about'

interface NavItem { id: SectionId; label: string; icon: ReactNode; render: () => JSX.Element }
const icon = (I: typeof Palette): ReactNode => <I size={16} strokeWidth={1.5} />

const NAV: { title: string; items: NavItem[] }[] = [
  { title: 'Account', items: [{ id: 'accounts', label: 'Accounts', icon: icon(UserRound), render: () => <AccountsSection /> }] },
  {
    title: 'Mail', items: [
      { id: 'appearance', label: 'Appearance & inbox', icon: icon(Palette), render: () => <AppearanceSection /> },
      { id: 'signature', label: 'Signature', icon: icon(PenLine), render: () => <SignatureSection /> },
      { id: 'sending', label: 'Sending', icon: icon(Send), render: () => <SendingSection /> },
      { id: 'labels', label: 'Labels', icon: icon(Tag), render: () => <LabelsSection /> },
      { id: 'views', label: 'Views', icon: icon(LayoutList), render: () => <ViewsSection /> },
      { id: 'snippets', label: 'Snippets', icon: icon(Braces), render: () => <SnippetsSection /> }
    ]
  },
  {
    title: 'App', items: [
      { id: 'shortcuts', label: 'Keyboard shortcuts', icon: icon(Keyboard), render: () => <ShortcutsSection /> },
      { id: 'about', label: 'About', icon: icon(Info), render: () => <AboutSection /> }
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
  const setOverlay = useApp((s) => s.setOverlay)
  const accounts = useApp((s) => s.accounts)
  const [section, setSection] = useState<SectionId>(() => {
    const saved = safeLocalGet(SECTION_KEY) as SectionId | null
    return saved && ALL.some((i) => i.id === saved) ? saved : 'accounts'
  })
  const dialog = useRef<HTMLDivElement>(null)
  const pane = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<Element | null>(document.activeElement)

  useEffect(() => {
    dialog.current?.focus()
    const prev = previouslyFocused.current as HTMLElement | null
    return () => { prev?.focus?.() }
  }, [])
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
      <div ref={dialog} className="st-modal" role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1} onKeyDown={onKeyDown}>
        <nav className="st-nav" aria-label="Settings sections">
          <div className="st-nav__who">
            {primary ? <Avatar account={primary} size={22} /> : <span className="st-nav__who-empty"><UserRound size={14} strokeWidth={1.5} /></span>}
            <span className="st-nav__who-text">
              <strong>{primary ? primary.name || primary.email : 'Mailroom'}</strong>
              <span>{accounts.length > 1 ? `${accounts.length} accounts` : primary ? primary.email : 'No accounts yet'}</span>
            </span>
          </div>
          {NAV.map((g) => (
            <div key={g.title} className="st-nav__group">
              <div className="st-nav__title">{g.title}</div>
              {g.items.map((i) => (
                <button key={i.id} type="button" className={clsx('st-nav__item', i.id === section && 'is-active')} aria-current={i.id === section ? 'page' : undefined} onClick={() => choose(i.id)}>
                  {i.icon}<span>{i.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="st-pane" ref={pane}>
          <button type="button" className="st-close" aria-label="Close settings" title="Close (Esc)" onClick={close}><X size={16} strokeWidth={1.75} /></button>
          <div className="st-pane__inner" key={current.id}>{current.render()}</div>
        </div>
      </div>
    </div>
  )
}
