import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useApp } from '@/lib/store'
import { Popover, useAnchor } from '../sidebar/Popover'

/**
 * Permanently deletes every conversation in Trash (this account, or all of them in "All
 * accounts") — not just the page loaded in the list. `threads.act('deleteForever', …)` is not
 * local-only (see sync/engine.ts's LOCAL_ONLY set), so it reaches the provider too: a real
 * Gmail/Outlook delete, not only a local one. There is no undo for it, hence the confirm.
 */
export function EmptyTrashButton(): JSX.Element | null {
  const accountId = useApp((s) => s.accountId)
  const total = useApp((s) => s.total)
  const act = useApp((s) => s.act)
  const toast = useApp((s) => s.toast)
  const [anchor, toggle, close] = useAnchor()
  const [busy, setBusy] = useState(false)

  if (!total) return null

  const confirm = async (): Promise<void> => {
    setBusy(true)
    try {
      const filter = accountId === 'all' ? { role: 'trash' as const } : { role: 'trash' as const, accountIds: [accountId] }
      const { threads } = await window.api.invoke('threads.list', { filter, limit: 10000 })
      const ids = threads.map((t) => t.id)
      close()
      if (ids.length) await act({ type: 'deleteForever' }, ids)
      toast({ message: ids.length === 1 ? 'Trash emptied · 1 conversation deleted' : `Trash emptied · ${ids.length} conversations deleted` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="tl__tool tl__tool--danger" onClick={toggle} aria-haspopup="dialog" aria-expanded={!!anchor}>
        <Trash2 size={14} /> Empty trash
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={close} align="end" width={252} label="Empty trash">
          <div className="menu__confirm">
            <p>Permanently delete {total === 1 ? 'this conversation' : `all ${total} conversations`} in Trash? This can't be undone.</p>
            <div className="menu__confirm-actions">
              <button className="menu__confirm-cancel" onClick={close} disabled={busy}>Cancel</button>
              <button className="menu__confirm-danger" onClick={() => void confirm()} disabled={busy}>
                {busy ? 'Emptying…' : 'Empty trash'}
              </button>
            </div>
          </div>
        </Popover>
      )}
    </>
  )
}
