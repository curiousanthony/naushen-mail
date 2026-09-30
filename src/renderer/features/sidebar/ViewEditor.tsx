import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import { LABEL_COLORS, type LabelColor, type SystemRole, type ThreadFilter, type View } from '@shared/types'
import { useApp } from '@/lib/store'
import { colorName, roleName } from '@/lib/labels'
import { Tooltip } from '@/features/tooltip'
import { useViewEditor } from './viewEditorState'
import { accountTags, sidebarLabels } from './lib'
import { VIEW_ICON_KEYS, VIEW_ICONS } from './viewIcons'

const roles = (): { id: SystemRole | 'any'; name: string }[] => [
  { id: 'inbox', name: roleName('inbox') }, { id: 'all', name: i18n.t('sidebar:viewEditor.allMail') },
  { id: 'sent', name: roleName('sent') }, { id: 'drafts', name: roleName('drafts') },
  { id: 'trash', name: roleName('trash') }, { id: 'spam', name: roleName('spam') },
  { id: 'any', name: i18n.t('sidebar:viewEditor.anywhere') }
]

function iconName(key: string): string {
  switch (key) {
    case 'inbox': return i18n.t('sidebar:viewIcon.inbox')
    case 'star': return i18n.t('sidebar:viewIcon.star')
    case 'flag': return i18n.t('sidebar:viewIcon.flag')
    case 'tag': return i18n.t('sidebar:viewIcon.tag')
    case 'users': return i18n.t('sidebar:viewIcon.users')
    case 'send': return i18n.t('sidebar:viewIcon.send')
    case 'receipt': return i18n.t('sidebar:viewIcon.receipt')
    case 'megaphone': return i18n.t('sidebar:viewIcon.megaphone')
    case 'pin': return i18n.t('sidebar:viewIcon.pin')
    case 'message': return i18n.t('sidebar:viewIcon.message')
    case 'newspaper': return i18n.t('sidebar:viewIcon.newspaper')
    case 'flame': return i18n.t('sidebar:viewIcon.flame')
    case 'briefcase': return i18n.t('sidebar:viewIcon.briefcase')
    case 'bell': return i18n.t('sidebar:viewIcon.bell')
    case 'archive': return i18n.t('sidebar:viewIcon.archive')
    case 'heart': return i18n.t('sidebar:viewIcon.heart')
    case 'bookmark': return i18n.t('sidebar:viewIcon.bookmark')
    case 'folder': return i18n.t('sidebar:viewIcon.folder')
    case 'zap': return i18n.t('sidebar:viewIcon.zap')
    default: return key
  }
}

const first = (v?: string[]): string => v?.[0] ?? ''
const list = (v: string): string[] | undefined => (v.trim() ? [v.trim()] : undefined)

/**
 * Create / edit / delete a saved View. Only the fields shown here are rewritten — anything else
 * already on the filter (date range, full-text, starred…) is carried through untouched.
 */
export function ViewEditor(): JSX.Element | null {
  const { t } = useTranslation('sidebar')
  const overlay = useApp((s) => s.overlay)
  const views = useApp((s) => s.views)
  const labels = useApp((s) => s.labels)
  const accounts = useApp((s) => s.accounts)
  const nav = useApp((s) => s.nav)
  const setNav = useApp((s) => s.setNav)
  const refreshMeta = useApp((s) => s.refreshMeta)
  const toast = useApp((s) => s.toast)
  const editingId = useViewEditor((s) => s.viewId)
  const seed = useViewEditor((s) => s.seed)
  const close = useViewEditor((s) => s.close)

  const base = useMemo(() => views.find((v) => v.id === editingId) ?? null, [views, editingId])
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('inbox')
  const [color, setColor] = useState<LabelColor | ''>('')
  const [accountId, setAccountId] = useState('all')
  const [role, setRole] = useState<SystemRole | 'any'>('inbox')
  const [labelIds, setLabelIds] = useState<string[]>([])
  const [from, setFrom] = useState('')
  const [subject, setSubject] = useState('')
  const [unread, setUnread] = useState(false)
  const [attachment, setAttachment] = useState(false)
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const open = overlay === 'view-editor'

  useEffect(() => {
    if (!open) return
    // Editing an existing view: its own saved filter is the only source. Creating one fresh: a
    // caller can seed it (e.g. "Save as view" from the thread list's filter chips); nothing seeds
    // it, and it starts at the Inbox default, same as always.
    const f: ThreadFilter = base?.filter ?? { role: 'inbox' }
    setName(base?.name ?? '')
    setIcon(base?.emoji && base.emoji in VIEW_ICONS ? base.emoji : 'inbox')
    setColor(base?.color ?? '')
    if (base) {
      setAccountId(f.accountIds?.length === 1 ? f.accountIds[0] : 'all')
      setRole(f.role ?? 'any')
      setLabelIds(f.labelIds ?? [])
      setFrom(first(f.from))
      setSubject(first(f.subjectContains))
      setUnread(!!f.unread)
      setAttachment(!!f.hasAttachment)
    } else {
      setAccountId(seed?.accountId ?? 'all')
      setRole(seed?.role ?? 'inbox')
      setLabelIds(seed?.labelIds ?? [])
      setFrom(seed?.from ?? '')
      setSubject('')
      setUnread(!!seed?.unread)
      setAttachment(!!seed?.attachment)
    }
    setBusy(false)
    setTimeout(() => nameRef.current?.select(), 0)
  }, [open, base, seed])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopPropagation(); close() }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  })

  if (!open) return null

  const userLabels = sidebarLabels(labels, accountId)
  const tags = accountTags(accounts)

  async function save(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    const filter: ThreadFilter = { ...(base?.filter ?? {}) }
    // Rewrite only the fields this editor owns.
    delete filter.accountIds; delete filter.role; delete filter.labelIds
    delete filter.from; delete filter.subjectContains; delete filter.unread; delete filter.hasAttachment
    if (accountId !== 'all') filter.accountIds = [accountId]
    if (role !== 'any') filter.role = role
    if (labelIds.length) filter.labelIds = labelIds
    if (list(from)) filter.from = list(from)
    if (list(subject)) filter.subjectContains = list(subject)
    if (unread) filter.unread = true
    if (attachment) filter.hasAttachment = true
    // Criteria this editor has no field for (dates, sizes, reply status...) ride along from "Save as view".
    if (!base && seed?.extra) Object.assign(filter, seed.extra)

    const view: View = {
      id: base?.id ?? crypto.randomUUID(),
      name: trimmed,
      emoji: icon || undefined,
      color: color || undefined,
      filter,
      position: base?.position ?? views.length,
      showInSidebar: base?.showInSidebar ?? true,
      showAsTab: base?.showAsTab ?? false
    }
    await window.api.invoke('views.save', view)
    await refreshMeta()
    close()
    setNav({ kind: 'view', viewId: view.id })
    toast({ message: base ? t('viewEditor.updated') : t('viewEditor.created', { name: trimmed }) })
  }

  async function remove(): Promise<void> {
    if (!base || busy) return
    setBusy(true)
    await window.api.invoke('views.delete', base.id)
    await refreshMeta()
    close()
    if (nav.kind === 'view' && nav.viewId === base.id) setNav({ kind: 'role', role: 'inbox' })
    toast({ message: t('viewEditor.deleted', { name: base.name }) })
  }

  return (
    <div className="ve__scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="ve" role="dialog" aria-modal="true" aria-label={base ? t('editView') : t('newView')}>
        <header className="ve__head">
          <h2>{base ? t('editView') : t('newView')}</h2>
          <p>{t('viewEditor.intro')}</p>
        </header>

        <div className="ve__body">
          <div className="ve__namerow">
            <span className="ve__emoji" aria-hidden>
              {(() => { const Icon = VIEW_ICONS[icon] ?? VIEW_ICONS.inbox; return <Icon size={16} /> })()}
            </span>
            <input
              ref={nameRef} className="ve__name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder={t('viewEditor.name')} aria-label={t('viewEditor.name')} autoFocus
            />
          </div>

          <label className="ve__label">{t('viewEditor.icon')}</label>
          <div className="ve__emojis">
            {VIEW_ICON_KEYS.map((key) => {
              const Icon = VIEW_ICONS[key]
              return (
                <Tooltip key={key} label={iconName(key)}>
                  <button className="ve__emojibtn" data-on={key === icon} onClick={() => setIcon(key)} aria-label={iconName(key)}>
                    <Icon size={15} />
                  </button>
                </Tooltip>
              )
            })}
          </div>

          <label className="ve__label">{t('viewEditor.colour')}</label>
          <div className="ve__colors">
            <Tooltip label={t('viewEditor.noColour')}>
              <button className="ve__swatch" data-on={color === ''} onClick={() => setColor('')} aria-label={t('viewEditor.noColour')}>
                <span className="ve__swatchdot ve__swatchdot--none" />
              </button>
            </Tooltip>
            {LABEL_COLORS.map((c) => (
              <Tooltip key={c} label={colorName(c)}>
                <button className="ve__swatch" data-on={color === c} onClick={() => setColor(c)} aria-label={colorName(c)}>
                  <span className="ve__swatchdot" style={{ background: `var(--chip-${c}-fg)` }} />
                </button>
              </Tooltip>
            ))}
          </div>

          <label className="ve__label">{t('viewEditor.filters')}</label>
          <div className="ve__grid">
            <span>{t('viewEditor.account')}</span>
            <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setLabelIds([]) }} aria-label={t('viewEditor.account')}>
              <option value="all">{t('accounts.all')}</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
            </select>

            <span>{t('viewEditor.mailbox')}</span>
            <select value={role} onChange={(e) => setRole(e.target.value as SystemRole | 'any')} aria-label={t('viewEditor.mailbox')}>
              {roles().map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>

            <span>{t('viewEditor.from')}</span>
            <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder={t('viewEditor.fromPlaceholder')} aria-label={t('viewEditor.fromContains')} />

            <span>{t('viewEditor.subject')}</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t('viewEditor.subjectPlaceholder')} aria-label={t('viewEditor.subjectContains')} />
          </div>

          <div className="ve__checks">
            <button className="ve__check" data-on={unread} onClick={() => setUnread(!unread)} role="checkbox" aria-checked={unread}>
              <span className="ve__box">{unread && <Check size={12} strokeWidth={3} />}</span> {t('viewEditor.unreadOnly')}
            </button>
            <button className="ve__check" data-on={attachment} onClick={() => setAttachment(!attachment)} role="checkbox" aria-checked={attachment}>
              <span className="ve__box">{attachment && <Check size={12} strokeWidth={3} />}</span> {t('viewEditor.hasAttachment')}
            </button>
          </div>

          {userLabels.length > 0 && (
            <>
              <label className="ve__label">{t('viewEditor.labels')}</label>
              <div className="ve__labels">
                {userLabels.map((l) => {
                  const on = labelIds.includes(l.id)
                  return (
                    <button
                      key={l.id} className="ve__labelchip" data-on={on} role="checkbox" aria-checked={on}
                      onClick={() => setLabelIds(on ? labelIds.filter((x) => x !== l.id) : [...labelIds, l.id])}
                    >
                      <span className="dot" style={{ background: `var(--chip-${l.color ?? 'gray'}-fg)` }} />
                      {l.name}
                      {accountId === 'all' && accounts.length > 1 && (
                        <span className="ve__labelacct">{tags[l.accountId]}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>

        <footer className="ve__foot">
          {base && base.id !== 'view-inbox' && (
            <button className="ve__btn ve__btn--danger" onClick={() => void remove()} disabled={busy}>
              <Trash2 size={14} /> {t('viewEditor.delete')}
            </button>
          )}
          <span className="ve__spacer" />
          <button className="ve__btn" onClick={close}>{t('common:actions.cancel')}</button>
          <button className="ve__btn ve__btn--primary" onClick={() => void save()} disabled={!name.trim() || busy}>
            {base ? t('common:actions.save') : t('viewEditor.create')}
          </button>
        </footer>
      </div>
    </div>
  )
}
