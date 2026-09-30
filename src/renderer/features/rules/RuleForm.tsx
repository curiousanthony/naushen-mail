import { useMemo, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronsUpDown, Tag } from 'lucide-react'
import type { Account, Label, RuleField } from '@shared/types'
import type { RuleSuggestion } from '@shared/rules'
import { dedupeLabels } from '@/lib/labels'
import { TOGGLE_ACTIONS, toggleAction, withField, type RuleDraft } from './draft'
import './rules.css'

/** Segment labels, placeholders and hints are `rules:form.field.<id>.{label,placeholder,hint}`. */
const FIELDS: RuleField[] = ['from', 'fromDomain', 'subject']

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
  const { t } = useTranslation('rules')
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
        <span className="rf__cap">{t('form.whenMailIs')}</span>
        <div className="rf__seg" role="radiogroup" aria-label={t('form.matchOn')}>
          {FIELDS.map((f) => (
            <button
              key={f} type="button" role="radio" aria-checked={draft.field === f}
              className="rf__segopt" data-on={draft.field === f} onClick={() => setField(f)}
            >
              {t(`form.field.${f}.label`)}
            </button>
          ))}
        </div>
      </div>
      <input
        ref={inputRef} className="rf__input" value={draft.value} spellCheck={false} autoComplete="off"
        placeholder={t(`form.field.${draft.field}.placeholder`)} aria-label={t('form.matchValue')}
        onChange={(e) => onChange({ ...draft, value: e.target.value })}
      />
      <p className="rf__hint">
        {t(`form.field.${draft.field}.hint`)}{draft.extra.length > 0 && ` ${t('form.moreConditions', { count: draft.extra.length })}`}
      </p>

      <div className="rf__cap rf__cap--then">{t('form.then')}</div>
      <div className="rf__chips" role="group" aria-label={t('form.actionsAria')}>
        {TOGGLE_ACTIONS.map((a) => (
          <button
            key={a.id} type="button" className="rf__chip" aria-pressed={draft.actions[a.id]}
            data-on={draft.actions[a.id]} onClick={() => onChange(toggleAction(draft, a.id))}
          >
            {draft.actions[a.id] && <Check size={11} strokeWidth={2.5} />}
            {t(`form.actions.${a.id}`)}
          </button>
        ))}
      </div>

      {labelNames.length > 0 && (
        <label className="rf__field">
          <Tag size={13} className="rf__fieldicon" />
          <span>{t('form.applyLabel')}</span>
          <span className="rf__select">
            <select value={draft.label ?? ''} onChange={(e) => onChange({ ...draft, label: e.target.value || null })} aria-label={t('form.applyLabel')}>
              <option value="">{t('form.none')}</option>
              {labelNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <ChevronsUpDown size={12} aria-hidden />
          </span>
        </label>
      )}

      {accounts.length > 1 && (
        <label className="rf__field">
          <span className="rf__fieldicon rf__fieldicon--dot" style={{ background: accounts.find((a) => a.id === draft.accountId)?.color ?? 'var(--c-text-3)' }} />
          <span>{t('form.appliesTo')}</span>
          <span className="rf__select">
            <select value={draft.accountId ?? ''} onChange={(e) => onChange({ ...draft, accountId: e.target.value || null })} aria-label={t('form.appliesTo')}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
              <option value="">{t('form.allAccounts')}</option>
            </select>
            <ChevronsUpDown size={12} aria-hidden />
          </span>
        </label>
      )}
    </div>
  )
}
