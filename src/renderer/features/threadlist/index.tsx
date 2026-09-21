import { useApp } from '@/lib/store'
import { listTime } from '@/lib/format'
// STUB — owned by feat/ui-shell. Replace with the grouped, keyboard-driven list.
export function ThreadList(): JSX.Element {
  const { threads, openThread } = useApp()
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '8px 16px' }}>
      {threads.map((t) => (
        <div key={t.id} onClick={() => openThread(t.id)} style={{ padding: '6px 8px', fontWeight: t.unread ? 600 : 400 }}>
          {t.participants[0]?.name ?? t.participants[0]?.email} — {t.subject} <span style={{ opacity: 0.5 }}>{listTime(t.lastMessageAt)}</span>
        </div>
      ))}
    </div>
  )
}
