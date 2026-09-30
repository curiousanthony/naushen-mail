/**
 * The rule form's editable shape and its conversion to / from a stored `Rule`. Pure so it is
 * unit-tested; the form (RuleForm.tsx) is a thin view over it.
 */
import i18n from 'i18next'
import type { Rule, RuleAction, RuleCondition, RuleField, RuleStep } from '@shared/types'
import type { RuleSuggestion } from '@shared/rules'
import { isRuleComplete } from '@shared/rules'

export type ToggleAction = 'archive' | 'markRead' | 'star' | 'trash' | 'neverSpam'
/** Chip labels are `rules:form.actions.<id>`. */
export const TOGGLE_ACTIONS: { id: ToggleAction }[] = [
  { id: 'archive' }, { id: 'markRead' }, { id: 'star' }, { id: 'trash' }, { id: 'neverSpam' }
]

export interface RuleDraft {
  field: RuleField
  value: string
  /** Conditions beyond the first are kept untouched when editing a rule made elsewhere. */
  extra: RuleCondition[]
  actions: Record<ToggleAction, boolean>
  /** Label name to apply, or null. */
  label: string | null
  /** null = every account. */
  accountId: string | null
}

const NO_ACTIONS: Record<ToggleAction, boolean> = { archive: false, markRead: false, star: false, trash: false, neverSpam: false }

/** A new rule seeded from a thread: filter mail from the sender, skip the inbox. */
export function seedDraft(s: RuleSuggestion, accountId: string | null): RuleDraft {
  const field = s.field
  return {
    field, value: field === 'fromDomain' ? s.domain : s.from, extra: [],
    actions: { ...NO_ACTIONS, archive: true }, label: null, accountId
  }
}

/** Switch the condition kind and re-fill the value from the thread's own details. */
export function withField(d: RuleDraft, field: RuleField, s: RuleSuggestion): RuleDraft {
  const value = field === 'from' ? s.from : field === 'fromDomain' ? s.domain : s.subject
  return { ...d, field, value }
}

/** Turning Trash on implies skipping the inbox and contradicts "never spam"; the reverse un-trashes. */
export function toggleAction(d: RuleDraft, id: ToggleAction): RuleDraft {
  const on = !d.actions[id]
  const actions = { ...d.actions, [id]: on }
  if (on && id === 'trash') { actions.archive = false; actions.neverSpam = false }
  if (on && (id === 'archive' || id === 'neverSpam')) actions.trash = false
  return { ...d, actions }
}

export function draftToRule(d: RuleDraft, base: Pick<Rule, 'id' | 'enabled' | 'position' | 'createdAt'>): Rule {
  const actions: RuleAction[] = []
  for (const t of TOGGLE_ACTIONS) if (d.actions[t.id]) actions.push({ type: t.id })
  if (d.label) actions.push({ type: 'label', name: d.label })
  return {
    ...base, accountId: d.accountId,
    conditions: [{ field: d.field, value: d.value.trim() }, ...d.extra],
    actions
  }
}

export function ruleToDraft(r: Rule): RuleDraft {
  const [first, ...extra] = r.conditions
  const actions = { ...NO_ACTIONS }
  let label: string | null = null
  for (const a of r.actions) { if (a.type === 'label') label = a.name; else actions[a.type] = true }
  return { field: first?.field ?? 'from', value: first?.value ?? '', extra, actions, label, accountId: r.accountId }
}

export const isDraftComplete = (d: RuleDraft): boolean =>
  isRuleComplete(draftToRule(d, { id: '', enabled: true, position: 0, createdAt: 0 }))

// ---------------------------------------------------------------- what a run did, in words

/** "Archived 4 · Labelled 4 “Receipts”" — the toast after a rule ran. */
export function summarizeSteps(steps: RuleStep[], labelName?: (id: string) => string | undefined): string {
  const t = (key: string, options: Record<string, unknown>): string => i18n.t(key, { ns: 'rules', ...options }) as string
  return steps.map((s) => {
    const count = s.threadIds.length
    switch (s.action.type) {
      case 'archive': return t('summary.archived', { count })
      case 'trash': return t('summary.trashed', { count })
      case 'notSpam': return t('summary.rescued', { count })
      case 'markRead': return t('summary.markedRead', { count })
      case 'star': return t('summary.starred', { count })
      case 'addLabel': return t('summary.labelled', { count, name: labelName?.(s.action.labelId) ?? t('summary.labelFallback', {}) })
      default: return `${s.action.type} ${count}`
    }
  }).join(' · ')
}
