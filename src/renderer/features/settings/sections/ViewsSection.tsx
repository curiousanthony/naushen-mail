import { useState } from 'react'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, GripVertical, LayoutList, Plus, Trash2 } from 'lucide-react'
import type { View } from '@shared/types'
import { useApp } from '@/lib/store'
import { Button, ConfirmBar, EmptyState, Group, IconButton, SectionTitle, Swatch, Switch } from '../ui'
import { describeFilter, dropOrder, moveView, reorderViews, sortViews } from '../lib/views'
import { VIEW_ICONS } from '../../sidebar/viewIcons'

export function ViewsSection(): JSX.Element {
  const views = useApp((s) => s.views)
  const setOverlay = useApp((s) => s.setOverlay)
  const refreshMeta = useApp((s) => s.refreshMeta)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string | null; where: 'before' | 'end' } | null>(null)
  const ordered = sortViews(views)

  const persist = async (result: { ordered: View[]; changed: View[] }): Promise<void> => {
    if (!result.changed.length) return
    useApp.setState({ views: result.ordered }) // optimistic
    await Promise.all(result.changed.map((v) => window.api.invoke('views.save', v)))
    await refreshMeta()
  }
  const toggle = async (v: View, showInSidebar: boolean): Promise<void> => {
    useApp.setState({ views: views.map((x) => (x.id === v.id ? { ...x, showInSidebar } : x)) })
    await window.api.invoke('views.save', { ...v, showInSidebar }); await refreshMeta()
  }
  const remove = async (id: string): Promise<void> => {
    await window.api.invoke('views.delete', id)
    const s = useApp.getState()
    if (s.nav.kind === 'view' && s.nav.viewId === id) s.setNav({ kind: 'role', role: 'inbox' })
    setConfirmId(null); await refreshMeta()
  }

  return (
    <div>
      <SectionTitle title="Views" description="Saved filters that appear in the sidebar. Drag to reorder." />
      <Group title={ordered.length ? `${ordered.length} saved ${ordered.length === 1 ? 'view' : 'views'}` : undefined} action={<Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setOverlay('view-editor')}>New view</Button>}>
        {ordered.length === 0 ? (
          <EmptyState icon={<LayoutList size={22} strokeWidth={1.5} />} title="No saved views"
            action={<Button variant="primary" icon={<Plus size={14} />} onClick={() => setOverlay('view-editor')}>Create a view</Button>}>
            A view is a saved filter, like “Unread” or “From my team”. It shows up in the sidebar.
          </EmptyState>
        ) : (
          <ul className="st-views" onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null) }}>
            {ordered.map((v, i) => (
              <li key={v.id} draggable={confirmId !== v.id} className={clsx('st-view', dragId === v.id && 'is-dragging', drop?.id === v.id && 'is-drop-before')}
                onDragStart={(e) => { setDragId(v.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', v.id) }}
                onDragEnd={() => { setDragId(null); setDrop(null) }}
                onDragOver={(e) => {
                  if (!dragId) return
                  e.preventDefault()
                  const r = e.currentTarget.getBoundingClientRect()
                  const after = e.clientY > r.top + r.height / 2
                  const next = after ? ordered[i + 1] : v
                  setDrop(next ? { id: next.id, where: 'before' } : { id: null, where: 'end' })
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragId) void persist(reorderViews(views, dropOrder(views, dragId, drop?.id ?? null)))
                  setDragId(null); setDrop(null)
                }}>
                <div className="st-view__row">
                  <span className="st-view__grip" aria-hidden><GripVertical size={15} strokeWidth={1.5} /></span>
                  <span className="st-view__icon">{v.emoji && VIEW_ICONS[v.emoji] ? (() => { const Icon = VIEW_ICONS[v.emoji!]; return <Icon size={15} /> })() : <Swatch color={v.color} />}</span>
                  <span className="st-view__text">
                    <span className="st-view__name">{v.name}</span>
                    <span className="st-view__desc">{describeFilter(v.filter)}</span>
                  </span>
                  <span className="st-view__tools">
                    <IconButton label={`Move ${v.name} up`} disabled={i === 0} onClick={() => void persist(moveView(views, v.id, -1))}><ArrowUp size={14} strokeWidth={1.75} /></IconButton>
                    <IconButton label={`Move ${v.name} down`} disabled={i === ordered.length - 1} onClick={() => void persist(moveView(views, v.id, 1))}><ArrowDown size={14} strokeWidth={1.75} /></IconButton>
                    <IconButton label={`Delete ${v.name}`} onClick={() => setConfirmId(v.id)}><Trash2 size={15} strokeWidth={1.5} /></IconButton>
                  </span>
                  <span className="st-view__toggle"><span>Sidebar</span><Switch label={`Show ${v.name} in sidebar`} checked={v.showInSidebar} onChange={(on) => void toggle(v, on)} /></span>
                </div>
                {confirmId === v.id && (
                  <ConfirmBar confirmLabel="Delete" onCancel={() => setConfirmId(null)} onConfirm={() => void remove(v.id)}
                    message={<><strong>Delete the view “{v.name}”?</strong> Your mail is not affected.</>} />
                )}
              </li>
            ))}
            <li className={clsx('st-views__end', drop?.where === 'end' && 'is-drop-before')} aria-hidden />
          </ul>
        )}
      </Group>
    </div>
  )
}
