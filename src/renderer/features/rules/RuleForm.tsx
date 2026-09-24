import { useMemo, type Ref } from 'react'
import { Check, ChevronsUpDown, Tag } from 'lucide-react'
import type { Account, Label, RuleField } from '@shared/types'
import type { RuleSuggestion } from '@shared/rules'
import { dedupeLabels } from '@/lib/labels'
import { TOGGLE_ACTIONS, toggleAction, withField, type RuleDraft } from './draft'
import './rules.css'

const FIELDS: { id: RuleField; label: string }[] = [
  { id: 'from', label: 'From' },
  { id: 'fromDomain', label: 'Domain' },
  { id: 'subject', label: 'Subject' }
]

const PLACEHOLDER: Record<RuleField, string> = {
  from: 'name@example.com', fromDomain: 'example.com', subject: 'Words in the subject'
}
const HINT: Record<RuleField, string> = {
  from: 'This exact sender.',
  fromDomain: 'Anyone at this domain, including its subdomains.',
  subject: 'Any subject containing this text.'
}

/**
 * The condition -> actions editor shared by the create popover and Settings -> Rules.
 * Compact by design: three segments, one input, toggle chips.
 */
export function RuleForm({ draft, onChange, accounts, labels, suggestion, inputRef }: {
  draft: RuleDraft
  onChange(next: RuleDraft): void
  accounts: Account[]
  labels: Label[]
  /** When present, switching the condition kind re-fills the value from the thread. */
  suggestion?: RuleSuggestion | null
  inputRef?: Ref<HTMLInputElement>
}): JSX.Element {
  // One entry per distinct label name: a rule names its label, and it applies wherever that name exists.
  const labelNames = useMemo(
    () => dedupeLabels(labels.filter((l) => l.kind === 'user'), 'all').map((l) => l.name).sort((a, b) => a.localeCompare(b)),
    [labels]
  )
  const setField = (field: RuleField): void => {
    if (field === draft.field) return
    onChange(suggestion ? withField(draft, field, suggestion) : { ...draft, field })
  }

  return (
    <div className="rf">
      <div className="rf__row">
        <span className="rf__cap">When mail is</span>
        <div className="rf__seg" role="radiogroup" aria-label="Match on">
          {FIELDS.map((f) => (
            <button
              key={f.id} type="button" role="radio" aria-checked={draft.field === f.id}
              className="rf__segopt" data-on={draft.field === f.id} onClick={() => setField(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <input
        ref={inputRef} className="rf__input" value={draft.value} spellCheck={false} autoComplete="off"
        placeholder={PLACEHOLDER[draft.field]} aria-label="Match value"
        onChange={(e) => onChange({ ...draft, value: e.target.value })}
      />
      <p className="rf__hint">
        {HINT[draft.field]}{draft.extra.length > 0 && ` Plus ${draft.extra.length} more condition${draft.extra.length === 1 ? '' : 's'}.`}
      </p>

      <div className="rf__cap rf__cap--then">Then</div>
      <div className="rf__chips" role="group" aria-label="Actions">
        {TOGGLE_ACTIONS.map((a) => (
          <button
            key={a.id} type="button" className="rf__chip" aria-pressed={draft.actions[a.id]}
            data-on={draft.actions[a.id]} onClick={() => onChange(toggleAction(draft, a.id))}
          >
            {draft.actions[a.id] && <Check size={11} strokeWidth={2.5} />}
            {a.label}
          </button>
        ))}
      </div>

      {labelNames.length > 0 && (
        <label className="rf__field">
          <Tag size={13} className="rf__fieldicon" />
          <span>Apply label</span>
          <span className="rf__select">
            <select value={draft.label ?? ''} onChange={(e) => onChange({ ...draft, label: e.target.value || null })} aria-label="Apply label">
              <option value="">None</option>
              {labelNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <ChevronsUpDown size={12} aria-hidden />
          </span>
        </label>
      )}

      {accounts.length > 1 && (
        <label className="rf__field">
          <span className="rf__fieldicon rf__fieldicon--dot" style={{ background: accounts.find((a) => a.id === draft.accountId)?.color ?? 'var(--c-text-3)' }} />
          <span>Applies to</span>
          <span className="rf__select">
            <select value={draft.accountId ?? ''} onChange={(e) => onChange({ ...draft, accountId: e.target.value || null })} aria-label="Applies to">
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
              <option value="">All accounts</option>
            </select>
            <ChevronsUpDown size={12} aria-hidden />
          </span>
        </label>
      )}
    </div>
  )
}
