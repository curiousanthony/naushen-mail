import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Layers, ListFilter, Pencil, Trash2, X } from 'lucide-react'
import type { Rule } from '@shared/types'
import { describeActions, describeCondition, isRuleComplete } from '@shared/rules'
import { useApp } from '@/lib/store'
import { dedupeLabels } from '@/lib/labels'
import { Button, ConfirmBar, EmptyState, Group, IconButton, Row, SectionTitle, Select, Switch } from '@/features/settings/ui'
import { draftToRule, isDraftComplete, ruleToDraft, type RuleDraft } from './draft'
import { RuleForm } from './RuleForm'
import { bundlesPatch, readBundles, toggleBundle } from './prefs'
import { refreshRuleCache } from './actions'
import './rules.css'

/** Settings -> Rules: local filters (list, toggle, edit, reorder, delete) and Inbox bundles. */
export function RulesSection(): JSX.Element {
  const accounts = useApp((s) => s.accounts)
  const labels = useApp((s) => s.labels)
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [editing, setEditing] = useState<{ id: string; draft: RuleDraft } | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)

  const load = useCallback(async () => {
    setRules(await window.api.invoke('rules.list'))
    void refreshRuleCache()
  }, [])
  useEffect(() => { void load() }, [load])

  const save = async (r: Rule): Promise<void> => { await window.api.invoke('rules.save', r); await load() }
  const remove = async (id: string): Promise<void> => {
    await window.api.invoke('rules.delete', id)
    setConfirm(null)
    if (editing?.id === id) setEditing(null)
    await load()
  }
  const move = async (i: number, d: -1 | 1): Promise<void> => {
    if (!rules) return
    const ids = rules.map((r) => r.id)
    const j = i + d
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    await window.api.invoke('rules.reorder', ids)
    await load()
  }

  const acct = (id: string | null): string => (id ? accounts.find((a) => a.id === id)?.email ?? 'Removed account' : 'All accounts')

  const bundles = readBundles(settings)
  const bundleLabelOptions = useMemo(
    () => dedupeLabels(labels.filter((l) => l.kind === 'user'), 'all')
      .filter((l) => !bundles.some((b) => b.kind === 'label' && b.match === l.name.trim().toLowerCase())),
    [labels, bundles]
  )

  return (
    <div>
      <SectionTitle
        title="Rules"
        description="Filters that run on new mail inside Naushen Mail. They are local to this Mac: nothing is created in Gmail or Outlook, and they don't run while the app is closed."
      />

      <Group title="Rules">
        {rules === null ? null : rules.length === 0 ? (
          <EmptyState icon={<ListFilter size={20} strokeWidth={1.5} />} title="No rules yet">
            Open a conversation and press <kbd className="rules__kbd">⌘</kbd><kbd className="rules__kbd">⇧</kbd><kbd className="rules__kbd">R</kbd> to file mail from that sender automatically.
          </EmptyState>
        ) : (
          <ul className="rules__list">
            {rules.map((r, i) => (
              <li key={r.id} className="rules__item" data-off={!r.enabled}>
                <div className="rules__line">
                  <Switch label={`Rule: ${describeCondition(r.conditions[0])}`} checked={r.enabled} onChange={(enabled) => void save({ ...r, enabled })} />
                  <div className="rules__text">
                    <div className="rules__when">
                      {r.conditions.map(describeCondition).join(' and ')}
                    </div>
                    <div className="rules__then">{describeActions(r.actions)} <span className="rules__scope">{acct(r.accountId)}</span></div>
                  </div>
                  <div className="rules__tools">
                    <IconButton label="Move up" disabled={i === 0} onClick={() => void move(i, -1)}><ArrowUp size={14} strokeWidth={1.75} /></IconButton>
                    <IconButton label="Move down" disabled={i === rules.length - 1} onClick={() => void move(i, 1)}><ArrowDown size={14} strokeWidth={1.75} /></IconButton>
                    <IconButton label="Edit rule" onClick={() => setEditing(editing?.id === r.id ? null : { id: r.id, draft: ruleToDraft(r) })}><Pencil size={14} strokeWidth={1.75} /></IconButton>
                    <IconButton label="Delete rule" onClick={() => setConfirm(r.id)}><Trash2 size={14} strokeWidth={1.75} /></IconButton>
                  </div>
                </div>
                {confirm === r.id && (
                  <ConfirmBar message="Delete this rule? Mail already filed stays where it is." confirmLabel="Delete" onCancel={() => setConfirm(null)} onConfirm={() => void remove(r.id)} />
                )}
                {editing?.id === r.id && (
                  <div className="rules__edit">
                    <RuleForm draft={editing.draft} onChange={(draft) => setEditing({ id: r.id, draft })} accounts={accounts} labels={labels} />
                    <div className="rules__editfoot">
                      <Button size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                      <Button
                        size="sm" variant="primary" disabled={!isDraftComplete(editing.draft)}
                        onClick={() => {
                          const next = draftToRule(editing.draft, r)
                          if (!isRuleComplete(next)) return
                          void save(next).then(() => setEditing(null))
                        }}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {rules !== null && rules.length > 1 && <p className="rules__foot">Rules run top to bottom; every matching rule applies.</p>}
      </Group>

      <Group title="Inbox bundles">
        <Row
          label="Collapse low-value mail"
          description="A bundled label or sender becomes one row in your Inbox (for example “Newsletters · 7 new”). Starred mail is never bundled. Nothing is bundled until you add one."
        />
        {bundles.length > 0 && (
          <ul className="rules__list">
            {bundles.map((b) => (
              <li key={b.id} className="rules__item">
                <div className="rules__line">
                  <span className="rules__ico"><Layers size={14} strokeWidth={1.75} /></span>
                  <div className="rules__text">
                    <div className="rules__when">{b.name}</div>
                    <div className="rules__then">{b.kind === 'label' ? 'Label' : 'Sender'}{b.kind === 'sender' && b.match !== b.name.toLowerCase() ? ` · ${b.match}` : ''}</div>
                  </div>
                  <div className="rules__tools">
                    <IconButton label="Stop bundling" onClick={() => void update(bundlesPatch(bundles.filter((x) => x.id !== b.id)))}><X size={14} strokeWidth={1.75} /></IconButton>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {bundleLabelOptions.length > 0 && (
          <Row label="Bundle a label" description="Or right-click a label in the sidebar.">
            <Select
              label="Bundle a label" value="" width={200}
              onChange={(name) => { if (name) void update(bundlesPatch(toggleBundle(bundles, 'label', name, name))) }}
              options={[{ value: '', label: 'Choose a label…' }, ...bundleLabelOptions.map((l) => ({ value: l.name, label: l.name }))]}
            />
          </Row>
        )}
      </Group>
    </div>
  )
}
