/**
 * Renderer-side orchestration for rules, sender actions and bundle toggles. Everything that
 * changes mail goes through main (`rules.*`, `threads.act`), so it is optimistic, pushed to the
 * provider and undo-able; this file only decides what to ask for and how to word the toast.
 */
import { create } from 'zustand'
import type { Rule, RuleStep } from '@shared/types'
import { describeCondition, subjectOf, suggestRule, type RuleSuggestion } from '@shared/rules'
import { useApp } from '@/lib/store'
import { HANDLERS } from '@/features/commands/runner'
import { bundleId } from '../threadlist/bundles'
import { leadSender } from '../threadlist/bundles'
import { bundlesPatch, readBundles, toggleBundle } from './prefs'
import { summarizeSteps } from './draft'

const S = useApp.getState

// ---------------------------------------------------------------- the rule popover

export interface RuleSeed {
  threadId: string
  accountId: string
  suggestion: RuleSuggestion
  subject: string
}

export const useRuleUi = create<{ seed: RuleSeed | null; open(seed: RuleSeed): void; close(): void }>((set) => ({
  seed: null,
  open: (seed) => set({ seed }),
  close: () => set({ seed: null })
}))

/** `⌘⇧R` / palette: open the rule popover pre-filled from the open or focused thread. */
export async function openRuleForFocused(): Promise<void> {
  const id = S().openThreadId ?? S().focusedId
  if (!id) return
  const t = await window.api.invoke('threads.get', id)
  const me = S().accounts.find((a) => a.id === t?.accountId)?.email ?? ''
  const subject = t ? subjectOf(t.accountId, t.subject, t.messages, me) : null
  const suggestion = t ? suggestRule(subject, t.subject) : null
  if (!t || !suggestion) {
    S().toast({ message: 'This conversation has no incoming message to build a rule from.', duration: 3500 })
    return
  }
  useRuleUi.getState().open({ threadId: t.id, accountId: t.accountId, suggestion, subject: t.subject })
}

export function openRulesSettings(): void {
  try { localStorage.setItem('mailroom.settings.section', 'rules') } catch { /* storage unavailable */ }
  S().setOverlay('settings')
}

// ---------------------------------------------------------------- undo & toasts

/** Undo what a run did, newest change first. */
export async function undoSteps(steps: RuleStep[]): Promise<void> {
  for (const s of steps.slice().reverse()) {
    if (s.inverse) await window.api.invoke('threads.act', s.threadIds, s.inverse)
  }
  await S().refreshThreads()
  await S().refreshMeta()
}

const labelName = (id: string): string | undefined => S().labels.find((l) => l.id === id)?.name

/** Rule ids whose "rules-applied" toast the caller has already shown itself. */
const handled = new Set<string>()
export const markHandled = (ruleId: string): void => { handled.add(ruleId) }

/**
 * Toast for a rule run announced by main. Rules act on mail while you are not looking, so every
 * automatic change says what it did and offers an undo.
 */
export function announceRun(ruleId: string, steps: RuleStep[]): void {
  if (handled.delete(ruleId) || ruleId.startsWith('adhoc:') || !steps.length) return
  const rule = cachedRules.find((r) => r.id === ruleId)
  const who = rule?.conditions[0] ? `${describeCondition(rule.conditions[0])}: ` : 'Rule: '
  S().toast({
    message: who + summarizeSteps(steps, labelName), actionLabel: 'Undo', duration: 9000,
    onAction: () => void undoSteps(steps)
  })
}

let cachedRules: Rule[] = []
export async function refreshRuleCache(): Promise<void> { cachedRules = await window.api.invoke('rules.list') }

// ---------------------------------------------------------------- sender actions (palette)

/** The sender the palette acts on: the focused thread's first participant who is not you. */
export function focusedSender(): { name: string; email: string; accountId: string } | null {
  const s = S()
  const id = s.openThreadId ?? s.focusedId
  const t = s.threads.find((x) => x.id === id)
  if (!t) return null
  const me = new Set(s.accounts.map((a) => a.email.toLowerCase()))
  const sender = leadSender(t, me)
  return sender ? { ...sender, accountId: t.accountId } : null
}

const adhoc = (accountId: string | null, email: string, actions: Rule['actions']): Rule => ({
  id: `adhoc:${crypto.randomUUID()}`, enabled: true, position: 0, accountId, actions,
  conditions: [{ field: 'from', value: email }], createdAt: Date.now()
})

/** Archive every inbox conversation from the sender, with undo. */
export async function archiveAllFrom(email?: string, quiet = false): Promise<RuleStep[] | null> {
  const sender = focusedSender()
  const addr = (email ?? sender?.email)?.toLowerCase()
  if (!sender || !addr) return null
  const rule = adhoc(sender.accountId, addr, [{ type: 'archive' }])
  const res = await window.api.invoke('rules.applyExisting', rule)
  const n = res.threadCount
  if (!quiet) {
    S().toast(n
      ? { message: `Archived ${n} from ${sender.name}`, actionLabel: 'Undo', duration: 9000, onAction: () => void undoSteps(res.steps) }
      : { message: `Nothing in your inbox from ${sender.name}`, duration: 3000 })
  }
  return res.steps
}

/** Route future mail from the sender to Trash (a local rule) and trash what is already here. */
export async function blockSender(email?: string): Promise<void> {
  const sender = focusedSender()
  const addr = (email ?? sender?.email)?.toLowerCase()
  if (!sender || !addr) return
  const existing = await window.api.invoke('rules.list')
  const dup = existing.find((r) => r.accountId === null && r.conditions.length === 1 && r.conditions[0].field === 'from' &&
    r.conditions[0].value.toLowerCase() === addr && r.actions.some((a) => a.type === 'trash'))
  const rule: Rule = dup ?? { ...adhoc(null, addr, [{ type: 'trash' }]), id: crypto.randomUUID() }
  if (!dup) await window.api.invoke('rules.save', rule)
  markHandled(rule.id)
  const res = await window.api.invoke('rules.applyExisting', rule)
  const n = res.threadCount
  await refreshRuleCache()
  S().toast({
    message: `Blocked ${sender.name}${n ? ` · ${n} moved to Trash` : ''}. Future mail goes to Trash.`,
    actionLabel: 'Undo', duration: 9000,
    onAction: () => {
      void undoSteps(res.steps)
      if (!dup) void window.api.invoke('rules.delete', rule.id).then(refreshRuleCache)
    }
  })
}

/** Open the unsubscribe flow for the thread, then archive everything from the sender. */
export async function unsubscribeAndArchive(email?: string): Promise<void> {
  await HANDLERS['thread.unsubscribe']({})
  const steps = await archiveAllFrom(email, true)
  if (steps === null) return
  const n = new Set(steps.flatMap((x) => x.threadIds)).size
  if (n) S().toast({ message: `Archived ${n} from this sender`, actionLabel: 'Undo', duration: 9000, onAction: () => void undoSteps(steps) })
}

// ---------------------------------------------------------------- bundle toggles

export async function toggleLabelBundle(labelId?: string): Promise<void> {
  const l = S().labels.find((x) => x.id === labelId)
  if (!l) return
  const defs = readBundles(S().settings)
  const next = toggleBundle(defs, 'label', l.name, l.name)
  await S().updateSettings(bundlesPatch(next))
  const on = next.length > defs.length
  S().toast({ message: on ? `Bundling ${l.name} in your Inbox` : `Stopped bundling ${l.name}`, duration: 2600 })
}

export async function toggleSenderBundle(email?: string): Promise<void> {
  const sender = focusedSender()
  const addr = (email ?? sender?.email)?.toLowerCase()
  if (!sender || !addr) return
  const defs = readBundles(S().settings)
  const next = toggleBundle(defs, 'sender', addr, sender.name)
  await S().updateSettings(bundlesPatch(next))
  const on = next.length > defs.length
  S().toast({ message: on ? `Bundling ${sender.name} in your Inbox` : `Stopped bundling ${sender.name}`, duration: 2600 })
}

export const isSenderBundled = (email: string): boolean =>
  readBundles(S().settings).some((d) => d.id === bundleId('sender', email))
