import { useEffect, useMemo, useState } from 'react'
import { Command } from 'cmdk'
import { Archive, CornerDownLeft, FolderInput, Inbox, ShieldAlert, Trash2 } from 'lucide-react'
import type { Thread } from '@shared/types'
import { useApp } from '@/lib/store'
import { filterRank } from '@/features/commands/filter'
import { targetThreads } from '@/features/commands/runner'
import { Overlay } from '@/features/commands/Overlay'
import { accountTags, ambiguousLabelNames } from '@/features/sidebar/lib'
import { moveThreads } from './move'
import { planMove, type Dest } from './plan'
import '@/features/commands/commands.css'

interface Opt { key: string; name: string; dest: Dest; icon?: typeof Inbox; color?: string; hint?: string; keywords?: string[] }

/** "Move to…" picker, `v`: folders and labels, fuzzy, Enter moves (and leaves the inbox). */
export function MovePicker(): JSX.Element | null {
  const open = useApp((s) => s.overlay === 'move-picker')
  return open ? <MoveBody /> : null
}

function MoveBody(): JSX.Element {
  const close = (): void => useApp.getState().setOverlay(null)
  const labels = useApp((s) => s.labels)
  const accounts = useApp((s) => s.accounts)
  const nav = useApp((s) => s.nav)
  const { ids, threads: known } = targetThreads()
  const [fetched, setFetched] = useState<Thread[]>([])
  const [query, setQuery] = useState('')

  // The open thread may not be in the visible list (opened from search); fetch what is missing.
  const missing = ids.filter((i) => !known.some((t) => t.id === i))
  useEffect(() => {
    if (!missing.length) return
    let dead = false
    void Promise.all(missing.map((i) => window.api.invoke('threads.get', i))).then((r) => { if (!dead) setFetched(r.filter((t): t is NonNullable<typeof t> => !!t)) })
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing.join('|')])
  const threads = useMemo(() => [...known, ...fetched], [known, fetched])

  const opts = useMemo<Opt[]>(() => {
    const accIds = new Set(threads.map((t) => t.accountId))
    const userLabels = labels
      .filter((l) => l.kind === 'user' && accIds.has(l.accountId))
      .sort((a, b) => a.name.localeCompare(b.name) || a.accountId.localeCompare(b.accountId))
    const dup = ambiguousLabelNames(userLabels)
    const tags = accountTags(accounts)
    const navRole = nav.kind === 'role' ? nav.role : null
    const folders: Opt[] = [
      { key: 'inbox', name: 'Inbox', dest: { kind: 'inbox' }, icon: Inbox, keywords: ['unarchive'] },
      { key: 'archive', name: 'Archive', dest: { kind: 'archive' }, icon: Archive, keywords: ['done', 'all mail'] },
      { key: 'trash', name: 'Trash', dest: { kind: 'trash' }, icon: Trash2, keywords: ['delete', 'bin'] },
      { key: 'spam', name: 'Spam', dest: { kind: 'spam' }, icon: ShieldAlert, keywords: ['junk'] }
    ]
    const lab: Opt[] = userLabels.map((l) => ({
      key: `label:${l.id}`, name: l.name, dest: { kind: 'label', labelId: l.id, accountId: l.accountId },
      color: l.color ?? 'gray', hint: dup.has(l.name) || accIds.size > 1 ? tags[l.accountId] : undefined
    }))
    // Hide folders that would change nothing for every target (you are already there).
    return [...folders, ...lab].filter((o) => planMove(threads, o.dest, labels, navRole).apply.length > 0)
  }, [threads, labels, accounts, nav])

  const q = query.trim()
  const shown = filterRank(opts, q, (o) => ({ label: o.name, keywords: o.keywords }))

  const choose = (o: Opt): void => {
    close()
    void moveThreads(threads, o.dest)
  }

  return (
    <Overlay onClose={close} width={340} top="16vh" label="Move conversation" className="cmd-labels">
      <Command shouldFilter={false} loop label="Move to" className="cmd-root">
        <div className="cmd-inputrow cmd-inputrow--sm">
          <FolderInput size={16} strokeWidth={1.5} className="cmd-inputrow__icon" />
          <Command.Input autoFocus value={query} onValueChange={setQuery} placeholder="Move to…" className="cmd-input cmd-input--sm" />
        </div>
        <Command.List className="cmd-list cmd-list--sm">
          {!shown.length && <div className="cmd-empty">{opts.length ? 'No matching folder or label' : 'Nowhere to move these'}</div>}
          {shown.map((o) => {
            const Ico = o.icon
            return (
              <Command.Item key={o.key} value={o.key} onSelect={() => choose(o)} className="cmd-item">
                <span className="cmd-item__icon">
                  {Ico ? <Ico size={16} strokeWidth={1.5} /> : <span className="cmd-dot cmd-dot--lg" style={{ background: `var(--chip-${o.color ?? 'gray'}-fg)` }} />}
                </span>
                <span className="cmd-item__label">{o.name}</span>
                {o.hint && <span className="cmd-item__hint">{o.hint}</span>}
              </Command.Item>
            )
          })}
        </Command.List>
        <div className="cmd-footer">
          <span><kbd className="cmd-key">↑</kbd><kbd className="cmd-key">↓</kbd> Navigate</span>
          <span><kbd className="cmd-key"><CornerDownLeft size={10} strokeWidth={2} /></kbd> Move</span>
          <span><kbd className="cmd-key cmd-key--word">esc</kbd> Cancel</span>
        </div>
      </Command>
    </Overlay>
  )
}
