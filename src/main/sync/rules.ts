import type { Message, Rule, RuleStep, Thread, ThreadFilter } from '@shared/types'
import { groupSteps, matchRule, planThread, subjectOf, type RuleSubject } from '@shared/rules'
import type { DB } from '../db/db'
import type { Repo } from '../db/repo'

type Row = Record<string, any>

/**
 * Local filter rules. They live in their own table, created with `IF NOT EXISTS` on every start
 * rather than through `SCHEMA_VERSION`: `openDb` only runs the base schema for a database below
 * version 1, so a table added there would never appear for anyone who already has a mailbox.
 */
export class RulesStore {
  constructor(private db: DB) {
    db.exec('CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY, position INTEGER NOT NULL, json TEXT NOT NULL)')
  }

  list(): Rule[] {
    return (this.db.prepare('SELECT position, json FROM rules ORDER BY position, id').all() as Row[])
      .map((r) => ({ ...(JSON.parse(r.json) as Rule), position: r.position as number }))
  }

  save(rule: Rule): Rule {
    const existing = this.db.prepare('SELECT position FROM rules WHERE id = ?').get(rule.id) as Row | undefined
    const max = (this.db.prepare('SELECT COALESCE(MAX(position), -1) m FROM rules').get() as Row).m as number
    const next: Rule = { ...rule, position: existing ? (existing.position as number) : max + 1 }
    this.db.prepare('INSERT INTO rules (id, position, json) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET json = excluded.json')
      .run(next.id, next.position, JSON.stringify(next))
    return next
  }

  delete(id: string): void { this.db.prepare('DELETE FROM rules WHERE id = ?').run(id) }

  /** New run order; ids not listed keep their relative order after the listed ones. */
  reorder(ids: string[]): void {
    const rest = this.list().map((r) => r.id).filter((id) => !ids.includes(id))
    const stmt = this.db.prepare('UPDATE rules SET position = ? WHERE id = ?')
    ;[...ids, ...rest].forEach((id, i) => stmt.run(i, id))
  }
}

// ---------------------------------------------------------------- matching stored mail

const CHUNK = 400

/** Newest-inbound facts for a set of stored threads, in one query per chunk. */
export function subjectsFor(repo: Repo, threads: Thread[]): Map<string, RuleSubject> {
  const out = new Map<string, RuleSubject>()
  const emails = new Map(repo.listAccounts().map((a) => [a.id, a.email]))
  for (let i = 0; i < threads.length; i += CHUNK) {
    const chunk = threads.slice(i, i + CHUNK)
    const rows = repo.db.prepare(
      `SELECT thread_id, from_json, date, is_draft FROM messages WHERE thread_id IN (${chunk.map(() => '?').join(',')})`
    ).all(...chunk.map((t) => t.id)) as Row[]
    const byThread = new Map<string, Pick<Message, 'from' | 'date' | 'isDraft'>[]>()
    for (const r of rows) {
      const list = byThread.get(r.thread_id) ?? []
      list.push({ from: JSON.parse(r.from_json), date: r.date, isDraft: !!r.is_draft })
      byThread.set(r.thread_id, list)
    }
    for (const t of chunk) {
      const s = subjectOf(t.accountId, t.subject, byThread.get(t.id) ?? [], emails.get(t.accountId) ?? '')
      if (s) out.set(t.id, s)
    }
  }
  return out
}

/** Coarse SQL prefilter (LIKE is substring-y); the pure matcher then makes the real decision. */
function prefilter(rule: Pick<Rule, 'accountId' | 'conditions'>): ThreadFilter {
  const f: ThreadFilter = {}
  if (rule.accountId) f.accountIds = [rule.accountId]
  for (const c of rule.conditions) {
    const v = c.value.trim()
    if (!v) continue
    if (c.field === 'from') (f.from ??= []).push(v)
    else if (c.field === 'fromDomain') (f.from ??= []).push(v.replace(/^@/, ''))
    else (f.subjectContains ??= []).push(v)
  }
  return f
}

/**
 * Stored conversations a rule matches. Mail in Trash/Spam is left out (nothing to file), except
 * Spam when the rule is about rescuing it. Capped so a pathological rule cannot stall the app.
 */
export function matchExisting(repo: Repo, rule: Pick<Rule, 'accountId' | 'conditions' | 'actions'>, cap = 5000): Thread[] {
  if (!rule.conditions.length) return []
  const filter = prefilter(rule)
  const roles: ('all' | 'spam')[] = rule.actions.some((a) => a.type === 'neverSpam') ? ['all', 'spam'] : ['all']
  const found: Thread[] = []
  for (const role of roles) {
    const { threads } = repo.listThreads({ filter: { ...filter, role }, limit: cap })
    const subjects = subjectsFor(repo, threads)
    for (const t of threads) {
      const s = subjects.get(t.id)
      if (s && matchRule(rule, s)) found.push(t)
    }
  }
  return found
}

/** Steps that applying `rules` to `threads` would take (pure planning; nothing is changed). */
export function planFor(repo: Repo, rules: Rule[], threads: Thread[]): { ruleId: string; step: RuleStep }[] {
  const subjects = subjectsFor(repo, threads)
  const labelsByAccount = new Map<string, ReturnType<Repo['labelsForAccount']>>()
  const planned = threads.flatMap((t) => {
    const s = subjects.get(t.id)
    if (!s) return []
    let labels = labelsByAccount.get(t.accountId)
    if (!labels) { labels = repo.labelsForAccount(t.accountId); labelsByAccount.set(t.accountId, labels) }
    return planThread(rules, s, t, labels)
  })
  return groupSteps(planned)
}
