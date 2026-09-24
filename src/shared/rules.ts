/**
 * Pure rule engine: no I/O, no DOM, no Electron. Used by the sync engine (main) to file newly
 * arrived mail, by the "matches N existing conversations" preview, and by the renderer to
 * pre-fill and describe rules. Rules are local: they are never pushed to Gmail / Outlook.
 */
import type { Label, Message, Rule, RuleAction, RuleCondition, RuleStep, ThreadAction } from './types'

// ---------------------------------------------------------------- what a rule matches against

/** The facts about a thread a rule can see. Built from the newest *inbound* message. */
export interface RuleSubject {
  accountId: string
  subject: string
  /** Lower-cased address of the sender. */
  from: string
}

/** Extract a bare, lower-cased address from "Name <a@b.co>" or "a@b.co". */
export function bareAddress(v: string): string {
  const m = /<([^>]+)>/.exec(v)
  return (m ? m[1] : v).trim().toLowerCase()
}

export const emailDomain = (email: string): string => {
  const at = email.lastIndexOf('@')
  return at < 0 ? '' : email.slice(at + 1).trim().toLowerCase()
}

/** "@Acme.com", " acme.com " -> "acme.com". */
export const bareDomain = (v: string): string => v.trim().replace(/^@/, '').toLowerCase()

/**
 * `ruleDomain` matches the sender's domain when equal, or when the sender is on a subdomain of
 * it (`mail.acme.com` is `acme.com`). `notacme.com` never matches `acme.com`.
 */
export function domainMatches(senderDomain: string, ruleDomain: string): boolean {
  const s = senderDomain.toLowerCase()
  const r = bareDomain(ruleDomain)
  if (!s || !r) return false
  return s === r || s.endsWith(`.${r}`)
}

export function matchCondition(c: RuleCondition, s: RuleSubject): boolean {
  const v = c.value.trim()
  if (!v) return false
  switch (c.field) {
    case 'from': return bareAddress(v) === s.from
    case 'fromDomain': return domainMatches(emailDomain(s.from), v)
    case 'subject': return s.subject.toLowerCase().includes(v.toLowerCase())
  }
}

/** True when the rule is scoped to this account and every condition holds. An empty rule matches nothing. */
export function matchRule(rule: Pick<Rule, 'accountId' | 'conditions'>, s: RuleSubject): boolean {
  if (rule.accountId && rule.accountId !== s.accountId) return false
  return rule.conditions.length > 0 && rule.conditions.every((c) => matchCondition(c, s))
}

/** Enabled rules in run order. */
export const activeRules = (rules: Rule[]): Rule[] =>
  rules.filter((r) => r.enabled).slice().sort((a, b) => a.position - b.position || a.createdAt - b.createdAt)

/**
 * The subject of a thread for matching: its newest inbound (non-draft, not from `me`) message.
 * Null when the thread has none (a thread you only ever sent) so from-rules never file your own mail.
 */
export function subjectOf(accountId: string, threadSubject: string, messages: Pick<Message, 'from' | 'date' | 'isDraft'>[], me: string): RuleSubject | null {
  const mine = me.toLowerCase()
  let best: (typeof messages)[number] | null = null
  for (const m of messages) {
    if (m.isDraft || !m.from.email || m.from.email.toLowerCase() === mine) continue
    if (!best || m.date >= best.date) best = m
  }
  return best ? { accountId, subject: threadSubject, from: best.from.email.toLowerCase() } : null
}

// ---------------------------------------------------------------- turning a rule into concrete changes

/** Current state of a thread, enough to decide which actions would actually change something. */
export interface PlanThread {
  id: string
  accountId: string
  labelIds: string[]
  unread: boolean
  starred: boolean
}

const ACTION_ORDER: RuleAction['type'][] = ['neverSpam', 'label', 'star', 'markRead', 'archive', 'trash']

export const INVERSE: Record<string, ((a: ThreadAction) => ThreadAction) | undefined> = {
  archive: () => ({ type: 'unarchive' }),
  trash: () => ({ type: 'untrash' }),
  notSpam: () => ({ type: 'spam' }),
  markRead: () => ({ type: 'markUnread' }),
  star: () => ({ type: 'unstar' }),
  addLabel: (a) => ({ type: 'removeLabel', labelId: (a as { labelId: string }).labelId })
}

export interface PlannedStep { ruleId: string; threadId: string; action: ThreadAction; inverse: ThreadAction | null }

/**
 * What the given rules would do to one thread, simulating state as it goes so two rules never
 * fight (archive after trash is a no-op) and an action that would change nothing is omitted —
 * which is also what keeps "undo" honest: only real changes get an inverse.
 */
export function planThread(rules: Rule[], subject: RuleSubject, t: PlanThread, labels: Label[]): PlannedStep[] {
  const roleId = (role: string): string | undefined => labels.find((l) => l.role === role)?.id
  const has = (id: string | undefined): boolean => !!id && st.labels.has(id)
  const st = { labels: new Set(t.labelIds), unread: t.unread, starred: t.starred }
  const inbox = roleId('inbox'), spam = roleId('spam'), trash = roleId('trash')
  const out: PlannedStep[] = []
  const push = (ruleId: string, action: ThreadAction): void => {
    const inv = INVERSE[action.type]
    out.push({ ruleId, threadId: t.id, action, inverse: inv ? inv(action) : null })
  }

  for (const rule of activeRules(rules)) {
    if (!matchRule(rule, subject)) continue
    const actions = rule.actions.slice().sort((a, b) => ACTION_ORDER.indexOf(a.type) - ACTION_ORDER.indexOf(b.type))
    for (const a of actions) {
      switch (a.type) {
        case 'neverSpam':
          if (has(spam)) { push(rule.id, { type: 'notSpam' }); st.labels.delete(spam!); if (inbox) st.labels.add(inbox) }
          break
        case 'label': {
          const l = labels.find((x) => x.kind === 'user' && x.name.toLowerCase() === a.name.trim().toLowerCase())
          if (l && !st.labels.has(l.id)) { push(rule.id, { type: 'addLabel', labelId: l.id }); st.labels.add(l.id) }
          break
        }
        case 'star':
          if (!st.starred) { push(rule.id, { type: 'star' }); st.starred = true }
          break
        case 'markRead':
          if (st.unread) { push(rule.id, { type: 'markRead' }); st.unread = false }
          break
        case 'archive':
          if (has(inbox)) { push(rule.id, { type: 'archive' }); st.labels.delete(inbox!) }
          break
        case 'trash':
          if (!has(trash)) { push(rule.id, { type: 'trash' }); if (trash) st.labels.add(trash); if (inbox) st.labels.delete(inbox) }
          break
      }
    }
  }
  return out
}

/** Merge per-thread steps into bulk steps: one entry per (rule, action) with all its threads. */
export function groupSteps(planned: PlannedStep[]): { ruleId: string; step: RuleStep }[] {
  const map = new Map<string, { ruleId: string; step: RuleStep }>()
  for (const p of planned) {
    const key = `${p.ruleId}|${JSON.stringify(p.action)}`
    const cur = map.get(key)
    if (cur) cur.step.threadIds.push(p.threadId)
    else map.set(key, { ruleId: p.ruleId, step: { threadIds: [p.threadId], action: p.action, inverse: p.inverse } })
  }
  return [...map.values()]
}

// ---------------------------------------------------------------- pre-filling & describing rules

/** Domains that host millions of unrelated people; "from domain" there would be a trap. */
const SHARED_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.fr', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.fr',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de', 'orange.fr', 'free.fr',
  'laposte.net', 'wanadoo.fr', 'sfr.fr'
])
export const isSharedDomain = (domain: string): boolean => SHARED_DOMAINS.has(domain.toLowerCase())

/** "Re: Fwd: Your receipt" -> "Your receipt". */
export const stripSubjectPrefixes = (s: string): string => s.replace(/^\s*((re|fwd?|tr|rép|aw|wg)\s*:\s*)+/i, '').trim()

export interface RuleSuggestion {
  from: string
  domain: string
  subject: string
  /** Which condition to start on: the domain, unless it is a shared mailbox provider. */
  field: 'from' | 'fromDomain'
}

export function suggestRule(subject: RuleSubject | null, threadSubject: string): RuleSuggestion | null {
  if (!subject) return null
  const domain = emailDomain(subject.from)
  return {
    from: subject.from, domain, subject: stripSubjectPrefixes(threadSubject),
    field: domain && !isSharedDomain(domain) ? 'fromDomain' : 'from'
  }
}

const ACTION_TEXT = (a: RuleAction): string => {
  switch (a.type) {
    case 'archive': return 'skip the inbox'
    case 'markRead': return 'mark as read'
    case 'star': return 'star'
    case 'trash': return 'move to Trash'
    case 'neverSpam': return 'never send to Spam'
    case 'label': return `label “${a.name}”`
  }
}

export function describeCondition(c: RuleCondition): string {
  switch (c.field) {
    case 'from': return `From ${c.value}`
    case 'fromDomain': return `From @${bareDomain(c.value)}`
    case 'subject': return `Subject contains “${c.value}”`
  }
}

export const describeActions = (actions: RuleAction[]): string => {
  const text = actions.slice().sort((a, b) => ACTION_ORDER.indexOf(a.type) - ACTION_ORDER.indexOf(b.type)).map(ACTION_TEXT).join(', ')
  return text ? text[0].toUpperCase() + text.slice(1) : 'No actions'
}

/** A rule is worth saving only with a non-empty condition and at least one action. */
export const isRuleComplete = (r: Pick<Rule, 'conditions' | 'actions'>): boolean =>
  r.conditions.length > 0 && r.conditions.every((c) => c.value.trim().length > 0) && r.actions.length > 0

/** Same, ignoring identity: does an equivalent rule already exist? (Avoids stacking duplicates from repeated `⌘⇧R`.) */
export function sameRule(a: Rule, b: Pick<Rule, 'accountId' | 'conditions' | 'actions'>): boolean {
  const key = (r: Pick<Rule, 'accountId' | 'conditions' | 'actions'>): string => JSON.stringify([
    r.accountId,
    r.conditions.map((c) => `${c.field}:${c.value.trim().toLowerCase()}`).sort(),
    r.actions.map((x) => JSON.stringify(x)).sort()
  ])
  return key(a) === key(b)
}
