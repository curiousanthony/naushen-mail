import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Rule } from '@shared/types'
import { sameRule } from '@shared/rules'
import { useApp } from '@/lib/store'
import { useFocusTrap } from '@/features/settings/lib/focus-trap'
import { announceRun, markHandled, openRulesSettings, refreshRuleCache, undoSteps, useRuleUi, type RuleSeed } from './actions'
import { draftToRule, isDraftComplete, seedDraft, summarizeSteps, type RuleDraft } from './draft'
import { RuleForm } from './RuleForm'
import './rules.css'

/**
 * Mounted once by App. Owns (a) the "Create rule from this thread" popover and (b) the listener
 * that announces rule runs (new mail filed in the background) as undo-able toasts.
 */
export function RuleHost(): JSX.Element | null {
  const seed = useRuleUi((s) => s.seed)

  useEffect(() => {
    void refreshRuleCache()
    return window.api.onEvent((e) => {
      if (e.type === 'rules-applied') announceRun(e.ruleId, e.steps)
    })
  }, [])

  return seed ? <RulePopover key={seed.threadId} seed={seed} /> : null
}

const WIDTH = 412

function RulePopover({ seed }: { seed: RuleSeed }): JSX.Element {
  const close = useRuleUi((s) => s.close)
  const accounts = useApp((s) => s.accounts)
  const labels = useApp((s) => s.labels)
  const [draft, setDraft] = useState<RuleDraft>(() => seedDraft(seed.suggestion, seed.accountId))
  const [count, setCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useFocusTrap(box)

  const complete = isDraftComplete(draft)
  const candidate = useMemo(() => draftToRule(draft, { id: 'preview', enabled: true, position: 0, createdAt: 0 }), [draft])

  // Sit just under the conversation's row (the popover is "about" that row); centre if it is off-screen.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const h = el.offsetHeight
    const row = document.getElementById(`trow-${seed.threadId}`)?.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight
    if (row && row.bottom > 0 && row.top < vh) {
      const left = Math.max(12, Math.min(vw - WIDTH - 12, row.left + 44))
      const below = row.bottom + 6
      setPos({ left, top: below + h > vh - 12 ? Math.max(12, row.top - h - 6) : below })
    } else {
      setPos({ left: Math.max(12, (vw - WIDTH) / 2), top: Math.max(12, vh * 0.16) })
    }
  }, [seed.threadId, count === null])

  useEffect(() => { input.current?.select() }, [])

  // Live "matches N existing conversations".
  useEffect(() => {
    if (!complete) { setCount(null); return }
    let cancelled = false
    const t = setTimeout(() => {
      void window.api.invoke('rules.preview', { accountId: candidate.accountId, conditions: candidate.conditions, actions: candidate.actions })
        .then((r) => { if (!cancelled) setCount(r.count) })
        .catch(() => { if (!cancelled) setCount(null) })
    }, 180)
    return () => { cancelled = true; clearTimeout(t) }
  }, [complete, candidate])

  const create = async (apply: boolean): Promise<void> => {
    if (!complete || busy) return
    setBusy(true)
    const { toast } = useApp.getState()
    try {
      const existing = await window.api.invoke('rules.list')
      const rule: Rule = draftToRule(draft, { id: crypto.randomUUID(), enabled: true, position: 0, createdAt: Date.now() })
      const dup = existing.find((r) => sameRule(r, rule))
      const saved = dup ?? await window.api.invoke('rules.save', rule)
      await refreshRuleCache()
      close()
      if (apply) {
        markHandled(saved.id)
        const res = await window.api.invoke('rules.applyExisting', saved)
        const steps = res.steps
        toast({
          message: steps.length
            ? `${dup ? 'Rule already existed' : 'Rule created'} · ${summarizeSteps(steps, (id) => useApp.getState().labels.find((l) => l.id === id)?.name)}`
            : `${dup ? 'Rule already existed' : 'Rule created'} · nothing needed changing`,
          actionLabel: steps.length ? 'Undo' : undefined, duration: 9000,
          onAction: steps.length ? () => void undoSteps(steps) : undefined
        })
      } else {
        toast({
          message: dup ? 'You already have this rule' : 'Rule created. It filters new mail on this Mac.',
          actionLabel: 'View rules', onAction: openRulesSettings, duration: 6000
        })
      }
    } catch (e) {
      toast({ message: `Couldn't create the rule${e instanceof Error ? `: ${e.message}` : ''}`, duration: 5000 })
      setBusy(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    // A modal-ish surface: keep j/k/e/… from reaching the list behind it.
    e.nativeEvent.stopPropagation()
    if (e.key === 'Escape') { e.preventDefault(); close(); return }
    if (e.key === 'Enter' && !e.shiftKey && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLSelectElement)) {
      e.preventDefault()
      void create(e.metaKey || e.ctrlKey)
    }
  }

  const countText = !complete ? 'Add a value and an action' : count === null ? 'Checking existing mail…'
    : count === 0 ? 'No existing conversations match' : `Matches ${count} existing conversation${count === 1 ? '' : 's'}`

  return (
    <div className="rp__scrim no-drag" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div
        ref={box} className="rp" role="dialog" aria-label="Create rule" tabIndex={-1} onKeyDown={onKeyDown}
        style={{ width: WIDTH, left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      >
        <div className="rp__head">
          <h2>Create rule</h2>
          <span className="rp__from" title={seed.subject}>from “{seed.subject || '(no subject)'}”</span>
        </div>

        <RuleForm draft={draft} onChange={setDraft} accounts={accounts} labels={labels} suggestion={seed.suggestion} inputRef={input} />

        <div className="rp__match" data-empty={complete && count === 0}>{countText}</div>

        <div className="rp__foot">
          <button type="button" className="rp__btn" onClick={close}>Cancel</button>
          <span className="rp__spacer" />
          <button type="button" className="rp__btn rp__btn--primary" disabled={!complete || busy} onClick={() => void create(false)}>
            Create rule <kbd className="rp__kbd">↵</kbd>
          </button>
          {complete && count !== null && count > 0 && (
            <button type="button" className="rp__btn rp__btn--primary rp__btn--strong" disabled={busy} onClick={() => void create(true)}>
              Create &amp; apply to {count} <kbd className="rp__kbd">⌘↵</kbd>
            </button>
          )}
        </div>
        <p className="rp__note">Local to Naushen Mail: nothing is created in Gmail or Outlook.</p>
      </div>
    </div>
  )
}
