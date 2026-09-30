import i18n from 'i18next'
import type { RuleAction, RuleCondition } from '@shared/types'
import { bareDomain } from '@shared/rules'

const t = (key: string, options?: Record<string, unknown>): string => i18n.t(key, { ns: 'rules', ...options }) as string

/** Same ordering as `describeActions` in @shared/rules. */
const ACTION_ORDER: RuleAction['type'][] = ['neverSpam', 'label', 'star', 'markRead', 'archive', 'trash']

/** "From lea@x.com" / "From @x.com" / "Subject contains “…”", in the UI language. */
export function describeCondition(c: RuleCondition): string {
  switch (c.field) {
    case 'from': return t('describe.from', { value: c.value })
    case 'fromDomain': return t('describe.fromDomain', { value: bareDomain(c.value) })
    case 'subject': return t('describe.subject', { value: c.value })
  }
}

const actionText = (a: RuleAction): string =>
  a.type === 'label' ? t('describe.actions.label', { name: a.name }) : t(`describe.actions.${a.type}`)

/** "Label “Receipts”, skip the inbox" */
export function describeActions(actions: RuleAction[]): string {
  const text = actions.slice().sort((a, b) => ACTION_ORDER.indexOf(a.type) - ACTION_ORDER.indexOf(b.type)).map(actionText).join(', ')
  return text ? text[0].toLocaleUpperCase(i18n.language || 'en') + text.slice(1) : t('describe.noActions')
}
