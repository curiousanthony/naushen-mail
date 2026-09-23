import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react'
import type { Account, LabelColor } from '@shared/types'
import { LABEL_COLORS } from '@shared/types'

/* ------------------------------------------------------------------ layout */

export function SectionTitle({ title, description }: { title: string; description?: ReactNode }): JSX.Element {
  return (
    <header className="st-title">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </header>
  )
}

export function Group({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <section className="st-group">
      {(title || action) && (
        <div className="st-group__head">
          <h3>{title}</h3>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Row({ label, description, children, htmlFor, stack }: {
  label: ReactNode; description?: ReactNode; children?: ReactNode; htmlFor?: string; stack?: boolean
}): JSX.Element {
  return (
    <div className={clsx('st-row', stack && 'st-row--stack')}>
      <div className="st-row__text">
        <label className="st-row__label" htmlFor={htmlFor}>{label}</label>
        {description && <div className="st-row__desc">{description}</div>}
      </div>
      {children && <div className="st-row__control">{children}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ controls */

type BtnVariant = 'default' | 'primary' | 'danger' | 'ghost'
export function Button({ variant = 'default', size = 'md', busy, icon, children, className, ...rest }: {
  variant?: BtnVariant; size?: 'sm' | 'md'; busy?: boolean; icon?: ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button type="button" {...rest} disabled={rest.disabled || busy}
      className={clsx('st-btn', `st-btn--${variant}`, size === 'sm' && 'st-btn--sm', busy && 'is-busy', className)}>
      {busy ? <Spinner /> : icon}
      {children && <span>{children}</span>}
    </button>
  )
}

export function IconButton({ label, children, className, ...rest }: { label: string; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return <button type="button" aria-label={label} title={label} {...rest} className={clsx('st-icon-btn', className)}>{children}</button>
}

export function Spinner({ size = 14 }: { size?: number }): JSX.Element {
  return <Loader2 className="st-spin" size={size} strokeWidth={2} aria-hidden />
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }): JSX.Element {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      className={clsx('st-switch', checked && 'is-on')} onClick={() => onChange(!checked)}>
      <span className="st-switch__knob" />
    </button>
  )
}

export interface SegOption<T> { value: T; label: string; icon?: ReactNode }
export function Segmented<T extends string | number>({ value, options, onChange, label }: {
  value: T; options: SegOption<T>[]; onChange: (v: T) => void; label: string
}): JSX.Element {
  const onKey = (e: React.KeyboardEvent): void => {
    const i = options.findIndex((o) => o.value === value)
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const next = options[(i + d + options.length) % options.length]
    onChange(next.value)
    ;(e.currentTarget.querySelector(`[data-v="${String(next.value)}"]`) as HTMLElement | null)?.focus()
  }
  return (
    <div className="st-seg" role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} data-v={String(o.value)}
          tabIndex={o.value === value ? 0 : -1} className={clsx('st-seg__opt', o.value === value && 'is-active')} onClick={() => onChange(o.value)}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  )
}

export function Select<T extends string>({ value, options, onChange, label, id, width }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; id?: string; width?: number
}): JSX.Element {
  return (
    <div className="st-select" style={width ? { width } : undefined}>
      <select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronsUpDown size={14} strokeWidth={1.5} aria-hidden />
    </div>
  )
}

export function TextInput({ className, invalid, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }): JSX.Element {
  return <input spellCheck={false} autoComplete="off" {...rest} className={clsx('st-input', invalid && 'is-invalid', className)} />
}

export function SavedTick({ show }: { show: boolean }): JSX.Element {
  return <span className={clsx('st-saved', show && 'is-on')} aria-live="polite"><Check size={13} strokeWidth={2} />Saved</span>
}

/* ------------------------------------------------------------------ account bits */

export function Avatar({ account, size = 32 }: { account: Pick<Account, 'name' | 'email' | 'color'>; size?: number }): JSX.Element {
  const initial = (account.name || account.email || '?').trim().charAt(0).toUpperCase()
  return <span className="st-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.44), background: account.color }} aria-hidden>{initial}</span>
}

export function AccountSelect({ accounts, value, onChange, label }: { accounts: Account[]; value: string; onChange: (id: string) => void; label: string }): JSX.Element {
  return <Select label={label} value={value} onChange={onChange} width={260} options={accounts.map((a) => ({ value: a.id, label: a.email }))} />
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }): JSX.Element {
  return (
    <div className="st-empty">
      <div className="st-empty__icon">{icon}</div>
      <div className="st-empty__title">{title}</div>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

/** Inline destructive confirmation (no modal-on-modal). */
export function ConfirmBar({ message, confirmLabel, onConfirm, onCancel, busy }: {
  message: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void; busy?: boolean
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.querySelector<HTMLElement>('.st-btn--default')?.focus() }, [])
  return (
    <div ref={ref} className="st-confirm" role="alertdialog" aria-label="Confirm"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } }}>
      <div className="st-confirm__msg">{message}</div>
      <div className="st-confirm__actions">
        <Button size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="danger" busy={busy} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ popover + colour picker */

export function Popover({ anchor, onClose, children, width = 200, label }: {
  anchor: HTMLElement | null; onClose: () => void; children: ReactNode; width?: number; label: string
}): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return
    const a = anchor.getBoundingClientRect()
    const h = ref.current.offsetHeight
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, a.left))
    const below = a.bottom + 6
    setPos({ left, top: below + h > window.innerHeight - 8 ? Math.max(8, a.top - h - 6) : below })
  }, [anchor, width])

  useEffect(() => {
    const down = (e: MouseEvent): void => {
      if (ref.current?.contains(e.target as Node) || anchor?.contains(e.target as Node)) return
      onClose()
    }
    const scroll = (): void => onClose()
    window.addEventListener('mousedown', down, true)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', scroll)
    return () => { window.removeEventListener('mousedown', down, true); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', scroll) }
  }, [anchor, onClose])

  if (!anchor) return null
  return createPortal(
    <div ref={ref} role="dialog" aria-label={label} className="st-popover" style={{ width, left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); anchor.focus() } }}>
      {children}
    </div>,
    document.body
  )
}

const COLOR_NAMES: Record<LabelColor, string> = {
  gray: 'Gray', brown: 'Brown', orange: 'Orange', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple', pink: 'Pink', red: 'Red'
}

export function Swatch({ color, size = 14 }: { color?: LabelColor; size?: number }): JSX.Element {
  return <span className="st-swatch" style={{ width: size, height: size, background: `var(--chip-${color ?? 'gray'}-fg)`, boxShadow: `0 0 0 3px var(--chip-${color ?? 'gray'}-bg)` }} />
}

export function ColorPicker({ value, onChange, label = 'Label colour' }: { value?: LabelColor; onChange: (c: LabelColor) => void; label?: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const id = useId()
  return (
    <>
      <button ref={btn} type="button" className={clsx('st-colorbtn', open && 'is-open')} aria-label={`${label}: ${COLOR_NAMES[value ?? 'gray']}`}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <Swatch color={value} />
      </button>
      {open && (
        <Popover anchor={btn.current} label={label} width={176} onClose={() => setOpen(false)}>
          <div className="st-swatches" id={id} role="radiogroup" aria-label={label}>
            {LABEL_COLORS.map((c) => {
              const active = c === (value ?? 'gray')
              return (
                <button key={c} type="button" role="radio" aria-checked={active} autoFocus={active}
                  className={clsx('st-swatches__opt', active && 'is-active')} onClick={() => { onChange(c); setOpen(false); btn.current?.focus() }}>
                  <Swatch color={c} size={12} />
                  <span>{COLOR_NAMES[c]}</span>
                  {active && <Check className="st-swatches__check" size={14} strokeWidth={2} />}
                </button>
              )
            })}
          </div>
        </Popover>
      )}
    </>
  )
}
